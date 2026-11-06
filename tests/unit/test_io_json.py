"""単体テスト: JSON 入出力 (IJ-01 〜 IJ-21)."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sqlite3

import pytest

from hugdb import config
from hugdb.filtering import SearchQuery, execute_search
from hugdb.io_json import (
    PayloadTooLargeError,
    export_all_json,
    export_search_json,
    import_demo_data,
    import_json_files,
    import_json_payloads,
)
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.versions import list_versions

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
S2_PATH = FIXTURES_DIR / "sample_format2.json"
SPLIT_EV_GRP_PATH = FIXTURES_DIR / "events_groups_only.json"
SPLIT_MEM_PATH = FIXTURES_DIR / "members_only.json"


def test_ij_01_replace_import_and_export_exact_roundtrip(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-01: S2 を置換インポートしてエクスポートする → 元の S2 と JSON として完全に一致する（キーの順序も含む）."""
    rep = import_json_payloads(db_conn, [s2_payload], mode="replace", dry_run=False)
    assert rep.ok is True
    exported = export_all_json(db_conn)
    assert json.dumps(exported, ensure_ascii=False) == json.dumps(s2_payload, ensure_ascii=False)


def test_ij_02_split_files_replace_import(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-02: 分割ファイル（イベント＋グループ / 構成員）を同時にインポート → 1つのファイルのときと同じ結果."""
    files = [
        ("events_groups_only.json", SPLIT_EV_GRP_PATH.read_bytes()),
        ("members_only.json", SPLIT_MEM_PATH.read_bytes()),
    ]
    rep = import_json_files(db_conn, files, mode="replace", dry_run=False)
    assert rep.ok is True
    assert rep.counts == {"events": 20, "groups": 10, "members": 21}
    exported = export_all_json(db_conn)
    assert exported == s2_payload


def test_ij_03_split_files_append_import(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-03: 分割ファイルを同時に追加インポート → 振り直した後も紐付けが保たれる."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    files = [
        ("events_groups_only.json", SPLIT_EV_GRP_PATH.read_bytes()),
        ("members_only.json", SPLIT_MEM_PATH.read_bytes()),
    ]
    rep = import_json_files(db_conn, files, mode="append")
    assert rep.ok is True
    assert rep.counts == {"events": 20, "groups": 10, "members": 21}
    repo = Repository(db_conn)
    assert len(repo.list_events()) == 40
    assert len(repo.list_groups()) == 20
    assert len(repo.list_members()) == 42
    # 新しいグループ GRP-011 にも構成員2名が正しく紐付いている
    assert len(repo.list_members("GRP-011")) == 2


def test_ij_04_members_only_append_import_error(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-04: 構成員のファイルだけを追加インポート → 所属グループが無いのでエラー（ID-14）."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    with pytest.raises(ValidationError):
        import_json_files(
            db_conn,
            [("members_only.json", SPLIT_MEM_PATH.read_bytes())],
            mode="append",
        )
    assert len(Repository(db_conn).list_members()) == 21


def test_ij_05_members_only_replace_import_error_and_unchanged(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-05: 構成員のファイルだけを置換インポートしようとする → グループが無いのでエラーになり、何も変更しない."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    with pytest.raises(ValidationError):
        import_json_files(
            db_conn,
            [("members_only.json", SPLIT_MEM_PATH.read_bytes())],
            mode="replace",
        )
    assert len(Repository(db_conn).list_events()) == 20
    assert len(Repository(db_conn).list_groups()) == 10


def test_ij_06_duplicate_id_within_file_in_replace_mode(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-06: 置換モードでファイル内のIDが重複 → エラーになり、何も変更しない."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    dup_payload = {
        "cards_event": [
            copy.deepcopy(s2_payload["cards_event"][0]),
            copy.deepcopy(s2_payload["cards_event"][0]),
        ],
        "evacuee_groups": [],
        "group_members": [],
    }
    with pytest.raises(ValidationError) as exc_info:
        import_json_payloads(db_conn, [dup_payload], mode="replace")
    assert any(e.field == "card_id" for e in exc_info.value.errors)
    assert len(Repository(db_conn).list_events()) == 20


def test_ij_07_duplicate_id_across_multiple_files_replace_vs_append(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-07: 複数ファイルの間でIDが重複 → 置換ではエラー、追加では別々のIDに振り直す（警告付き）."""
    p1 = {"cards_event": [copy.deepcopy(s2_payload["cards_event"][0])], "evacuee_groups": [], "group_members": []}
    p2 = {"cards_event": [copy.deepcopy(s2_payload["cards_event"][0])], "evacuee_groups": [], "group_members": []}

    with pytest.raises(ValidationError):
        import_json_payloads(db_conn, [p1, p2], mode="replace")

    rep_append = import_json_payloads(db_conn, [p1, p2], mode="append")
    assert rep_append.ok is True
    assert rep_append.counts["events"] == 2
    assert any(w.field == "card_id" for w in rep_append.warnings)
    events = Repository(db_conn).list_events()
    assert [e["card_id"] for e in events] == ["EV-001", "EV-002"]


def test_ij_08_append_s2_twice(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-08: S2 を追加インポートで2回 → 計 40/20/42 件で、IDの重複なし."""
    import_json_payloads(db_conn, [s2_payload], mode="append")
    import_json_payloads(db_conn, [s2_payload], mode="append")
    repo = Repository(db_conn)
    assert len(repo.list_events()) == 40
    assert len(repo.list_groups()) == 20
    assert len(repo.list_members()) == 42


def test_ij_09_dry_run_does_not_modify_db(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-09: ドライランを行う → DBは変わらず、件数・対応表・警告を返す."""
    rep = import_json_payloads(db_conn, [s2_payload], mode="append", dry_run=True)
    assert rep.dry_run is True
    assert rep.counts == {"events": 20, "groups": 10, "members": 21}
    assert len(rep.id_map) == 51
    assert Repository(db_conn).list_events() == []


def test_ij_10_dry_run_id_map_matches_commit(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-10: ドライランの対応表と実際に確定した結果 → 一致する."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    dry_rep = import_json_payloads(db_conn, [s2_payload], mode="append", dry_run=True)
    commit_rep = import_json_payloads(db_conn, [s2_payload], mode="append", dry_run=False)
    assert dry_rep.id_map == commit_rep.id_map
    assert dry_rep.counts == commit_rep.counts


def test_ij_11_invalid_json_or_top_level_array_or_no_keys(db_conn: sqlite3.Connection):
    """IJ-11: JSON として不正 / 最上位が配列 / キーが1つも無い → 内容が分かるエラーメッセージ."""
    for bad_bytes in (b"{broken", b"[1, 2, 3]", b'{"unrelated_key": []}'):
        with pytest.raises(ValidationError) as exc_info:
            import_json_files(db_conn, [("bad.json", bad_bytes)], mode="replace")
        assert len(exc_info.value.errors) >= 1


def test_ij_12_corrupt_row_and_cascading_exclusion(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-12: 必須の構造が壊れた行 → その行だけ除外し、関連する行も連鎖して除外する."""
    data = copy.deepcopy(s2_payload)
    # GRP-001 の member_count を数値変換不能にしてグループを構造エラーにする → M-0001, M-0002 も連鎖除外される
    data["evacuee_groups"][0]["member_count"] = "not-a-number"
    # M-0003 の group_id を空にする → M-0003 だけ除外される
    data["group_members"][2]["group_id"] = ""

    rep = import_json_payloads(db_conn, [data], mode="replace")
    assert rep.counts["groups"] == 9
    assert rep.counts["members"] == 18  # 21 - 2(GRP-001連鎖) - 1(M-0003)
    assert len(rep.errors) >= 3


def test_ij_13_dependent_on_excluded_event_nullifies_prerequisite(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-13: 除外したイベントを前提にしているイベント → 前提を null にして警告を出す."""
    data = copy.deepcopy(s2_payload)
    # EV-001 を構造エラーで除外させると、EV-002 (prereq=EV-001) の前提が null になり警告が出る
    data["cards_event"][0]["priority"] = "broken"
    rep = import_json_payloads(db_conn, [data], mode="replace")
    assert rep.counts["events"] == 19
    ev2 = Repository(db_conn).get_event("EV-002")
    assert ev2 is not None
    assert ev2["prerequisite_card_id"] is None
    assert any(w.field == "prerequisite_card_id" and w.record_id == "EV-002" for w in rep.warnings)


def test_ij_14_replace_mode_missing_event_id_auto_allocated_with_warning(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """IJ-14: 置換モードでIDが無いイベント → 新しいIDを採番し、警告を出す."""
    ev = copy.deepcopy(s2_payload["cards_event"][0])
    del ev["card_id"]
    rep = import_json_payloads(db_conn, [{"cards_event": [ev]}], mode="replace")
    assert rep.counts["events"] == 1
    assert any(w.field == "card_id" for w in rep.warnings)
    assert Repository(db_conn).get_event("EV-001") is not None


def test_ij_15_auto_version_created_before_import_but_not_on_dry_run(
    db_conn: sqlite3.Connection, s2_payload: dict
):
    """IJ-15: インポートの直前にバージョンを自動作成 → auto_import が1件増える（ドライランでは作らない）."""
    import_json_payloads(db_conn, [s2_payload], mode="replace", dry_run=True)
    assert list_versions(db_conn) == []

    import_json_payloads(db_conn, [s2_payload], mode="replace", dry_run=False)
    versions = list_versions(db_conn)
    assert len(versions) == 1
    assert versions[0]["kind"] == "auto_import"


def test_ij_16_import_demo_replace_and_append(db_conn: sqlite3.Connection):
    """IJ-16: デモの読み込み → config.SAMPLE_PATH から読み込む。置換と追加の両方で動く."""
    r1 = import_demo_data(db_conn, mode="replace")
    assert r1.counts == {"events": 20, "groups": 10, "members": 21}

    r2 = import_demo_data(db_conn, mode="append")
    assert r2.counts == {"events": 20, "groups": 10, "members": 21}
    assert len(Repository(db_conn).list_events()) == 40


def test_ij_17_import_demo_missing_file_raises_not_found(db_conn: sqlite3.Connection, tmp_path: Path):
    """IJ-17: デモファイルが無い → NotFoundError (APIでは 404)."""
    with pytest.raises(NotFoundError):
        import_demo_data(db_conn, sample_path=tmp_path / "nonexistent_demo.json")


def test_ij_18_export_search_results_includes_household_members(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-18: 検索結果のエクスポート（世帯を含む） → 世帯の構成員も含めた、サンプル形式の3つのキーで出力する."""
    res = execute_search(
        SearchQuery(keyword="授乳室"),
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    exp = export_search_json(res, s2_payload["evacuee_groups"], s2_payload["group_members"])
    assert set(exp.keys()) == {"cards_event", "evacuee_groups", "group_members"}
    assert [g["group_id"] for g in exp["evacuee_groups"]] == ["GRP-002"]
    assert len(exp["group_members"]) == 3


def test_ij_19_utf8_bom_json_import(db_conn: sqlite3.Connection, s2_payload: dict):
    """IJ-19: 文字コード: BOM 付きの UTF-8 JSON → 読み込める."""
    bom_bytes = ("\ufeff" + json.dumps(s2_payload, ensure_ascii=False)).encode("utf-8")
    rep = import_json_files(db_conn, [("bom.json", bom_bytes)], mode="replace")
    assert rep.counts == {"events": 20, "groups": 10, "members": 21}


def test_ij_20_empty_file_and_oversized_file(db_conn: sqlite3.Connection):
    """IJ-20: ファイルが空 / 10MB を超える → エラー / PayloadTooLargeError (413)."""
    with pytest.raises(ValidationError):
        import_json_files(db_conn, [("empty.json", b"")], mode="replace")

    huge = b" " * (config.MAX_IMPORT_BYTES + 10)
    with pytest.raises(PayloadTooLargeError):
        import_json_files(db_conn, [("huge.json", huge)], mode="replace")


def test_ij_21_docs_sample_format2_loads_cleanly(db_conn: sqlite3.Connection):
    """IJ-21: 実際の docs のサンプル（docs/sample_format2.json）を lenient で読み込む → エラー0件."""
    rep = import_demo_data(db_conn, mode="replace")
    assert rep.errors == []
