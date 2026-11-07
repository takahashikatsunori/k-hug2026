"""訓練用カードデッキの構築・枚数上限適用・連番化・出力データ生成モジュール."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
import hashlib
import json
from typing import Any

from hugdb.holidays import holiday_types
from hugdb.ids import parse_id_number
from hugdb.matching import TrainingConditions, is_eligible
from hugdb.names import fill_household_names
from hugdb.ordering import (
    Conflict,
    OrderUnit,
    PrerequisiteViolation,
    apply_manual_order,
    apply_resolutions,
    build_units,
    compute_order,
    detect_conflicts,
    extract_phase_index,
    extract_timing_index,
    phase_first_order,
)
from hugdb.schema import order_record_keys


def _id_sort_key(prefix: str, raw_id: Any) -> tuple[int, int, str]:
    s = str(raw_id or "")
    num = parse_id_number(prefix, s)  # type: ignore[arg-type]
    if num is not None:
        return (0, num, s)
    if s.isdigit():
        return (0, int(s), s)
    return (1, 999999, s)


@dataclass
class DeckCard:
    """連番化されたデッキ内の1枚のカード（イベント・人物・ペット）."""

    card_number: int
    kind: str  # "event" | "person" | "pet"
    unit_id: str
    original_id: str
    new_id: str
    title: str
    data: dict[str, Any]
    group_id: str | None = None
    new_group_id: str | None = None
    group_name: str | None = None
    group: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "card_number": self.card_number,
            "kind": self.kind,
            "unit_id": self.unit_id,
            "original_id": self.original_id,
            "new_id": self.new_id,
            "title": self.title,
            "data": self.data,
            "group_id": self.group_id,
            "new_group_id": self.new_group_id,
            "group_name": self.group_name,
            "group": self.group,
        }


@dataclass
class DeckBuildResult:
    """デッキ構築結果."""

    cards: list[DeckCard] = field(default_factory=list)
    units: list[dict[str, Any]] = field(default_factory=list)
    unit_ids: list[str] = field(default_factory=list)
    computed_unit_ids: list[str] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    excluded: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)
    export_payload: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    content_hash: str = ""
    resolved_holiday_types: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cards": [c.to_dict() for c in self.cards],
            "units": self.units,
            "unit_ids": self.unit_ids,
            "computed_unit_ids": self.computed_unit_ids,
            "conflicts": [c.to_dict() for c in self.conflicts],
            "excluded": self.excluded,
            "warnings": self.warnings,
            "stats": self.stats,
            "export_payload": self.export_payload,
            "content_hash": self.content_hash,
            "resolved_holiday_types": self.resolved_holiday_types,
        }


def compute_content_hash(
    events: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
) -> str:
    """デッキ構成カードの内容から決定論的な SHA-256 ハッシュを計算する."""
    payload = {
        "events": sorted(events, key=lambda e: str(e.get("card_id", ""))),
        "groups": sorted(groups, key=lambda g: str(g.get("group_id", ""))),
        "members": sorted(members, key=lambda m: str(m.get("member_id", ""))),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _apply_event_limit(
    eligible_events: list[dict[str, Any]],
    max_events: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """最大イベント数の上限を適用する（priority=0 は必須、前提が揃うものから priority の小さい順に採用）."""
    warnings: list[str] = []
    zero_events = [e for e in eligible_events if e.get("priority") == 0]
    zero_events.sort(key=lambda e: _id_sort_key("EV", e.get("card_id")))

    if len(zero_events) > max_events:
        warnings.append(
            f"priority=0 の確定イベント（{len(zero_events)}件）が最大イベント数（{max_events}件）を超えているため、priority=0 の全件を採用しました"
        )
        selected = list(zero_events)
        selected_ids = {e["card_id"] for e in selected}
        dropped = [e for e in eligible_events if e["card_id"] not in selected_ids]
        return selected, dropped, warnings

    selected: list[dict[str, Any]] = list(zero_events)
    selected_ids: set[str] = {e["card_id"] for e in selected}

    # priority=0 イベントの前提カードがまだ入っていなければ先に追加
    by_id = {e["card_id"]: e for e in eligible_events}
    for ze in list(selected):
        curr_pre = ze.get("prerequisite_card_id")
        while curr_pre and curr_pre in by_id and curr_pre not in selected_ids:
            pre_ev = by_id[curr_pre]
            selected.append(pre_ev)
            selected_ids.add(curr_pre)
            curr_pre = pre_ev.get("prerequisite_card_id")

    candidates = [e for e in eligible_events if e["card_id"] not in selected_ids]
    candidates.sort(
        key=lambda e: (
            e.get("priority", 5),
            extract_timing_index(e)[0],
            extract_phase_index(e)[0] if extract_phase_index(e)[0] is not None else 99,
            _id_sort_key("EV", e.get("card_id")),
        )
    )

    while len(selected) < max_events and candidates:
        progressed = False
        for idx, cand in enumerate(candidates):
            pre = cand.get("prerequisite_card_id")
            if not pre or pre in selected_ids:
                selected.append(cand)
                selected_ids.add(cand["card_id"])
                candidates.pop(idx)
                progressed = True
                break
        if not progressed:
            break

    dropped = [e for e in eligible_events if e["card_id"] not in selected_ids]
    return selected, dropped, warnings


def _apply_household_limit(
    eligible_groups: list[dict[str, Any]],
    max_households: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """最大世帯数の上限を適用する（要即時対応 → 時期 → 進行度 → ID の順で採用）."""
    sorted_groups = sorted(
        eligible_groups,
        key=lambda g: (
            0 if g.get("urgency_level") == "要即時対応" else 1,
            extract_timing_index(g)[0],
            extract_phase_index(g)[0] if extract_phase_index(g)[0] is not None else 99,
            _id_sort_key("GRP", g.get("group_id")),
        ),
    )
    selected = sorted_groups[:max_households]
    dropped = sorted_groups[max_households:]
    return selected, dropped


def build_deck(
    events: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
    conditions: TrainingConditions | dict[str, Any] | None = None,
    *,
    resolutions: dict[str, str] | None = None,
    manual_order: list[str] | None = None,
    phase_first: bool = False,
    excluded_ids: list[str] | set[str] | None = None,
) -> DeckBuildResult:
    """訓練条件・矛盾解決・手動順序・手動除外に基づきデッキを構築する."""
    tc = TrainingConditions.from_dict(conditions)
    warnings: list[str] = []
    excluded: list[dict[str, Any]] = []

    manual_excluded_set: set[str] = set()
    for src in (tc.excluded_ids, excluded_ids):
        if src:
            if isinstance(src, str):
                if src.strip():
                    manual_excluded_set.add(src.strip())
            else:
                for x in src:
                    if x and str(x).strip():
                        manual_excluded_set.add(str(x).strip())

    # 構成員ID (M-xxxx) が指定された場合は所属世帯 (GRP-xxx) も対象として解決できるようにする
    for m in members:
        mid = str(m.get("member_id") or "")
        gid = str(m.get("group_id") or "")
        if mid and gid and mid in manual_excluded_set:
            manual_excluded_set.add(gid)

    # 休日種別の解決
    resolved_holidays: list[str] = []
    if tc.holiday_type:
        if isinstance(tc.holiday_type, str):
            resolved_holidays = [tc.holiday_type] if tc.holiday_type.strip() else []
        else:
            resolved_holidays = [str(x) for x in tc.holiday_type if x]
    elif tc.date and str(tc.date).strip():
        try:
            resolved_holidays = sorted(holiday_types(tc.date))
        except ValueError:
            resolved_holidays = []

    # 1. 手動除外および is_eligible による第1段階抽出
    eligible_events: list[dict[str, Any]] = []
    for ev in events:
        cid = ev["card_id"]
        if cid in manual_excluded_set:
            excluded.append(
                {
                    "id": cid,
                    "kind": "event",
                    "name": ev.get("event_name") or cid,
                    "reasons": ["手動除外（デッキから除外）"],
                    "manual": True,
                }
            )
            continue
        ok, reasons = is_eligible(ev, tc)
        if ok:
            eligible_events.append(copy.deepcopy(ev))
        else:
            excluded.append(
                {
                    "id": cid,
                    "kind": "event",
                    "name": ev.get("event_name") or cid,
                    "reasons": reasons,
                    "manual": False,
                }
            )

    eligible_groups: list[dict[str, Any]] = []
    for grp in groups:
        gid = grp["group_id"]
        if gid in manual_excluded_set:
            excluded.append(
                {
                    "id": gid,
                    "kind": "household",
                    "name": grp.get("group_name") or gid,
                    "reasons": ["手動除外（デッキから除外）"],
                    "manual": True,
                }
            )
            continue
        ok, reasons = is_eligible(grp, tc)
        if ok:
            eligible_groups.append(copy.deepcopy(grp))
        else:
            excluded.append(
                {
                    "id": gid,
                    "kind": "household",
                    "name": grp.get("group_name") or gid,
                    "reasons": reasons,
                    "manual": False,
                }
            )

    # 2. 前提カードが抽出されなかったイベントの連鎖除外 (DE-06)
    changed_prereq = True
    while changed_prereq:
        changed_prereq = False
        current_ev_ids = {e["card_id"] for e in eligible_events}
        still_eligible: list[dict[str, Any]] = []
        for ev in eligible_events:
            pre = ev.get("prerequisite_card_id")
            if pre and str(pre).strip() and str(pre).strip() not in current_ev_ids:
                excluded.append(
                    {
                        "id": ev["card_id"],
                        "kind": "event",
                        "name": ev.get("event_name") or ev["card_id"],
                        "reasons": [f"前提カード {pre} がデッキにない"],
                        "manual": False,
                    }
                )
                changed_prereq = True
            else:
                still_eligible.append(ev)
        eligible_events = still_eligible

    # 3. 枚数上限の適用 (DE-08, DE-09, DE-10)
    if tc.max_events is not None and str(tc.max_events).strip() != "":
        max_ev = int(tc.max_events)
        eligible_events, dropped_evs, ev_warns = _apply_event_limit(eligible_events, max_ev)
        warnings.extend(ev_warns)
        for dev in dropped_evs:
            excluded.append(
                {
                    "id": dev["card_id"],
                    "kind": "event",
                    "name": dev.get("event_name") or dev["card_id"],
                    "reasons": ["枚数上限による除外: 最大イベント数"],
                    "manual": False,
                }
            )

    if tc.max_households is not None and str(tc.max_households).strip() != "":
        max_hh = int(tc.max_households)
        eligible_groups, dropped_grps = _apply_household_limit(eligible_groups, max_hh)
        for dgrp in dropped_grps:
            excluded.append(
                {
                    "id": dgrp["group_id"],
                    "kind": "household",
                    "name": dgrp.get("group_name") or dgrp["group_id"],
                    "reasons": ["枚数上限による除外: 最大世帯数"],
                    "manual": False,
                }
            )

    eligible_group_ids = {g["group_id"] for g in eligible_groups}
    eligible_members = [
        copy.deepcopy(m) for m in members if m.get("group_id") in eligible_group_ids
    ]

    content_hash = compute_content_hash(eligible_events, eligible_groups, eligible_members)

    # 4. 並べ順計算・矛盾解決・手動順序適用
    raw_units = build_units(eligible_events, eligible_groups)
    computed_units = phase_first_order(raw_units) if phase_first else compute_order(raw_units)
    computed_unit_ids = [u.id for u in computed_units]

    ordered_units: list[OrderUnit] = list(computed_units)
    if not phase_first and resolutions:
        ordered_units = apply_resolutions(ordered_units, resolutions)
    if manual_order:
        ordered_units = apply_manual_order(ordered_units, manual_order)

    conflicts = detect_conflicts(ordered_units, resolutions)

    # 5. 1からの連番付与・出力用 JSON の構築 (DE-11 〜 DE-17)
    members_by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in eligible_groups}
    for idx, m in enumerate(eligible_members):
        gid = m["group_id"]
        if gid in members_by_group:
            members_by_group[gid].append(m)

    # 世帯内は人物（元の順）→ ペット（元の順）に整列 (DE-12)
    for gid, mlist in members_by_group.items():
        mlist.sort(key=lambda m: (0 if m.get("data_type") == "人物" else 1))

    ev_by_id = {e["card_id"]: e for e in eligible_events}
    grp_by_id = {g["group_id"]: g for g in eligible_groups}

    cards: list[DeckCard] = []
    unit_summaries: list[dict[str, Any]] = []
    event_id_map: dict[str, str] = {}
    group_id_map: dict[str, str] = {}

    export_events_raw: list[tuple[dict[str, Any], str]] = []
    export_groups: list[dict[str, Any]] = []
    export_members: list[dict[str, Any]] = []

    seq_num = 0
    grp_seq = 0

    for u in ordered_units:
        if u.kind == "event":
            seq_num += 1
            new_cid = str(seq_num)
            orig_ev = copy.deepcopy(ev_by_id[u.id])
            event_id_map[u.id] = new_cid

            card_item = DeckCard(
                card_number=seq_num,
                kind="event",
                unit_id=u.id,
                original_id=u.id,
                new_id=new_cid,
                title=str(orig_ev.get("event_name") or u.id),
                data=copy.deepcopy(orig_ev),
            )
            cards.append(card_item)
            export_events_raw.append((orig_ev, new_cid))
            unit_summaries.append(
                {
                    "id": u.id,
                    "kind": "event",
                    "name": orig_ev.get("event_name") or u.id,
                    "timing": u.timing_label,
                    "phase": u.phase_label,
                    "priority": orig_ev.get("priority"),
                    "prerequisite_card_id": orig_ev.get("prerequisite_card_id"),
                    "card_numbers": [seq_num],
                }
            )
        else:
            grp_seq += 1
            new_gid = f"GRP-{grp_seq:03d}"
            group_id_map[u.id] = new_gid
            orig_grp = copy.deepcopy(grp_by_id[u.id])
            filled_members = fill_household_names(orig_grp, members_by_group.get(u.id, []))

            exp_grp = copy.deepcopy(orig_grp)
            exp_grp["group_id"] = new_gid
            exp_grp["member_count"] = sum(1 for m in filled_members if m.get("data_type") == "人物")
            exp_grp["pet_count"] = sum(1 for m in filled_members if m.get("data_type") == "ペット")
            export_groups.append(order_record_keys("group", exp_grp))

            hh_numbers: list[int] = []
            for m in filled_members:
                seq_num += 1
                new_mid = str(seq_num)
                hh_numbers.append(seq_num)

                exp_mem = copy.deepcopy(m)
                exp_mem["member_id"] = new_mid
                exp_mem["group_id"] = new_gid
                ordered_mem = order_record_keys("member", exp_mem)
                export_members.append(ordered_mem)

                card_kind = "person" if m.get("data_type") == "人物" else "pet"
                cards.append(
                    DeckCard(
                        card_number=seq_num,
                        kind=card_kind,
                        unit_id=u.id,
                        original_id=m["member_id"],
                        new_id=new_mid,
                        title=str(m.get("name") or new_mid),
                        data=copy.deepcopy(m),
                        group_id=u.id,
                        new_group_id=new_gid,
                        group_name=str(orig_grp.get("group_name") or u.id),
                        group=copy.deepcopy(orig_grp),
                    )
                )

            unit_summaries.append(
                {
                    "id": u.id,
                    "kind": "household",
                    "name": orig_grp.get("group_name") or u.id,
                    "timing": u.timing_label,
                    "phase": u.phase_label,
                    "urgency_level": orig_grp.get("urgency_level"),
                    "card_numbers": hh_numbers,
                }
            )

    export_events: list[dict[str, Any]] = []
    for orig_ev, new_cid in export_events_raw:
        exp_ev = copy.deepcopy(orig_ev)
        exp_ev["card_id"] = new_cid
        old_pre = exp_ev.get("prerequisite_card_id")
        if old_pre and str(old_pre) in event_id_map:
            exp_ev["prerequisite_card_id"] = event_id_map[str(old_pre)]
        else:
            exp_ev["prerequisite_card_id"] = None
        export_events.append(order_record_keys("event", exp_ev))

    # 除外理由の集計 (DE-18)
    reason_counts: dict[str, int] = {}
    for item in excluded:
        for r in item.get("reasons", []):
            reason_counts[r] = reason_counts.get(r, 0) + 1

    unacknowledged_conflicts = [c for c in conflicts if not c.acknowledged]
    person_count = sum(1 for c in cards if c.kind == "person")
    pet_count = sum(1 for c in cards if c.kind == "pet")

    stats = {
        "total_cards": len(cards),
        "total_units": len(ordered_units),
        "events": len(export_events),
        "households": len(export_groups),
        "persons": person_count,
        "pets": pet_count,
        "excluded_units": len(excluded),
        "excluded_by_reason": reason_counts,
        "conflicts_total": len(conflicts),
        "conflicts_unacknowledged": len(unacknowledged_conflicts),
    }

    return DeckBuildResult(
        cards=cards,
        units=unit_summaries,
        unit_ids=[u.id for u in ordered_units],
        computed_unit_ids=computed_unit_ids,
        conflicts=conflicts,
        excluded=excluded,
        warnings=warnings,
        stats=stats,
        export_payload={
            "cards_event": export_events,
            "evacuee_groups": export_groups,
            "group_members": export_members,
        },
        content_hash=content_hash,
        resolved_holiday_types=resolved_holidays,
    )


def inspect_saved_deck(
    saved_deck: dict[str, Any],
    events: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
) -> dict[str, Any]:
    """保存済みデッキを取得する際、現在のDB状態で再計算し changed フラグや手動順序再適用可否を付与する (DE-20)."""
    conditions = saved_deck.get("conditions") or {}
    resolutions = saved_deck.get("resolutions") or {}
    manual_order = saved_deck.get("manual_order")
    saved_hash = saved_deck.get("content_hash")

    auto_deck = build_deck(
        events,
        groups,
        members,
        conditions,
        resolutions=resolutions,
        manual_order=None,
    )
    changed = saved_hash is not None and saved_hash != auto_deck.content_hash

    can_reapply_manual = False
    reapplied_unit_ids: list[str] | None = None
    if manual_order:
        try:
            manual_deck = build_deck(
                events,
                groups,
                members,
                conditions,
                resolutions=resolutions,
                manual_order=manual_order,
            )
            can_reapply_manual = True
            reapplied_unit_ids = manual_deck.unit_ids
        except PrerequisiteViolation:
            can_reapply_manual = False

    result = dict(saved_deck)
    result["changed"] = changed
    result["current_hash"] = auto_deck.content_hash
    result["computed_unit_ids"] = auto_deck.computed_unit_ids
    result["can_reapply_manual"] = can_reapply_manual
    result["reapplied_unit_ids"] = reapplied_unit_ids
    return result
