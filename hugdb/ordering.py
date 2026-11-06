"""デッキの並べ順計算・進行度矛盾の検出と解消・手動並び替えモジュール."""
from __future__ import annotations

from dataclasses import dataclass, field
import heapq
from typing import Any, Literal

from hugdb.ids import parse_id_number
from hugdb.schema import DISASTER_PHASE, RELATIVE_TIMING


def _natural_id_key(uid: str) -> tuple[int, str]:
    for prefix in ("EV", "GRP", "M"):
        num = parse_id_number(prefix, uid)  # type: ignore[arg-type]
        if num is not None:
            return (num, uid)
    if uid.isdigit():
        return (int(uid), uid)
    return (999999, uid)

UnitKind = Literal["event", "household"]
ResolutionChoice = Literal["keep", "move"]


class PrerequisiteViolation(Exception):
    """手動の並べ替え等が前提カードの順序制約に違反した場合の例外."""

    def __init__(self, card_id: str, prerequisite_card_id: str, message: str | None = None) -> None:
        self.card_id = card_id
        self.prerequisite_card_id = prerequisite_card_id
        msg = (
            message
            or f"カード '{card_id}' を前提カード '{prerequisite_card_id}' より前に配置することはできません"
        )
        super().__init__(msg)


@dataclass
class OrderUnit:
    """並べ替え対象の1単位（イベントカードまたは避難者世帯）."""

    id: str
    kind: UnitKind
    record: dict[str, Any]
    timing_index: int
    phase_index: int | None
    priority: int = 5
    urgency_rank: int = 1
    prerequisite_card_id: str | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def timing_label(self) -> str:
        return RELATIVE_TIMING[self.timing_index]

    @property
    def phase_label(self) -> str | None:
        if self.phase_index is None:
            return None
        return DISASTER_PHASE[self.phase_index]


@dataclass
class Conflict:
    """災害進行度の逆転（矛盾）情報（原因カード単位）."""

    culprit_id: str
    culprit_name: str
    culprit_timing: str
    culprit_phase: str
    affected_ids: list[str]
    acknowledged: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "culprit_id": self.culprit_id,
            "culprit_name": self.culprit_name,
            "culprit_timing": self.culprit_timing,
            "culprit_phase": self.culprit_phase,
            "affected_ids": list(self.affected_ids),
            "affected_count": len(self.affected_ids),
            "acknowledged": self.acknowledged,
        }


def extract_timing_index(record: dict[str, Any]) -> tuple[int, list[str]]:
    """relative_timing から最小インデックス（空なら中盤=2）と警告を返す."""
    raw = record.get("relative_timing") or []
    if isinstance(raw, str):
        raw = [raw]
    indices: list[int] = []
    warnings: list[str] = []
    for item in raw:
        if item in RELATIVE_TIMING:
            indices.append(RELATIVE_TIMING.index(item))
        elif item:
            warnings.append(f"選択肢外の相対発生時期 '{item}' を無視しました")
    if not indices:
        return 2, warnings  # 中盤
    return min(indices), warnings


def extract_phase_index(record: dict[str, Any]) -> tuple[int | None, list[str]]:
    """disaster_phase から最小インデックス（空なら None）と警告を返す."""
    raw = record.get("disaster_phase") or []
    if isinstance(raw, str):
        raw = [raw]
    indices: list[int] = []
    warnings: list[str] = []
    for item in raw:
        if item in DISASTER_PHASE:
            indices.append(DISASTER_PHASE.index(item))
        elif item:
            warnings.append(f"選択肢外の災害進行度 '{item}' を無視しました")
    if not indices:
        return None, warnings
    return min(indices), warnings


def make_unit_from_event(event: dict[str, Any]) -> OrderUnit:
    t_idx, t_warn = extract_timing_index(event)
    p_idx, p_warn = extract_phase_index(event)
    pr = event.get("priority")
    pr_int = int(pr) if isinstance(pr, int) and not isinstance(pr, bool) else 5
    prereq = event.get("prerequisite_card_id")
    prereq_str = str(prereq).strip() if prereq and str(prereq).strip() else None
    return OrderUnit(
        id=str(event["card_id"]),
        kind="event",
        record=event,
        timing_index=t_idx,
        phase_index=p_idx,
        priority=pr_int,
        prerequisite_card_id=prereq_str,
        warnings=t_warn + p_warn,
    )


def make_unit_from_group(group: dict[str, Any]) -> OrderUnit:
    t_idx, t_warn = extract_timing_index(group)
    p_idx, p_warn = extract_phase_index(group)
    urg = 0 if group.get("urgency_level") == "要即時対応" else 1
    return OrderUnit(
        id=str(group["group_id"]),
        kind="household",
        record=group,
        timing_index=t_idx,
        phase_index=p_idx,
        urgency_rank=urg,
        prerequisite_card_id=None,
        warnings=t_warn + p_warn,
    )


def build_units(
    events: list[dict[str, Any]] | None = None,
    groups: list[dict[str, Any]] | None = None,
) -> list[OrderUnit]:
    """イベントリストとグループリストから OrderUnit のリストを構築する."""
    units: list[OrderUnit] = []
    for ev in events or []:
        units.append(make_unit_from_event(ev))
    for grp in groups or []:
        units.append(make_unit_from_group(grp))
    return units


def _coerce_units(items: list[OrderUnit | dict[str, Any]]) -> list[OrderUnit]:
    res: list[OrderUnit] = []
    for it in items:
        if isinstance(it, OrderUnit):
            res.append(it)
        elif isinstance(it, dict):
            if "card_id" in it:
                res.append(make_unit_from_event(it))
            elif "group_id" in it:
                res.append(make_unit_from_group(it))
            else:
                raise ValueError(f"Unknown unit dict: {it}")
        else:
            raise TypeError(f"Unsupported unit type: {type(it)}")
    return res


def topological_sort(seq: list[OrderUnit]) -> list[OrderUnit]:
    """元の順序を可能な限り保ちながら、前提カードが先に来るようトポロジカルソートする."""
    if len(seq) <= 1:
        return list(seq)

    pos = {u.id: i for i, u in enumerate(seq)}
    ids = set(pos.keys())
    indeg: dict[str, int] = {u.id: 0 for u in seq}
    children: dict[str, list[str]] = {u.id: [] for u in seq}

    for u in seq:
        pre = u.prerequisite_card_id
        if pre and pre in ids and pre != u.id:
            indeg[u.id] += 1
            children[pre].append(u.id)

    by_id = {u.id: u for u in seq}
    heap: list[tuple[int, str]] = [(pos[uid], uid) for uid, deg in indeg.items() if deg == 0]
    heapq.heapify(heap)

    result: list[OrderUnit] = []
    while heap:
        _, uid = heapq.heappop(heap)
        result.append(by_id[uid])
        for child_id in children[uid]:
            indeg[child_id] -= 1
            if indeg[child_id] == 0:
                heapq.heappush(heap, (pos[child_id], child_id))

    # 万一循環が残っていた場合は残りを元の順序で末尾に付加
    if len(result) < len(seq):
        placed = {u.id for u in result}
        for u in seq:
            if u.id not in placed:
                result.append(u)

    return result


def compute_order(
    units: list[OrderUnit | dict[str, Any]],
    *,
    phase_first: bool = False,
) -> list[OrderUnit]:
    """相対発生時期（または進行度優先）でバケット分けし、比率交互配置＋トポロジカルソートを行う."""
    coerced = _coerce_units(units)
    if not coerced:
        return []

    buckets: dict[tuple[int, int], list[OrderUnit]] = {}
    for u in coerced:
        pk = u.phase_index if u.phase_index is not None else 99
        key = (pk, u.timing_index) if phase_first else (u.timing_index, pk)
        buckets.setdefault(key, []).append(u)

    out: list[OrderUnit] = []
    for key in sorted(buckets.keys()):
        b = buckets[key]
        zero = sorted(
            [u for u in b if u.kind == "event" and u.priority == 0],
            key=lambda u: _natural_id_key(u.id),
        )
        events = sorted(
            [u for u in b if u.kind == "event" and u.priority != 0],
            key=lambda u: (u.priority, _natural_id_key(u.id)),
        )
        households = sorted(
            [u for u in b if u.kind == "household"],
            key=lambda u: (u.urgency_rank, _natural_id_key(u.id)),
        )
        merged = sorted(
            [((i + 0.5) / len(events), 0, u) for i, u in enumerate(events)]
            + [((j + 0.5) / len(households), 1, u) for j, u in enumerate(households)],
            key=lambda x: (x[0], x[1]),
        )
        out.extend(zero)
        out.extend(m[2] for m in merged)

    return topological_sort(out)


def phase_first_order(units: list[OrderUnit | dict[str, Any]]) -> list[OrderUnit]:
    """災害進行度を第1キー、相対発生時期を第2キーとして一括で並べ直す."""
    return compute_order(units, phase_first=True)


def detect_conflicts(
    order: list[OrderUnit | dict[str, Any]],
    resolutions: dict[str, str] | None = None,
) -> list[Conflict]:
    """前にあるカードの方が災害進行度が遅い組をすべて検出し、原因カードごとにまとめて返す."""
    seq = _coerce_units(order)
    res_map = resolutions or {}
    conflicts: list[Conflict] = []

    for a in range(len(seq)):
        ua = seq[a]
        if ua.phase_index is None:
            continue
        affected: list[str] = []
        for b in range(a + 1, len(seq)):
            ub = seq[b]
            if ub.phase_index is not None and ua.phase_index > ub.phase_index:
                affected.append(ub.id)
        if affected:
            name = (
                ua.record.get("event_name")
                if ua.kind == "event"
                else ua.record.get("group_name")
            ) or ua.id
            ack = res_map.get(ua.id) == "keep"
            conflicts.append(
                Conflict(
                    culprit_id=ua.id,
                    culprit_name=str(name),
                    culprit_timing=ua.timing_label,
                    culprit_phase=ua.phase_label or "",
                    affected_ids=affected,
                    acknowledged=ack,
                )
            )
    return conflicts


def apply_resolutions(
    order: list[OrderUnit | dict[str, Any]],
    resolutions: dict[str, str] | None,
) -> list[OrderUnit]:
    """原因カードごとの解決指定 ('keep' | 'move') を適用し、必要ならトポロジカルソートで整合させる."""
    seq = list(_coerce_units(order))
    if not resolutions or len(seq) <= 1:
        return seq

    move_ids = [
        u.id
        for u in seq
        if resolutions.get(u.id) == "move" and u.phase_index is not None
    ]
    if not move_ids:
        return seq

    for cid in move_ids:
        idx = next((i for i, u in enumerate(seq) if u.id == cid), None)
        if idx is None:
            continue
        culprit = seq[idx]
        if culprit.phase_index is None:
            continue
        # 自分より後ろにあり、自分より進行度が早いカードのうち最後のものを探す
        last_earlier_idx: int | None = None
        for j in range(idx + 1, len(seq)):
            other = seq[j]
            if other.phase_index is not None and other.phase_index < culprit.phase_index:
                last_earlier_idx = j
        if last_earlier_idx is not None:
            seq.pop(idx)
            seq.insert(last_earlier_idx, culprit)

    return topological_sort(seq)


def validate_prerequisite_order(seq: list[OrderUnit]) -> None:
    """前提カードが依存カードより前にあるか検証し、違反があれば PrerequisiteViolation を送出する."""
    pos = {u.id: i for i, u in enumerate(seq)}
    for u in seq:
        pre = u.prerequisite_card_id
        if pre and pre in pos and pos[pre] > pos[u.id]:
            raise PrerequisiteViolation(u.id, pre)


def apply_manual_order(
    computed: list[OrderUnit | dict[str, Any]],
    manual_ids: list[str] | None,
) -> list[OrderUnit]:
    """計算された順序に対し、手動の順序を適用する.

    - 削除されたカードは無視し、残りの相対順を保つ (OR-23)
    - 新しく追加されたカードは計算上の位置に留まる (OR-24)
    - 前提カードの順序制約に違反する場合は PrerequisiteViolation を送出する (OR-22)
    """
    seq = list(_coerce_units(computed))
    if not manual_ids or len(seq) <= 1:
        return seq

    by_id = {u.id: u for u in seq}
    seen: set[str] = set()
    valid_manual_ids: list[str] = []
    for mid in manual_ids:
        if mid in by_id and mid not in seen:
            seen.add(mid)
            valid_manual_ids.append(mid)

    if not valid_manual_ids:
        return seq

    manual_set = set(valid_manual_ids)
    manual_iter = iter(by_id[mid] for mid in valid_manual_ids)

    result: list[OrderUnit] = []
    for u in seq:
        if u.id in manual_set:
            result.append(next(manual_iter))
        else:
            result.append(u)

    validate_prerequisite_order(result)
    return result
