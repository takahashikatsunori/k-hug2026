"""単体テスト: リポジトリ層・永続化 (RE-01 〜 RE-13)."""
from __future__ import annotations

import copy
from pathlib import Path
import sqlite3
import time

import pytest

from hugdb.db import connect
from hugdb.ids import get_counter
from hugdb.repository import ConflictError, NotFoundError, Repository, ValidationError


def test_re_01_event_crud_and_updated_at(repo: Repository, s2_payload: dict):
    """RE-01: イベントの作成・取得・更新・削除 → 期待どおり。updated_at が更新される."""
    ev_in = copy.deepcopy(s2_payload["cards_event"][0])
    created = repo.create_event(ev_in)
    cid = created["card_id"]
    assert cid == "EV-001"

    meta1 = repo.get_event_meta(cid)
    assert meta1 is not None
    t1 = meta1["updated_at"]

    time.sleep(0.005)
    ev_up = copy.deepcopy(created)
    ev_up["event_name"] = "更新後イベント名"
    updated = repo.update_event(cid, ev_up)
    assert updated["event_name"] == "更新後イベント名"

    meta2 = repo.get_event_meta(cid)
    assert meta2 is not None
    assert meta2["updated_at"] > t1

    repo.delete_event(cid)
    assert repo.get_event(cid) is None


def test_re_02_persistence_across_connections(db_path: Path, s2_payload: dict):
    """RE-02: 接続を閉じて開き直す → データが残っている（永続化）."""
    conn1 = connect(db_path)
    repo1 = Repository(conn1)
    repo1.create_event(copy.deepcopy(s2_payload["cards_event"][0]))
    conn1.close()

    conn2 = connect(db_path)
    repo2 = Repository(conn2)
    events = repo2.list_events()
    conn2.close()
    assert len(events) == 1
    assert events[0]["card_id"] == "EV-001"


def test_re_03_save_household_recalculates_counts(repo: Repository, s2_payload: dict):
    """RE-03: 世帯を一括で保存（人物の追加・更新・削除、ペットの追加）→ 1トランザクションで反映され、人数が再計算される."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m2 = copy.deepcopy(s2_payload["group_members"][1])
    pet = copy.deepcopy(next(m for m in s2_payload["group_members"] if m["data_type"] == "ペット"))

    saved = repo.save_household(grp, [m1, m2], is_create=True)
    gid = saved["group"]["group_id"]
    assert saved["group"]["member_count"] == 2
    assert saved["group"]["pet_count"] == 0

    # 人物1名を削除、人物1名を更新、ペット1匹を追加
    kept_m1 = copy.deepcopy(saved["members"][0])
    kept_m1["name"] = "国語 太郎（更新）"
    new_pet = copy.deepcopy(pet)
    del new_pet["member_id"]

    updated = repo.save_household(saved["group"], [kept_m1, new_pet], expected_group_id=gid)
    assert updated["group"]["member_count"] == 1
    assert updated["group"]["pet_count"] == 1
    assert len(repo.list_members(gid)) == 2


def test_re_04_save_household_rollback_on_exception(repo: Repository, s2_payload: dict):
    """RE-04: 世帯の一括保存の途中で例外が起きる → すべてロールバックされる."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    saved = repo.save_household(grp, [m1], is_create=True)
    gid = saved["group"]["group_id"]

    bad_member = copy.deepcopy(m1)
    bad_member["data_type"] = "不正種別"
    with pytest.raises(ValidationError):
        repo.save_household(saved["group"], [saved["members"][0], bad_member], expected_group_id=gid)

    after = repo.get_household(gid)
    assert after is not None
    assert len(after["members"]) == 1


def test_re_05_delete_household_cascades_members(repo: Repository, s2_payload: dict):
    """RE-05: 世帯を削除 → 構成員も連鎖して削除される（外部キーのカスケード）."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m2 = copy.deepcopy(s2_payload["group_members"][1])
    saved = repo.save_household(grp, [m1, m2], is_create=True)
    gid = saved["group"]["group_id"]
    assert len(repo.list_members(gid)) == 2

    repo.delete_household(gid)
    assert repo.get_household(gid) is None
    assert repo.list_members(gid) == []


def test_re_06_delete_prerequisite_event_two_step(repo: Repository, s2_payload: dict):
    """RE-06: 前提カードになっているイベントを削除 → 依存カード一覧を返し、force=True で前提を null にして削除."""
    e1 = repo.create_event(copy.deepcopy(s2_payload["cards_event"][0]))  # EV-001
    e2_in = copy.deepcopy(s2_payload["cards_event"][1])
    e2_in["prerequisite_card_id"] = e1["card_id"]
    e2 = repo.create_event(e2_in)  # EV-002

    with pytest.raises(ConflictError) as exc_info:
        repo.delete_event(e1["card_id"], force=False)
    assert e2["card_id"] in exc_info.value.dependents
    assert repo.get_event(e1["card_id"]) is not None

    cleared = repo.delete_event(e1["card_id"], force=True)
    assert cleared == [e2["card_id"]]
    assert repo.get_event(e1["card_id"]) is None
    e2_after = repo.get_event(e2["card_id"])
    assert e2_after is not None
    assert e2_after["prerequisite_card_id"] is None


def test_re_07_delete_last_person_member_rejected(repo: Repository, s2_payload: dict):
    """RE-07: 構成員を1人だけ削除して、人物が0人になる → 拒否する."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][3])  # GRP-004: 人物1 + ペット1
    m_person = copy.deepcopy(s2_payload["group_members"][8])
    m_pet = copy.deepcopy(s2_payload["group_members"][9])
    saved = repo.save_household(grp, [m_person, m_pet], is_create=True)

    person_id = next(m["member_id"] for m in saved["members"] if m["data_type"] == "人物")
    pet_id = next(m["member_id"] for m in saved["members"] if m["data_type"] == "ペット")

    with pytest.raises(ConflictError):
        repo.delete_member(person_id)

    # ペットの削除は可能
    after = repo.delete_member(pet_id)
    assert after["group"]["pet_count"] == 0
    assert after["group"]["member_count"] == 1


def test_re_08_changing_member_data_type_rejected(repo: Repository, s2_payload: dict):
    """RE-08: 構成員の data_type を変更しようとする → 拒否する（人物⇔ペットは作り直す）."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m2 = copy.deepcopy(s2_payload["group_members"][1])
    saved = repo.save_household(grp, [m1, m2], is_create=True)
    gid = saved["group"]["group_id"]

    changed_m2 = copy.deepcopy(saved["members"][1])
    changed_m2["data_type"] = "ペット"
    with pytest.raises(ValidationError) as exc_info:
        repo.save_household(saved["group"], [saved["members"][0], changed_m2], expected_group_id=gid)
    assert any(e.field == "data_type" for e in exc_info.value.errors)


def test_re_09_member_foreign_key_constraint(repo: Repository, s2_payload: dict):
    """RE-09: 構成員の group_id を、存在しないグループに変更 → 外部キーのエラー."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    saved = repo.save_household(grp, [m1], is_create=True)
    mid = saved["members"][0]["member_id"]

    with pytest.raises(sqlite3.IntegrityError):
        repo.conn.execute(
            "UPDATE group_members SET group_id = 'GRP-999' WHERE member_id = ?",
            (mid,),
        )


def test_re_10_clear_all_options_and_preserves_meta_and_versions(repo: Repository, s2_payload: dict):
    """RE-10: 全件削除（保存済み検索・デッキも削除する／しない）→ 指定どおり。バージョンとIDのカウンタは残る."""
    repo.create_event(copy.deepcopy(s2_payload["cards_event"][0]))
    repo.create_saved_search("テスト検索", {"keyword": "毛布"}, ["EV-001"])
    repo.create_saved_deck("テストデッキ", {"disaster_type": "地震"})
    repo.conn.execute(
        "INSERT INTO versions(label, note, kind, data, counts, data_hash, created_at) "
        "VALUES('v1', '', 'manual', '{}', '{}', 'h', '2026-01-01T00:00:00Z')"
    )

    repo.clear_all(include_saved=False)
    assert repo.list_events() == []
    assert len(repo.list_saved_searches()) == 1
    assert len(repo.list_saved_decks()) == 1
    assert get_counter(repo.conn, "EV") == 1

    repo.clear_all(include_saved=True)
    assert repo.list_saved_searches() == []
    assert repo.list_saved_decks() == []
    v_count = repo.conn.execute("SELECT COUNT(*) FROM versions").fetchone()[0]
    assert v_count == 1
    assert get_counter(repo.conn, "EV") == 1


def test_re_11_migration_from_older_schema_version(tmp_path: Path):
    """RE-11: 古い schema_version のDBを開く → マイグレーションを実行し、データを保持する."""
    db_file = tmp_path / "old_schema.db"
    raw_conn = sqlite3.connect(str(db_file))
    raw_conn.execute(
        "CREATE TABLE cards_event (card_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    raw_conn.execute(
        "CREATE TABLE saved_decks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, conditions TEXT NOT NULL, manual_order TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    raw_conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    raw_conn.execute("INSERT INTO meta(key, value) VALUES('schema_version', '0')")
    raw_conn.execute(
        "INSERT INTO cards_event VALUES('EV-001', '{\"card_id\":\"EV-001\",\"event_name\":\"旧データ\"}', '2026-01-01', '2026-01-01')"
    )
    raw_conn.commit()
    raw_conn.close()

    migrated_conn = connect(db_file)
    repo = Repository(migrated_conn)
    ver = migrated_conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()["value"]
    assert ver == "1"
    events = repo.list_events()
    assert len(events) == 1
    assert events[0]["event_name"] == "旧データ"
    migrated_conn.close()


def test_re_12_saved_searches_and_decks_crud(repo: Repository):
    """RE-12: 保存済み検索・デッキの作成・取得・更新・削除 → 期待どおり."""
    ss = repo.create_saved_search("検索1", {"keyword": "毛布"}, ["EV-001"])
    assert ss["name"] == "検索1"
    assert len(repo.list_saved_searches()) == 1
    repo.delete_saved_search(ss["id"])
    assert repo.list_saved_searches() == []
    with pytest.raises(NotFoundError):
        repo.delete_saved_search(ss["id"])

    sd = repo.create_saved_deck(
        "デッキ1",
        {"disaster_type": "地震"},
        manual_order=["EV-001"],
        resolutions={"EV-008": "keep"},
        content_hash="abc123",
    )
    assert sd["name"] == "デッキ1"
    assert sd["content_hash"] == "abc123"
    updated_sd = repo.update_saved_deck(sd["id"], name="デッキ1改", content_hash="def456")
    assert updated_sd["name"] == "デッキ1改"
    assert updated_sd["content_hash"] == "def456"
    repo.delete_saved_deck(sd["id"])
    assert repo.list_saved_decks() == []


def test_re_13_Reject_id_modification_on_update(repo: Repository, s2_payload: dict):
    """RE-13: IDを変更しようとする（PUT の本文の ID がURLと違う）→ 拒否する."""
    e1 = repo.create_event(copy.deepcopy(s2_payload["cards_event"][0]))
    bad_ev = copy.deepcopy(e1)
    bad_ev["card_id"] = "EV-999"
    with pytest.raises(ValidationError) as exc_info:
        repo.update_event(e1["card_id"], bad_ev)
    assert any(err.field == "card_id" for err in exc_info.value.errors)

    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    saved = repo.save_household(grp, [m1], is_create=True)
    bad_grp = copy.deepcopy(saved["group"])
    bad_grp["group_id"] = "GRP-999"
    with pytest.raises(ValidationError) as exc_info2:
        repo.save_household(bad_grp, saved["members"], expected_group_id=saved["group"]["group_id"])
    assert any(err.field == "group_id" for err in exc_info2.value.errors)
