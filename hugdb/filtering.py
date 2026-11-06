"""カードのキーワード検索・項目別絞り込み・訓練条件絞り込み・並び替えモジュール."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal
import unicodedata

from hugdb.ids import parse_id_number
from hugdb.matching import TrainingConditions, is_eligible
from hugdb.ordering import build_units, compute_order
from hugdb.schema import (
    EVENT_FIELD_MAP,
    Field,
    GROUP_FIELD_MAP,
    MEMBER_FIELD_MAP,
)

SearchView = Literal["all", "event", "household", "person", "pet"]
FilterOp = Literal["any", "all", "range", "contains", "empty"]
SortMode = Literal["deck", "id", "updated", "priority"]

ALL_KNOWN_FIELDS: dict[str, Field] = {
    **EVENT_FIELD_MAP,
    **GROUP_FIELD_MAP,
    **MEMBER_FIELD_MAP,
}

VALID_OPS: set[str] = {"any", "all", "range", "contains", "empty"}
VALID_VIEWS: set[str] = {"all", "event", "household", "person", "pet"}
VALID_SORTS: set[str] = {"deck", "id", "updated", "priority"}


@dataclass
class FieldFilter:
    """単一フィールドに対する絞り込み条件."""

    field: str
    op: FilterOp = "any"
    value: Any = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | FieldFilter) -> FieldFilter:
        if isinstance(data, FieldFilter):
            return data
        return cls(
            field=str(data.get("field", "")),
            op=data.get("op", "any"),
            value=data.get("value"),
        )


@dataclass
class SearchQuery:
    """検索クエリ全体."""

    view: SearchView = "all"
    keyword: str = ""
    fields: list[FieldFilter] = field(default_factory=list)
    training: TrainingConditions | None = None
    sort: SortMode = "deck"

    @classmethod
    def from_dict(cls, data: dict[str, Any] | SearchQuery | None) -> SearchQuery:
        if data is None:
            return cls()
        if isinstance(data, SearchQuery):
            return data
        raw_fields = data.get("fields") or []
        parsed_fields = [FieldFilter.from_dict(f) for f in raw_fields]
        raw_training = data.get("training")
        parsed_training = (
            TrainingConditions.from_dict(raw_training) if raw_training else None
        )
        return cls(
            view=data.get("view", "all"),
            keyword=str(data.get("keyword") or ""),
            fields=parsed_fields,
            training=parsed_training,
            sort=data.get("sort", "deck"),
        )


def _norm_text(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, list):
        return " ".join(_norm_text(x) for x in val)
    return unicodedata.normalize("NFKC", str(val)).casefold()


def _record_searchable_text(record: dict[str, Any]) -> str:
    parts: list[str] = []
    for v in record.values():
        if v is None:
            continue
        if isinstance(v, list):
            parts.extend(str(x) for x in v if x is not None)
        else:
            parts.append(str(v))
    return _norm_text(" ".join(parts))


def _matches_keyword(tokens: list[str], *records: dict[str, Any]) -> bool:
    if not tokens:
        return True
    combined = " ".join(_record_searchable_text(r) for r in records if r)
    return all(tok in combined for tok in tokens)


def _validate_filter(flt: FieldFilter) -> None:
    if flt.field not in ALL_KNOWN_FIELDS:
        raise ValueError(f"存在しないフィールド名です: '{flt.field}'")
    if flt.op not in VALID_OPS:
        raise ValueError(f"不正な演算子です: '{flt.op}'")


def _eval_field_on_record(record: dict[str, Any], flt: FieldFilter) -> bool:
    """単一レコードに対して FieldFilter を評価する."""
    if flt.field not in record:
        return False

    val = record.get(flt.field)

    if flt.op == "empty":
        want_empty = True if flt.value is None else bool(flt.value)
        is_empty = (
            val is None
            or (isinstance(val, str) and not val.strip())
            or (isinstance(val, list) and len(val) == 0)
        )
        return is_empty if want_empty else not is_empty

    if flt.op == "range":
        if val is None or isinstance(val, bool) or not isinstance(val, (int, float)):
            return False
        min_v = None
        max_v = None
        if isinstance(flt.value, dict):
            min_v = flt.value.get("min")
            max_v = flt.value.get("max")
        elif isinstance(flt.value, (list, tuple)) and len(flt.value) == 2:
            min_v, max_v = flt.value[0], flt.value[1]
        else:
            min_v = flt.value
        if min_v is not None and min_v != "" and val < int(min_v):
            return False
        if max_v is not None and max_v != "" and val > int(max_v):
            return False
        return True

    if flt.op == "contains":
        needle = _norm_text(flt.value).strip()
        if not needle:
            return True
        return needle in _norm_text(val)

    # op in ("any", "all")
    if flt.value is None:
        targets: list[str] = []
    elif isinstance(flt.value, (list, tuple, set)):
        targets = [str(x) for x in flt.value if x is not None and str(x) != ""]
    else:
        targets = [str(flt.value)] if str(flt.value) != "" else []

    if not targets:
        return True

    if isinstance(val, list):
        rec_set = {str(x) for x in val if x is not None}
    elif val is None or val == "":
        rec_set = set()
    else:
        rec_set = {str(val)}

    if flt.op == "any":
        return bool(rec_set & set(targets))
    if flt.op == "all":
        return set(targets).issubset(rec_set)
    return False


def _filter_applies_to_kind(field_name: str) -> set[str]:
    kinds: set[str] = set()
    if field_name in EVENT_FIELD_MAP:
        kinds.add("event")
    if field_name in GROUP_FIELD_MAP:
        kinds.add("group")
    if field_name in MEMBER_FIELD_MAP:
        kinds.add("member")
    return kinds


@dataclass
class SearchResult:
    """検索結果."""

    events: list[dict[str, Any]] = field(default_factory=list)
    households: list[dict[str, Any]] = field(default_factory=list)
    persons: list[dict[str, Any]] = field(default_factory=list)
    pets: list[dict[str, Any]] = field(default_factory=list)
    ordered_units: list[dict[str, Any]] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "events": self.events,
            "households": self.households,
            "persons": self.persons,
            "pets": self.pets,
            "ordered_units": self.ordered_units,
            "counts": self.counts,
        }


def execute_search(
    query: SearchQuery | dict[str, Any] | None,
    events: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
    *,
    event_updated_at: dict[str, str] | None = None,
    group_updated_at: dict[str, str] | None = None,
    member_updated_at: dict[str, str] | None = None,
) -> SearchResult:
    """イベント・グループ・構成員に対して検索・絞り込み・ソートを実行する."""
    q = SearchQuery.from_dict(query)
    if q.view not in VALID_VIEWS:
        raise ValueError(f"不正な表示種別です: '{q.view}'")
    if q.sort not in VALID_SORTS:
        raise ValueError(f"不正なソート指定です: '{q.sort}'")
    for flt in q.fields:
        _validate_filter(flt)

    kw_norm = _norm_text(q.keyword).strip()
    kw_tokens = [t for t in kw_norm.split() if t]

    members_by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in groups}
    group_by_id: dict[str, dict[str, Any]] = {g["group_id"]: g for g in groups}
    for m in members:
        gid = m.get("group_id")
        if gid in members_by_group:
            members_by_group[gid].append(m)

    # 1. イベントのフィルタリング
    matched_events: list[dict[str, Any]] = []
    for ev in events:
        if not _matches_keyword(kw_tokens, ev):
            continue
        if q.training is not None:
            ok, _ = is_eligible(ev, q.training)
            if not ok:
                continue
        ev_ok = True
        for flt in q.fields:
            applies = _filter_applies_to_kind(flt.field)
            if "event" not in applies:
                ev_ok = False
                break
            if not _eval_field_on_record(ev, flt):
                ev_ok = False
                break
        if ev_ok:
            matched_events.append(ev)

    # 2. 世帯（グループ＋構成員）のフィルタリング
    matched_households: list[dict[str, Any]] = []
    for grp in groups:
        gid = grp["group_id"]
        g_members = members_by_group.get(gid, [])
        if not _matches_keyword(kw_tokens, grp, *g_members):
            continue
        if q.training is not None:
            ok, _ = is_eligible(grp, q.training)
            if not ok:
                continue
        grp_ok = True
        for flt in q.fields:
            applies = _filter_applies_to_kind(flt.field)
            if "group" in applies and _eval_field_on_record(grp, flt):
                continue
            if "member" in applies and any(_eval_field_on_record(m, flt) for m in g_members):
                continue
            grp_ok = False
            break
        if grp_ok:
            matched_households.append({"group": grp, "members": g_members})

    # 3. 構成員（人物・ペット）個別のフィルタリング
    matched_persons: list[dict[str, Any]] = []
    matched_pets: list[dict[str, Any]] = []
    for m in members:
        dt = m.get("data_type")
        parent_grp = group_by_id.get(m.get("group_id", ""))
        if not _matches_keyword(kw_tokens, m, parent_grp or {}):
            continue
        if q.training is not None and parent_grp is not None:
            ok, _ = is_eligible(parent_grp, q.training)
            if not ok:
                continue
        m_ok = True
        for flt in q.fields:
            fld_def = MEMBER_FIELD_MAP.get(flt.field)
            if fld_def is not None and fld_def.applies_to is not None and fld_def.applies_to != dt:
                m_ok = False
                break
            # age は人物の年齢検索のときペットを除外（FI-16）
            if flt.field == "age" and dt != "人物":
                m_ok = False
                break
            applies = _filter_applies_to_kind(flt.field)
            if "member" in applies and _eval_field_on_record(m, flt):
                continue
            if "group" in applies and parent_grp is not None and _eval_field_on_record(parent_grp, flt):
                continue
            m_ok = False
            break
        if m_ok:
            if dt == "人物":
                matched_persons.append(m)
            elif dt == "ペット":
                matched_pets.append(m)

    # 4. ソート
    ev_up = event_updated_at or {}
    grp_up = group_updated_at or {}
    mem_up = member_updated_at or {}

    if q.sort == "id":
        matched_events.sort(key=lambda e: (parse_id_number("EV", e["card_id"]) or 999999, e["card_id"]))
        matched_households.sort(
            key=lambda h: (parse_id_number("GRP", h["group"]["group_id"]) or 999999, h["group"]["group_id"])
        )
        matched_persons.sort(key=lambda m: (parse_id_number("M", m["member_id"]) or 999999, m["member_id"]))
        matched_pets.sort(key=lambda m: (parse_id_number("M", m["member_id"]) or 999999, m["member_id"]))
        ordered_units = (
            [{"kind": "event", "id": e["card_id"], "event": e} for e in matched_events]
            + [{"kind": "household", "id": h["group"]["group_id"], **h} for h in matched_households]
        )
    elif q.sort == "updated":
        matched_events.sort(key=lambda e: (ev_up.get(e["card_id"], ""), e["card_id"]), reverse=True)
        matched_households.sort(
            key=lambda h: (grp_up.get(h["group"]["group_id"], ""), h["group"]["group_id"]),
            reverse=True,
        )
        matched_persons.sort(key=lambda m: (mem_up.get(m["member_id"], ""), m["member_id"]), reverse=True)
        matched_pets.sort(key=lambda m: (mem_up.get(m["member_id"], ""), m["member_id"]), reverse=True)
        ordered_units = (
            [{"kind": "event", "id": e["card_id"], "event": e} for e in matched_events]
            + [{"kind": "household", "id": h["group"]["group_id"], **h} for h in matched_households]
        )
        ordered_units.sort(
            key=lambda u: ev_up.get(u["id"], "") if u["kind"] == "event" else grp_up.get(u["id"], ""),
            reverse=True,
        )
    elif q.sort == "priority":
        matched_events.sort(key=lambda e: (e.get("priority", 99), parse_id_number("EV", e["card_id"]) or 999999))
        matched_households.sort(
            key=lambda h: (
                0 if h["group"].get("urgency_level") == "要即時対応" else 1,
                parse_id_number("GRP", h["group"]["group_id"]) or 999999,
            )
        )
        ordered_units = (
            [{"kind": "event", "id": e["card_id"], "event": e} for e in matched_events]
            + [{"kind": "household", "id": h["group"]["group_id"], **h} for h in matched_households]
        )
    else:
        # sort == "deck" (ordering.compute_order と完全一致)
        hh_by_id = {h["group"]["group_id"]: h for h in matched_households}
        ev_by_id = {e["card_id"]: e for e in matched_events}
        units = build_units(
            matched_events,
            [h["group"] for h in matched_households],
        )
        sorted_units = compute_order(units)
        ordered_units = []
        new_events: list[dict[str, Any]] = []
        new_households: list[dict[str, Any]] = []
        for u in sorted_units:
            if u.kind == "event":
                ev_obj = ev_by_id[u.id]
                new_events.append(ev_obj)
                ordered_units.append({"kind": "event", "id": u.id, "event": ev_obj})
            else:
                hh_obj = hh_by_id[u.id]
                new_households.append(hh_obj)
                ordered_units.append({"kind": "household", "id": u.id, **hh_obj})
        matched_events = new_events
        matched_households = new_households

        # 構成員もデッキのグループ順 → 人物・ペット順に並べる
        grp_rank = {h["group"]["group_id"]: idx for idx, h in enumerate(matched_households)}
        matched_persons.sort(
            key=lambda m: (grp_rank.get(m.get("group_id", ""), 9999), parse_id_number("M", m["member_id"]) or 999999)
        )
        matched_pets.sort(
            key=lambda m: (grp_rank.get(m.get("group_id", ""), 9999), parse_id_number("M", m["member_id"]) or 999999)
        )

    counts = {
        "events": len(matched_events),
        "households": len(matched_households),
        "persons": len(matched_persons),
        "pets": len(matched_pets),
        "units": len(matched_events) + len(matched_households),
    }

    # view に応じた返却フィルタリング（counts は全体および該当種別を保持）
    if q.view == "event":
        return SearchResult(
            events=matched_events,
            households=[],
            persons=[],
            pets=[],
            ordered_units=[u for u in ordered_units if u["kind"] == "event"],
            counts=counts,
        )
    if q.view == "household":
        return SearchResult(
            events=[],
            households=matched_households,
            persons=[],
            pets=[],
            ordered_units=[u for u in ordered_units if u["kind"] == "household"],
            counts=counts,
        )
    if q.view == "person":
        return SearchResult(
            events=[],
            households=[],
            persons=matched_persons,
            pets=[],
            ordered_units=[],
            counts=counts,
        )
    if q.view == "pet":
        return SearchResult(
            events=[],
            households=[],
            persons=[],
            pets=matched_pets,
            ordered_units=[],
            counts=counts,
        )

    return SearchResult(
        events=matched_events,
        households=matched_households,
        persons=matched_persons,
        pets=matched_pets,
        ordered_units=ordered_units,
        counts=counts,
    )
