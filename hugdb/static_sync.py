"""GitHub Pages / Web版デッキ構築ページ用の静的データベースJSON (data/cards_db.json) 同期モジュール."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any

from hugdb import config
from hugdb.names import fill_household_names
from hugdb.repository import Repository
from hugdb.schema import schema_to_dict


def build_static_db_payload(conn: sqlite3.Connection) -> dict[str, Any]:
    """現在のSQLiteデータベースからWeb公開用の静的JSONペイロードを構築する."""
    repo = Repository(conn)
    events = repo.list_events()
    groups = repo.list_groups()
    members = repo.list_members()
    saved_decks = repo.list_saved_decks()

    # 世帯ごとの構成員氏名を決定論的に補完
    group_map = {g["group_id"]: g for g in groups}
    members_by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in groups}
    for m in members:
        gid = m.get("group_id")
        if gid in members_by_group:
            members_by_group[gid].append(m)

    filled_members: list[dict[str, Any]] = []
    for m in members:
        gid = m.get("group_id")
        grp = group_map.get(gid)
        if grp:
            filled_list = fill_household_names(grp, [m])
            filled_members.append(filled_list[0])
        else:
            filled_members.append(m)

    # 画像メタ情報
    img_rows = conn.execute(
        "SELECT target_id, mime_type, sha256, updated_at FROM card_images ORDER BY target_id"
    ).fetchall()
    mime_to_ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }
    image_ids: list[str] = []
    image_meta: dict[str, dict[str, str]] = {}
    for r in img_rows:
        tid = str(r["target_id"])
        image_ids.append(tid)
        ext = mime_to_ext.get(str(r["mime_type"]).lower(), ".png")
        image_meta[tid] = {
            "ext": ext,
            "sha256": str(r["sha256"] or "")[:12],
            "updated_at": str(r["updated_at"] or ""),
        }

    return {
        "version": "6.2",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema": schema_to_dict(),
        "cards_event": events,
        "evacuee_groups": groups,
        "group_members": filled_members,
        "saved_decks": saved_decks,
        "image_ids": image_ids,
        "image_meta": image_meta,
    }


def sync_static_db_json(
    conn: sqlite3.Connection,
    out_path: Path | str | None = None,
) -> Path:
    """data/cards_db.json を最新のDB内容で書き出す."""
    target = Path(out_path) if out_path is not None else (config.DATA_DIR / "cards_db.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = build_static_db_payload(conn)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    target.write_text(raw, encoding="utf-8")
    return target
