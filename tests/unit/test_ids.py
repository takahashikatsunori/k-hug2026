"""単体テスト: ID 採番・振り直し (ID-01 〜 ID-16)."""
from __future__ import annotations

import copy
import random

from hugdb.ids import allocate_id, next_id, remap_for_append, set_counter
from hugdb.repository import Repository


def test_id_01_initial_ids_when_empty():
    """ID-01: イベントが無い状態で採番 → EV-001、GRP-001、M-0001."""
    assert next_id("EV", [], 0) == ("EV-001", 1)
    assert next_id("GRP", [], 0) == ("GRP-001", 1)
    assert next_id("M", [], 0) == ("M-0001", 1)


def test_id_02_next_after_20():
    """ID-02: EV-001〜EV-020 があるときに採番 → EV-021."""
    existing = [f"EV-{i:03d}" for i in range(1, 21)]
    assert next_id("EV", existing, 0) == ("EV-021", 21)


def test_id_03_digit_overflow_999_to_1000():
    """ID-03: EV-999 の次 → EV-1000（桁が自動で増える）."""
    assert next_id("EV", ["EV-999"], 999) == ("EV-1000", 1000)
    assert next_id("M", ["M-9999"], 9999) == ("M-10000", 10000)


def test_id_04_gaps_not_filled():
    """ID-04: EV-002, EV-010 のように番号が飛んでいる → 最大値+1 の EV-011（隙間は埋めない）."""
    assert next_id("EV", ["EV-002", "EV-010"], 0) == ("EV-011", 11)


def test_id_05_non_matching_ids_ignored():
    """ID-05: 形式に合わない既存ID ABC が混ざっている → 無視して採番する."""
    assert next_id("EV", ["ABC", "EV-005", "EV-XYZ"], 0) == ("EV-006", 6)


def test_id_06_counter_higher_than_existing():
    """ID-06: カウンタが 30、既存IDの最大が 20 → EV-031（使ったIDを再利用しない）."""
    existing = [f"EV-{i:03d}" for i in range(1, 21)]
    assert next_id("EV", existing, 30) == ("EV-031", 31)


def test_id_07_deleted_id_not_reused(repo: Repository, s2_payload: dict):
    """ID-07: 削除した後に採番 → 削除したIDは再利用されない."""
    ev_template = copy.deepcopy(s2_payload["cards_event"][0])
    e1 = repo.create_event(ev_template)
    e2 = repo.create_event(ev_template)
    assert e1["card_id"] == "EV-001"
    assert e2["card_id"] == "EV-002"

    repo.delete_event("EV-002")
    e3 = repo.create_event(ev_template)
    assert e3["card_id"] == "EV-003"


def test_id_08_clear_all_preserves_counter(repo: Repository, s2_payload: dict):
    """ID-08: 全件削除した後に採番 → カウンタを引き継いで採番する."""
    ev_template = copy.deepcopy(s2_payload["cards_event"][0])
    repo.create_event(ev_template)
    repo.create_event(ev_template)
    repo.clear_all()
    e3 = repo.create_event(ev_template)
    assert e3["card_id"] == "EV-003"


def test_id_09_remap_s2_on_top_of_s2(s2_payload: dict):
    """ID-09: DBにS2がある状態でS2を追加用に振り直す → EV-021〜040, GRP-011〜020, M-0022〜0042."""
    db_ev = {e["card_id"] for e in s2_payload["cards_event"]}
    db_grp = {g["group_id"] for g in s2_payload["evacuee_groups"]}
    db_mem = {m["member_id"] for m in s2_payload["group_members"]}

    res = remap_for_append(s2_payload, db_ev, db_grp, db_mem)
    new_ev_ids = [e["card_id"] for e in res.payload["cards_event"]]
    new_grp_ids = [g["group_id"] for g in res.payload["evacuee_groups"]]
    new_mem_ids = [m["member_id"] for m in res.payload["group_members"]]

    assert new_ev_ids == [f"EV-{i:03d}" for i in range(21, 41)]
    assert new_grp_ids == [f"GRP-{i:03d}" for i in range(11, 21)]
    assert new_mem_ids == [f"M-{i:04d}" for i in range(22, 43)]


def test_id_10_remapped_member_group_ids_preserve_households(s2_payload: dict):
    """ID-10: 振り直し後の構成員の group_id が新しいグループIDを指し、元と同じ世帯の組み合わせが保たれる."""
    db_ev = {e["card_id"] for e in s2_payload["cards_event"]}
    db_grp = {g["group_id"] for g in s2_payload["evacuee_groups"]}
    db_mem = {m["member_id"] for m in s2_payload["group_members"]}

    res = remap_for_append(s2_payload, db_ev, db_grp, db_mem)
    orig_pairs = [(m["group_id"], m["name"]) for m in s2_payload["group_members"]]
    new_pairs = [(m["group_id"], m["name"]) for m in res.payload["group_members"]]

    for (old_gid, old_name), (new_gid, new_name) in zip(orig_pairs, new_pairs, strict=True):
        assert old_name == new_name
        assert res.group_map[old_gid] == new_gid


def test_id_11_remapped_prerequisite_within_import(s2_payload: dict):
    """ID-11: 振り直し後の前提カード（S2 の EV-002→EV-001）が EV-022→EV-021 になる."""
    db_ev = {e["card_id"] for e in s2_payload["cards_event"]}
    res = remap_for_append(s2_payload, db_ev, set(), set())
    by_id = {e["card_id"]: e for e in res.payload["cards_event"]}
    assert by_id["EV-022"]["prerequisite_card_id"] == "EV-021"


def test_id_12_prerequisite_in_db_only_preserved(s2_payload: dict):
    """ID-12: インポート内に無く、DBにはある前提カードID → そのまま保持する."""
    ev = copy.deepcopy(s2_payload["cards_event"][1])  # EV-002 -> EV-001
    payload = {"cards_event": [ev], "evacuee_groups": [], "group_members": []}
    res = remap_for_append(payload, existing_event_ids={"EV-001"})
    assert res.payload["cards_event"][0]["prerequisite_card_id"] == "EV-001"
    assert res.issues == []


def test_id_13_prerequisite_missing_everywhere_becomes_null_with_warning(s2_payload: dict):
    """ID-13: インポートにもDBにも無い前提カードID → null にして警告を出す."""
    ev = copy.deepcopy(s2_payload["cards_event"][1])
    ev["prerequisite_card_id"] = "EV-999"
    payload = {"cards_event": [ev], "evacuee_groups": [], "group_members": []}
    res = remap_for_append(payload, existing_event_ids={"EV-001"})
    assert res.payload["cards_event"][0]["prerequisite_card_id"] is None
    assert any(i.field == "prerequisite_card_id" and i.severity == "warning" for i in res.issues)


def test_id_14_member_pointing_to_group_not_in_import_is_error(s2_payload: dict):
    """ID-14: インポート内に無いグループを指す構成員 → 追加モードではDBの同じIDのグループにも付けずエラー."""
    mem = copy.deepcopy(s2_payload["group_members"][0])  # GRP-001
    payload = {"cards_event": [], "evacuee_groups": [], "group_members": [mem]}
    res = remap_for_append(payload, existing_group_ids={"GRP-001"})
    assert res.payload["group_members"] == []
    assert any(i.field == "group_id" and i.severity == "error" for i in res.issues)


def test_id_15_remap_bijective_mapping(s2_payload: dict):
    """ID-15: 振り直しの対応表が 旧ID→新ID で 1対1 である."""
    res = remap_for_append(
        s2_payload,
        existing_event_ids={"EV-001"},
        existing_group_ids={"GRP-001"},
        existing_member_ids={"M-0001"},
    )
    assert len(res.id_map) == 20 + 10 + 21
    assert len(set(res.id_map.values())) == len(res.id_map)


def test_id_16_property_no_collision_with_random_db_ids(s2_payload: dict):
    """ID-16: 振り直した結果のIDがDB内のIDと重複しない（ランダムな既存ID集合で100回試す）."""
    rng = random.Random(42)
    for _ in range(100):
        db_ev = {f"EV-{rng.randint(1, 500):03d}" for _ in range(rng.randint(0, 30))}
        db_grp = {f"GRP-{rng.randint(1, 500):03d}" for _ in range(rng.randint(0, 20))}
        db_mem = {f"M-{rng.randint(1, 5000):04d}" for _ in range(rng.randint(0, 40))}
        cnt = {
            "EV": rng.randint(0, 600),
            "GRP": rng.randint(0, 600),
            "M": rng.randint(0, 6000),
        }
        res = remap_for_append(s2_payload, db_ev, db_grp, db_mem, counters=cnt)  # type: ignore[arg-type]
        new_ev = {e["card_id"] for e in res.payload["cards_event"]}
        new_grp = {g["group_id"] for g in res.payload["evacuee_groups"]}
        new_mem = {m["member_id"] for m in res.payload["group_members"]}
        assert new_ev.isdisjoint(db_ev)
        assert new_grp.isdisjoint(db_grp)
        assert new_mem.isdisjoint(db_mem)
