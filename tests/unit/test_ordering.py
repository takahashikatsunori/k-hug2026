"""単体テスト: 並べ順・進行度矛盾・手動調整 (OR-01 〜 OR-27)."""
from __future__ import annotations

import copy
import random

import pytest

from hugdb.ordering import (
    PrerequisiteViolation,
    apply_manual_order,
    apply_resolutions,
    build_units,
    compute_order,
    detect_conflicts,
    make_unit_from_event,
    phase_first_order,
)


def _ev(cid: str, timing: list[str], phase: list[str], priority: int = 1, prereq: str | None = None) -> dict:
    return {
        "card_id": cid,
        "event_name": cid,
        "relative_timing": timing,
        "disaster_phase": phase,
        "priority": priority,
        "prerequisite_card_id": prereq,
    }


def _grp(gid: str, timing: list[str], phase: list[str], urgency: str = "通常") -> dict:
    return {
        "group_id": gid,
        "group_name": gid,
        "relative_timing": timing,
        "disaster_phase": phase,
        "urgency_level": urgency,
    }


def test_or_01_timing_order():
    """OR-01: 時期の違うカード（先頭/序盤/中盤/終盤/最後） → この順に並ぶ."""
    timings = ["最後（振り返り・収束）", "中盤", "先頭（開所・初期）", "終盤", "序盤"]
    events = [_ev(f"EV-00{i+1}", [t], ["初日"]) for i, t in enumerate(timings)]
    ordered = compute_order(events)
    assert [u.id for u in ordered] == ["EV-003", "EV-005", "EV-002", "EV-004", "EV-001"]


def test_or_02_same_timing_different_phase():
    """OR-02: 時期が同じで進行度が違う → 進行度の順に並ぶ."""
    phases = ["3日目", "発災直後", "2日目", "初日"]
    events = [_ev(f"EV-00{i+1}", ["序盤"], [p]) for i, p in enumerate(phases)]
    ordered = compute_order(events)
    assert [u.id for u in ordered] == ["EV-002", "EV-004", "EV-003", "EV-001"]


def test_or_03_multiple_relative_timing_uses_earliest():
    """OR-03: relative_timing が複数 [序盤, 終盤] → 早い方（序盤）として扱う."""
    e1 = _ev("EV-001", ["終盤", "序盤"], ["初日"])
    e2 = _ev("EV-002", ["中盤"], ["初日"])
    ordered = compute_order([e2, e1])
    assert [u.id for u in ordered] == ["EV-001", "EV-002"]


def test_or_04_empty_relative_timing_treated_as_middle():
    """OR-04: relative_timing が空 → 中盤として扱う."""
    e_early = _ev("EV-001", ["序盤"], ["初日"])
    e_empty = _ev("EV-002", [], ["初日"])
    e_late = _ev("EV-003", ["終盤"], ["初日"])
    ordered = compute_order([e_late, e_empty, e_early])
    assert [u.id for u in ordered] == ["EV-001", "EV-002", "EV-003"]


def test_or_05_empty_disaster_phase_last_in_timing_and_no_conflict():
    """OR-05: disaster_phase が空 → 同じ時期の中で最後に置き、矛盾の判定対象から外す."""
    e_empty = _ev("EV-001", ["序盤"], [])
    e_day1 = _ev("EV-002", ["序盤"], ["初日"])
    e_next = _ev("EV-003", ["中盤"], ["発災直後"])
    ordered = compute_order([e_empty, e_day1, e_next])
    assert [u.id for u in ordered] == ["EV-002", "EV-001", "EV-003"]
    # EV-001 (空) は EV-003 (発災直後) との矛盾原因にならない
    conflicts = detect_conflicts(ordered)
    assert [c.culprit_id for c in conflicts] == ["EV-002"]


def test_or_06_invalid_timing_value_warning_and_middle():
    """OR-06: 選択肢外の時期の値 → 空と同じ扱いにし、警告を出す."""
    u = make_unit_from_event(_ev("EV-001", ["未知の時期"], ["初日"]))
    assert u.timing_index == 2
    assert len(u.warnings) == 1


def test_or_07_priority_zero_comes_first_in_bucket():
    """OR-07: 同じグループに priority=0 のイベントと世帯がある → priority=0 が先頭に来る."""
    e0 = _ev("EV-002", ["先頭（開所・初期）"], ["発災直後"], priority=0)
    e1 = _ev("EV-001", ["先頭（開所・初期）"], ["発災直後"], priority=1)
    g1 = _grp("GRP-001", ["先頭（開所・初期）"], ["発災直後"], urgency="要即時対応")
    ordered = compute_order([e1, g1, e0])
    assert ordered[0].id == "EV-002"


def test_or_08_two_events_two_households_interleaved():
    """OR-08: イベント2件と世帯2件 → E,H,E,H の交互配置になる."""
    units = [
        _ev("EV-001", ["序盤"], ["初日"], priority=1),
        _ev("EV-002", ["序盤"], ["初日"], priority=2),
        _grp("GRP-001", ["序盤"], ["初日"]),
        _grp("GRP-002", ["序盤"], ["初日"]),
    ]
    ordered = compute_order(units)
    assert [u.kind for u in ordered] == ["event", "household", "event", "household"]


def test_or_09_one_event_three_households_interleaving():
    """OR-09: イベント1件と世帯3件 → H,E,H,H（位置 0.5 で同じ値ならイベントが先）."""
    units = [
        _ev("EV-001", ["序盤"], ["初日"], priority=1),
        _grp("GRP-001", ["序盤"], ["初日"]),
        _grp("GRP-002", ["序盤"], ["初日"]),
        _grp("GRP-003", ["序盤"], ["初日"]),
    ]
    ordered = compute_order(units)
    assert [u.id for u in ordered] == ["GRP-001", "EV-001", "GRP-002", "GRP-003"]


def test_or_10_only_events_or_only_households():
    """OR-10: イベントだけ / 世帯だけ → それぞれ priority 順 / 緊急度順に並ぶ."""
    evs = [_ev("EV-001", ["序盤"], ["初日"], priority=3), _ev("EV-002", ["序盤"], ["初日"], priority=1)]
    assert [u.id for u in compute_order(evs)] == ["EV-002", "EV-001"]

    grps = [_grp("GRP-001", ["序盤"], ["初日"], "通常"), _grp("GRP-002", ["序盤"], ["初日"], "要即時対応")]
    assert [u.id for u in compute_order(grps)] == ["GRP-002", "GRP-001"]


def test_or_11_household_urgency_order():
    """OR-11: 世帯の緊急度 → 「要即時対応」が「通常」より先."""
    grps = [
        _grp("GRP-001", ["序盤"], ["初日"], "通常"),
        _grp("GRP-002", ["序盤"], ["初日"], "要即時対応"),
    ]
    assert [u.id for u in compute_order(grps)] == ["GRP-002", "GRP-001"]


def test_or_12_topological_sort_prerequisite_in_later_timing():
    """OR-12: 前提カードが後ろの時期にある（B の前提が A で、A が終盤・B が序盤） → A が B より前に来る."""
    a = _ev("EV-A", ["終盤"], ["3日目"], priority=1)
    b = _ev("EV-B", ["序盤"], ["初日"], priority=1, prereq="EV-A")
    ordered = compute_order([b, a])
    assert [u.id for u in ordered] == ["EV-A", "EV-B"]


def test_or_13_prerequisite_chain():
    """OR-13: 前提カードの連鎖 A→B→C → A,B,C の順を保つ."""
    a = _ev("EV-A", ["終盤"], ["3日目"])
    b = _ev("EV-B", ["中盤"], ["2日目"], prereq="EV-A")
    c = _ev("EV-C", ["序盤"], ["初日"], prereq="EV-B")
    ordered = compute_order([c, b, a])
    assert [u.id for u in ordered] == ["EV-A", "EV-B", "EV-C"]


def test_or_14_deterministic_across_shuffles(s2_payload: dict):
    """OR-14: 同じ入力で10回実行する／入力の順序を入れ替える → 結果が常に同じ."""
    base_units = build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"])
    expected = [u.id for u in compute_order(base_units)]
    rng = random.Random(12345)
    for _ in range(10):
        shuffled = list(base_units)
        rng.shuffle(shuffled)
        assert [u.id for u in compute_order(shuffled)] == expected


def test_or_15_s2_golden_timing_first_order(s2_payload: dict):
    """OR-15: S2 で時期を優先して並べた結果（ゴールデン）."""
    units = build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"])
    ordered = compute_order(units)
    expected_str = (
        "EV-001 GRP-001 EV-002 GRP-005 GRP-002 EV-003 GRP-006 GRP-008 EV-004 GRP-003 "
        "EV-008 EV-012 EV-017 EV-006 GRP-007 EV-005 GRP-004 EV-007 GRP-009 EV-009 "
        "EV-010 EV-013 EV-014 EV-019 EV-018 GRP-010 EV-011 EV-016 EV-015 EV-020"
    )
    assert " ".join(u.id for u in ordered) == expected_str


def test_or_16_s2_phase_conflicts(s2_payload: dict):
    """OR-16: S2 の進行度の矛盾 → 原因カード9枚、矛盾の組45組."""
    units = build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"])
    ordered = compute_order(units)
    conflicts = detect_conflicts(ordered)
    culprit_counts = {c.culprit_id: len(c.affected_ids) for c in conflicts}
    assert culprit_counts == {
        "EV-008": 7,
        "EV-012": 10,
        "EV-017": 14,
        "EV-009": 1,
        "EV-010": 1,
        "EV-013": 2,
        "EV-014": 2,
        "EV-019": 4,
        "EV-018": 4,
    }
    assert sum(culprit_counts.values()) == 45


def test_or_17_s2_phase_first_order_zero_conflicts(s2_payload: dict):
    """OR-17: S2 を「すべて進行度を優先」で並べ直す → 矛盾0件."""
    units = build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"])
    ordered = phase_first_order(units)
    assert detect_conflicts(ordered) == []
    ids = [u.id for u in ordered]
    assert ids.index("GRP-009") < ids.index("GRP-010") < ids.index("EV-008") < ids.index("EV-009")


def test_or_18_resolve_single_culprit_move(s2_payload: dict):
    """OR-18: 原因カード EV-017 を「移動」 → EV-017 が原因の矛盾は0件になる."""
    units = build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"])
    ordered = compute_order(units)
    resolved = apply_resolutions(ordered, {"EV-017": "move"})
    conflicts = detect_conflicts(resolved)
    assert "EV-017" not in {c.culprit_id for c in conflicts}


def test_or_19_resolve_culprit_keep_acknowledges(s2_payload: dict):
    """OR-19: 原因カードを「このままにする」 → 順番は変えず、その矛盾を「確認済み」にする."""
    units = build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"])
    ordered = compute_order(units)
    resolutions = {"EV-008": "keep"}
    after = apply_resolutions(ordered, resolutions)
    assert [u.id for u in after] == [u.id for u in ordered]
    conflicts = detect_conflicts(after, resolutions)
    c_map = {c.culprit_id: c for c in conflicts}
    assert c_map["EV-008"].acknowledged is True
    assert c_map["EV-017"].acknowledged is False


def test_or_20_move_resolution_maintains_prerequisite_via_topo_sort():
    """OR-20: 移動すると前提カードの制約に反する場合 → 移動後にトポロジカルソートで直し、依存カードも後ろへ移動."""
    a = _ev("EV-A", ["序盤"], ["3日目"], priority=1)
    b = _ev("EV-B", ["序盤"], ["初日"], priority=2, prereq="EV-A")
    c = _ev("EV-C", ["中盤"], ["2日目"], priority=1)
    ordered = compute_order([a, b, c])
    assert [u.id for u in ordered] == ["EV-A", "EV-B", "EV-C"]

    # EV-A を移動させると EV-C の後ろへ行き、依存する EV-B も EV-A の後ろに保たれる
    resolved = apply_resolutions(ordered, {"EV-A": "move"})
    ids = [u.id for u in resolved]
    assert ids.index("EV-C") < ids.index("EV-A") < ids.index("EV-B")


def test_or_21_apply_manual_order():
    """OR-21: 手動の順番を適用する → 指定した順番になる."""
    units = [
        _ev("EV-001", ["序盤"], ["初日"], priority=1),
        _ev("EV-002", ["序盤"], ["初日"], priority=2),
        _ev("EV-003", ["序盤"], ["初日"], priority=3),
    ]
    computed = compute_order(units)
    manual = apply_manual_order(computed, ["EV-003", "EV-001", "EV-002"])
    assert [u.id for u in manual] == ["EV-003", "EV-001", "EV-002"]


def test_or_22_manual_order_violating_prerequisite_raises():
    """OR-22: 手動の順番で依存カードを前提カードより前に置く → PrerequisiteViolation を返す."""
    a = _ev("EV-001", ["序盤"], ["初日"], priority=1)
    b = _ev("EV-002", ["序盤"], ["初日"], priority=2, prereq="EV-001")
    computed = compute_order([a, b])
    with pytest.raises(PrerequisiteViolation) as exc_info:
        apply_manual_order(computed, ["EV-002", "EV-001"])
    assert exc_info.value.card_id == "EV-002"
    assert exc_info.value.prerequisite_card_id == "EV-001"


def test_or_23_reapply_manual_order_when_card_deleted():
    """OR-23: 手動調整を再適用: 前回あったカードが削除されている → 削除されたカードを除いて残りの相対順を保つ."""
    units = [
        _ev("EV-001", ["序盤"], ["初日"], priority=1),
        _ev("EV-003", ["序盤"], ["初日"], priority=3),
    ]
    computed = compute_order(units)
    manual = apply_manual_order(computed, ["EV-003", "EV-002", "EV-001"])
    assert [u.id for u in manual] == ["EV-003", "EV-001"]


def test_or_24_reapply_manual_order_when_new_card_added():
    """OR-24: 手動調整を再適用: 新しいカードが追加されている → 新しいカードは計算上の位置に入る."""
    units = [
        _ev("EV-001", ["先頭（開所・初期）"], ["発災直後"], priority=1),
        _ev("EV-NEW", ["序盤"], ["初日"], priority=1),
        _ev("EV-002", ["中盤"], ["初日"], priority=1),
        _ev("EV-003", ["終盤"], ["初日"], priority=1),
    ]
    computed = compute_order(units)
    # 以前の手動順序では EV-001, EV-003, EV-002 だったとする
    manual = apply_manual_order(computed, ["EV-001", "EV-003", "EV-002"])
    assert [u.id for u in manual] == ["EV-001", "EV-NEW", "EV-003", "EV-002"]


def test_or_25_stale_acknowledged_culprit_ignored_after_edit():
    """OR-25: 確認済みにした原因カードが、編集後に矛盾の原因ではなくなった → 古い確認済みの記録は無視する."""
    e1 = _ev("EV-001", ["序盤"], ["初日"])
    e2 = _ev("EV-002", ["中盤"], ["2日目"])
    ordered = compute_order([e1, e2])
    conflicts = detect_conflicts(ordered, resolutions={"EV-001": "keep"})
    assert conflicts == []


def test_or_26_editing_card_timing_updates_order(s2_payload: dict):
    """OR-26: カードを編集すると順番が変わる（EV-020 の時期を「先頭」に変える） → EV-020 が先頭グループに移る."""
    events = copy.deepcopy(s2_payload["cards_event"])
    for ev in events:
        if ev["card_id"] == "EV-020":
            ev["relative_timing"] = ["先頭（開所・初期）"]
            ev["disaster_phase"] = ["発災直後"]
    units = build_units(events, s2_payload["evacuee_groups"])
    ordered = compute_order(units)
    ids = [u.id for u in ordered]
    assert ids.index("EV-020") < 5


def test_or_27_empty_and_single_element():
    """OR-27: 0件 / 1件 → 空のリスト / その1件."""
    assert compute_order([]) == []
    single = compute_order([_ev("EV-001", ["序盤"], ["初日"])])
    assert len(single) == 1
    assert single[0].id == "EV-001"
