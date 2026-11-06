"""単体テスト: バージョン管理 (VE-01 〜 VE-18)."""
from __future__ import annotations

import sqlite3

import pytest

from hugdb.deck import build_deck, inspect_saved_deck
from hugdb.ids import get_counter
from hugdb.io_json import export_all_json, import_json_payloads
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.versions import (
    create_version,
    delete_version,
    diff_version,
    export_version_json,
    list_versions,
    restore_version,
    update_version,
)


def test_ve_01_create_manual_version(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-01: 手動で作成（名前・メモ付き） → kind=manual、件数とハッシュを記録する."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    ver = create_version(db_conn, label="初期状態", note="S2投入直後", kind="manual")
    assert ver["kind"] == "manual"
    assert ver["label"] == "初期状態"
    assert ver["note"] == "S2投入直後"
    assert ver["counts"]["events"] == 20
    assert ver["counts"]["groups"] == 10
    assert ver["counts"]["members"] == 21
    assert len(ver["data_hash"]) == 64


def test_ve_02_empty_label_raises_error(db_conn: sqlite3.Connection):
    """VE-02: 名前が空 → エラー."""
    with pytest.raises(ValidationError):
        create_version(db_conn, label="   ", kind="manual")


def test_ve_03_create_edit_and_restore_matches_original(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-03: 作成 → 編集 → 復元 → 作成した時点のデータと完全に一致する（エクスポートで比較）."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    before_export = export_all_json(db_conn)
    ver = create_version(db_conn, label="v1", kind="manual")

    repo = Repository(db_conn)
    repo.delete_event("EV-020")
    repo.delete_household("GRP-010")
    assert len(repo.list_events()) == 19

    restore_version(db_conn, ver["id"])
    after_export = export_all_json(db_conn)
    assert after_export == before_export


def test_ve_04_auto_restore_created_before_restore_allows_undo(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-04: 復元の直前に自動で作成 → auto_restore ができ、それを復元すると復元前の状態に戻る（取り消し）."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="v1（20件）", kind="manual")

    repo = Repository(db_conn)
    repo.delete_event("EV-020")
    assert len(repo.list_events()) == 19

    res = restore_version(db_conn, v1["id"])
    assert len(repo.list_events()) == 20
    auto_v = res["auto_version"]
    assert auto_v["kind"] == "auto_restore"
    assert auto_v["skipped"] is False

    # auto_restore を復元すると削除後の19件に戻る
    restore_version(db_conn, auto_v["id"])
    assert len(repo.list_events()) == 19


def test_ve_05_auto_clear_before_clear_all(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-05: 全件削除の直前に自動で作成 → auto_clear ができ、それを復元すると削除前に戻る."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    repo = Repository(db_conn)

    auto_clear = create_version(db_conn, label="全件削除前の自動保存", kind="auto_clear")
    repo.clear_all()
    assert repo.list_events() == []

    restore_version(db_conn, auto_clear["id"])
    assert len(repo.list_events()) == 20


def test_ve_06_auto_versions_pruned_at_20_while_manual_kept(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-06: 自動作成分が21件目になる → 最も古い自動作成分を削除して20件にする。手動分は削除しない."""
    repo = Repository(db_conn)
    manual_v = create_version(db_conn, label="手動保存1", kind="manual")

    ev_template = s2_payload["cards_event"][0]
    for i in range(21):
        ev = dict(ev_template)
        ev["event_name"] = f"イベント{i}"
        repo.create_event(ev)
        create_version(db_conn, label=f"自動{i+1}", kind="auto_import")

    all_vers = list_versions(db_conn)
    auto_vers = [v for v in all_vers if v["kind"] != "manual"]
    manual_vers = [v for v in all_vers if v["kind"] == "manual"]

    assert len(auto_vers) == 20
    assert len(manual_vers) == 1
    assert manual_vers[0]["id"] == manual_v["id"]
    assert "自動1" not in {v["label"] for v in auto_vers}


def test_ve_07_skip_duplicate_auto_version_but_allow_manual(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-07: 直前のバージョンと内容が同じときの自動作成 → 作成しない（skipped）。手動の場合は作成する."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    # import_json_payloads の中で空DBの auto_import が1件作られているので、現在のS2状態で1件作る
    v_auto1 = create_version(db_conn, label="auto1", kind="auto_import")
    assert v_auto1["skipped"] is False

    v_auto2 = create_version(db_conn, label="auto2", kind="auto_import")
    assert v_auto2["skipped"] is True
    assert v_auto2["id"] == v_auto1["id"]

    v_man = create_version(db_conn, label="manual1", kind="manual")
    assert v_man["skipped"] is False
    assert v_man["id"] != v_auto1["id"]


def test_ve_08_manual_version_on_empty_db_and_restore(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-08: 空のDBで手動作成 → 0件のバージョンができ、それを復元すると空に戻る."""
    v_empty = create_version(db_conn, label="空DB", kind="manual")
    assert v_empty["counts"] == {"events": 0, "groups": 0, "members": 0, "persons": 0, "pets": 0}

    import_json_payloads(db_conn, [s2_payload], mode="replace")
    assert len(Repository(db_conn).list_events()) == 20

    restore_version(db_conn, v_empty["id"])
    assert Repository(db_conn).list_events() == []


def test_ve_09_diff_shows_added_deleted_and_modified_fields(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-09: 差分 → 追加・削除・変更のIDと、変更された項目名を返す."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="基準バージョン", kind="manual")

    repo = Repository(db_conn)
    repo.delete_event("EV-020")
    ev2 = repo.get_event("EV-002")
    assert ev2 is not None
    ev2["event_name"] = "総合受付の設置（変更後）"
    repo.update_event("EV-002", ev2)
    new_ev = repo.create_event(s2_payload["cards_event"][0])

    d = diff_version(db_conn, v1["id"])
    assert d["has_changes"] is True
    assert d["cards_event"]["added"] == [new_ev["card_id"]]
    assert d["cards_event"]["deleted"] == ["EV-020"]
    assert len(d["cards_event"]["modified"]) == 1
    assert d["cards_event"]["modified"][0]["id"] == "EV-002"
    assert "event_name" in d["cards_event"]["modified"][0]["changed_fields"]


def test_ve_10_diff_when_identical(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-10: 現在の状態と同じバージョンの差分 → 差分なし."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="同じ状態", kind="manual")
    d = diff_version(db_conn, v1["id"])
    assert d["has_changes"] is False
    assert d["cards_event"] == {"added": [], "deleted": [], "modified": []}


def test_ve_11_id_counter_does_not_decrease_after_restore(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-11: 復元後のID採番 → カウンタは減らず、使ったIDを再利用しない."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="20件時点", kind="manual")

    repo = Repository(db_conn)
    e21 = repo.create_event(s2_payload["cards_event"][0])
    assert e21["card_id"] == "EV-021"
    assert get_counter(db_conn, "EV") == 21

    restore_version(db_conn, v1["id"])
    assert get_counter(db_conn, "EV") == 21
    e22 = repo.create_event(s2_payload["cards_event"][0])
    assert e22["card_id"] == "EV-022"


def test_ve_12_saved_deck_detects_change_after_restore(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-12: 復元後の保存済みデッキ → ハッシュが変わり、DE-20 と同じく再計算の通知が出る."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="v1", kind="manual")

    repo = Repository(db_conn)
    repo.create_event(s2_payload["cards_event"][0])
    deck_now = build_deck(repo.list_events(), repo.list_groups(), repo.list_members())
    saved_deck = repo.create_saved_deck("21件デッキ", {}, content_hash=deck_now.content_hash)

    restore_version(db_conn, v1["id"])
    inspected = inspect_saved_deck(
        saved_deck,
        repo.list_events(),
        repo.list_groups(),
        repo.list_members(),
    )
    assert inspected["changed"] is True


def test_ve_13_saved_search_reports_missing_ids_after_restore(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-13: 復元後の保存済み検索 → 存在しなくなったIDを「削除済み (missing_ids)」として返す."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="v1", kind="manual")

    repo = Repository(db_conn)
    e21 = repo.create_event(s2_payload["cards_event"][0])
    ss = repo.create_saved_search("検索保存", {}, ["EV-001", e21["card_id"]])
    assert ss["missing_ids"] == []

    restore_version(db_conn, v1["id"])
    ss_after = repo.get_saved_search(ss["id"])
    assert ss_after is not None
    assert ss_after["missing_ids"] == ["EV-021"]


def test_ve_14_restore_nonexistent_version_raises_not_found(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-14: 存在しないバージョンを復元 → NotFoundError (404) になり、DBは変わらない."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    with pytest.raises(NotFoundError):
        restore_version(db_conn, 99999)
    assert len(Repository(db_conn).list_events()) == 20


def test_ve_15_restore_failure_rolls_back_db_and_auto_restore(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """VE-15: 復元の途中で失敗する（壊れたデータを故意に入れる） → ロールバックしてDBも自動作成分も変わらない."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    # 壊れたレコードを持つバージョンを直接DBに挿入
    corrupt_json = '{"cards_event":[{"card_id":"EV-001","priority":"BROKEN"}],"evacuee_groups":[],"group_members":[]}'
    cur = db_conn.execute(
        "INSERT INTO versions(label, note, kind, data, counts, data_hash, created_at) "
        "VALUES('壊れた版', '', 'manual', ?, '{}', 'badhash', '2026-01-01T00:00:00Z')",
        (corrupt_json,),
    )
    corrupt_id = int(cur.lastrowid)  # type: ignore[arg-type]

    vers_before = list_versions(db_conn)
    with pytest.raises(ValidationError):
        restore_version(db_conn, corrupt_id)

    vers_after = list_versions(db_conn)
    assert len(vers_after) == len(vers_before)
    assert len(Repository(db_conn).list_events()) == 20


def test_ve_16_update_delete_and_export_version(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-16: 名前・メモの変更、削除、JSONでの出力 → 期待どおりに動く。出力はサンプル形式."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v1 = create_version(db_conn, label="旧名", note="旧メモ", kind="manual")

    updated = update_version(db_conn, v1["id"], label="新名", note="新メモ")
    assert updated["label"] == "新名"
    assert updated["note"] == "新メモ"

    exported = export_version_json(db_conn, v1["id"])
    assert exported == s2_payload

    delete_version(db_conn, v1["id"])
    assert all(v["id"] != v1["id"] for v in list_versions(db_conn))


def test_ve_17_clear_all_preserves_versions(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-17: 全件削除してもバージョンは残る → バージョンの一覧は変わらない."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    create_version(db_conn, label="保存版", kind="manual")
    before_ids = [v["id"] for v in list_versions(db_conn)]

    Repository(db_conn).clear_all(include_saved=True)
    after_ids = [v["id"] for v in list_versions(db_conn)]
    assert after_ids == before_ids


def test_ve_18_list_versions_order_and_filter_by_kind(db_conn: sqlite3.Connection, s2_payload: dict):
    """VE-18: 一覧の並び → 新しい順。種別で絞り込める."""
    v1 = create_version(db_conn, label="手動1", kind="manual")
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    v2 = create_version(db_conn, label="手動2", kind="manual")

    all_v = list_versions(db_conn)
    assert all_v[0]["id"] == v2["id"]
    assert all_v[-1]["id"] == v1["id"]

    manual_only = list_versions(db_conn, kind="manual")
    assert all(v["kind"] == "manual" for v in manual_only)

    auto_only = list_versions(db_conn, kind="auto")
    assert all(v["kind"] != "manual" for v in auto_only)
