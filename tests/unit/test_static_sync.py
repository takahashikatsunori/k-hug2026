"""static_sync.py (Web公開用 data/cards_db.json エクスポート機能) の単体テスト."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3

from hugdb.io_json import import_json_payloads
from hugdb.repository import Repository
from hugdb.static_sync import build_static_db_payload, sync_static_db_json


def test_build_static_db_payload_includes_all_entities(
    db_conn: sqlite3.Connection,
    s2_payload: dict,
) -> None:
    """SQLite DBからイベント・世帯・保存済みデッキ・画像メタデータ・スキーマを含む辞書を構築できる."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    repo = Repository(db_conn)
    repo.create_saved_deck(
        name="テスト保存デッキ",
        conditions={"disaster_type": "地震"},
        manual_order=["EV-001", "GRP-001"],
    )

    payload = build_static_db_payload(db_conn)
    assert payload["version"] == "6.2"
    assert len(payload["cards_event"]) == len(s2_payload["cards_event"])
    assert len(payload["evacuee_groups"]) == len(s2_payload["evacuee_groups"])
    assert len(payload["group_members"]) == len(s2_payload["group_members"])
    assert len(payload["saved_decks"]) == 1
    assert payload["saved_decks"][0]["name"] == "テスト保存デッキ"
    assert payload["saved_decks"][0]["manual_order"] == ["EV-001", "GRP-001"]
    assert "options" in payload["schema"]
    assert "events" in payload["schema"]
    assert "groups" in payload["schema"]
    assert "members" in payload["schema"]


def test_sync_static_db_json_writes_file(
    db_conn: sqlite3.Connection,
    s2_payload: dict,
    tmp_path: Path,
) -> None:
    """指定パスへ cards_db.json を書き出し、有効なJSONとして読み込める."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    out_file = tmp_path / "cards_db.json"
    result_path = sync_static_db_json(db_conn, out_path=out_file)
    assert result_path == out_file
    assert out_file.exists()

    loaded = json.loads(out_file.read_text(encoding="utf-8"))
    assert loaded["version"] == "6.2"
    assert len(loaded["cards_event"]) == len(s2_payload["cards_event"])
