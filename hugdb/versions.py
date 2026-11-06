"""データベースのバージョン管理（手動作成・自動作成・上限整理・差分・復元）モジュール."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from typing import Any, Literal

from hugdb import config
from hugdb.db import transaction
from hugdb.ids import sync_counters_with_existing
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.schema import order_record_keys
from hugdb.validation import Issue, ValidationContext, validate

VersionKind = Literal["manual", "auto_import", "auto_clear", "auto_restore"]
VALID_VERSION_KINDS: set[str] = {"manual", "auto_import", "auto_clear", "auto_restore"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _build_snapshot_payload(repo: Repository) -> tuple[dict[str, list[dict[str, Any]]], dict[str, int], str]:
    events = repo.list_events()
    groups = repo.list_groups()
    members = repo.list_members()

    payload = {
        "cards_event": events,
        "evacuee_groups": groups,
        "group_members": members,
    }
    counts = {
        "events": len(events),
        "groups": len(groups),
        "members": len(members),
        "persons": sum(1 for m in members if m.get("data_type") == "人物"),
        "pets": sum(1 for m in members if m.get("data_type") == "ペット"),
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    data_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return payload, counts, data_hash


def _format_version_row(row: sqlite3.Row, *, include_data: bool = False) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": row["id"],
        "label": row["label"],
        "note": row["note"] or "",
        "kind": row["kind"],
        "counts": json.loads(row["counts"]),
        "data_hash": row["data_hash"],
        "created_at": row["created_at"],
    }
    if include_data:
        item["data"] = json.loads(row["data"])
    return item


def prune_auto_versions(conn: sqlite3.Connection, limit: int | None = None) -> int:
    """自動作成バージョンが上限件数を超えた場合、古いものから削除する（手動分は削除しない）."""
    max_keep = limit if limit is not None else config.AUTO_VERSION_LIMIT
    rows = conn.execute(
        "SELECT id FROM versions WHERE kind != 'manual' ORDER BY id DESC"
    ).fetchall()
    if len(rows) <= max_keep:
        return 0
    to_delete = [r["id"] for r in rows[max_keep:]]
    placeholders = ",".join("?" for _ in to_delete)
    conn.execute(f"DELETE FROM versions WHERE id IN ({placeholders})", to_delete)
    return len(to_delete)


def create_version(
    conn: sqlite3.Connection,
    label: str,
    note: str = "",
    kind: VersionKind = "manual",
) -> dict[str, Any]:
    """現在のDB状態のスナップショットをバージョンとして保存する."""
    if kind not in VALID_VERSION_KINDS:
        raise ValueError(f"不正なバージョン種別です: {kind}")
    if not label or not str(label).strip():
        raise ValidationError([Issue(field="label", message="バージョン名は必須です")])

    repo = Repository(conn)
    payload, counts, data_hash = _build_snapshot_payload(repo)

    with transaction(conn):
        # 自動作成分で直前のバージョンと内容が全く同じ場合はスキップする (VE-07)
        if kind != "manual":
            latest = conn.execute(
                "SELECT id, label, note, kind, counts, data_hash, created_at "
                "FROM versions ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if latest is not None and latest["data_hash"] == data_hash:
                ver_dict = _format_version_row(latest)
                ver_dict["skipped"] = True
                return ver_dict

        now = _now_iso()
        cur = conn.execute(
            "INSERT INTO versions(label, note, kind, data, counts, data_hash, created_at) "
            "VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                str(label).strip(),
                str(note or ""),
                kind,
                json.dumps(payload, ensure_ascii=False),
                json.dumps(counts, ensure_ascii=False),
                data_hash,
                now,
            ),
        )
        ver_id = int(cur.lastrowid)  # type: ignore[arg-type]

        if kind != "manual":
            prune_auto_versions(conn)

        created = get_version(conn, ver_id)
        assert created is not None
        created["skipped"] = False
        return created


def list_versions(conn: sqlite3.Connection, kind: str | None = None) -> list[dict[str, Any]]:
    """バージョンの一覧を新しい順（id DESC）で返す。種別での絞り込みに対応."""
    if kind is None or kind == "" or kind == "all":
        rows = conn.execute(
            "SELECT id, label, note, kind, counts, data_hash, created_at "
            "FROM versions ORDER BY id DESC"
        ).fetchall()
    elif kind == "auto":
        rows = conn.execute(
            "SELECT id, label, note, kind, counts, data_hash, created_at "
            "FROM versions WHERE kind != 'manual' ORDER BY id DESC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, label, note, kind, counts, data_hash, created_at "
            "FROM versions WHERE kind = ? ORDER BY id DESC",
            (kind,),
        ).fetchall()
    return [_format_version_row(r) for r in rows]


def get_version(
    conn: sqlite3.Connection,
    version_id: int,
    *,
    include_data: bool = False,
) -> dict[str, Any] | None:
    cols = (
        "id, label, note, kind, data, counts, data_hash, created_at"
        if include_data
        else "id, label, note, kind, counts, data_hash, created_at"
    )
    row = conn.execute(
        f"SELECT {cols} FROM versions WHERE id = ?",
        (version_id,),
    ).fetchone()
    if not row:
        return None
    return _format_version_row(row, include_data=include_data)


def update_version(
    conn: sqlite3.Connection,
    version_id: int,
    *,
    label: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    with transaction(conn):
        existing = get_version(conn, version_id)
        if existing is None:
            raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))

        new_label = label.strip() if label is not None else existing["label"]
        if not new_label:
            raise ValidationError([Issue(field="label", message="バージョン名は必須です")])
        new_note = note if note is not None else existing["note"]

        conn.execute(
            "UPDATE versions SET label = ?, note = ? WHERE id = ?",
            (new_label, new_note, version_id),
        )
        updated = get_version(conn, version_id)
        assert updated is not None
        return updated


def delete_version(conn: sqlite3.Connection, version_id: int) -> None:
    with transaction(conn):
        existing = get_version(conn, version_id)
        if existing is None:
            raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))
        conn.execute("DELETE FROM versions WHERE id = ?", (version_id,))


def export_version_json(conn: sqlite3.Connection, version_id: int) -> dict[str, list[dict[str, Any]]]:
    """指定バージョンのカードデータをサンプル形式の辞書で返す."""
    ver = get_version(conn, version_id, include_data=True)
    if ver is None:
        raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))
    data = ver["data"]
    return {
        "cards_event": [order_record_keys("event", e) for e in data.get("cards_event", [])],
        "evacuee_groups": [order_record_keys("group", g) for g in data.get("evacuee_groups", [])],
        "group_members": [order_record_keys("member", m) for m in data.get("group_members", [])],
    }


def _diff_collection(
    ver_list: list[dict[str, Any]],
    cur_list: list[dict[str, Any]],
    id_key: str,
) -> dict[str, Any]:
    ver_map = {str(r[id_key]): r for r in ver_list if id_key in r}
    cur_map = {str(r[id_key]): r for r in cur_list if id_key in r}

    ver_ids = set(ver_map.keys())
    cur_ids = set(cur_map.keys())

    added = sorted(cur_ids - ver_ids)
    deleted = sorted(ver_ids - cur_ids)
    modified: list[dict[str, Any]] = []

    for rid in sorted(ver_ids & cur_ids):
        v_rec = ver_map[rid]
        c_rec = cur_map[rid]
        all_keys = list(dict.fromkeys(list(v_rec.keys()) + list(c_rec.keys())))
        changed_fields = [k for k in all_keys if v_rec.get(k) != c_rec.get(k)]
        if changed_fields:
            modified.append(
                {
                    "id": rid,
                    "fields": changed_fields,
                    "changed_fields": changed_fields,
                }
            )

    return {
        "added": added,
        "deleted": deleted,
        "modified": modified,
    }


def diff_version(conn: sqlite3.Connection, version_id: int) -> dict[str, Any]:
    """指定バージョンと現在のDB状態の差分を計算して返す (VE-09, VE-10)."""
    ver = get_version(conn, version_id, include_data=True)
    if ver is None:
        raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))

    repo = Repository(conn)
    cur_events = repo.list_events()
    cur_groups = repo.list_groups()
    cur_members = repo.list_members()

    v_data = ver["data"]
    ev_diff = _diff_collection(v_data.get("cards_event", []), cur_events, "card_id")
    grp_diff = _diff_collection(v_data.get("evacuee_groups", []), cur_groups, "group_id")
    mem_diff = _diff_collection(v_data.get("group_members", []), cur_members, "member_id")

    has_changes = any(
        bool(d["added"] or d["deleted"] or d["modified"])
        for d in (ev_diff, grp_diff, mem_diff)
    )

    return {
        "version_id": version_id,
        "has_changes": has_changes,
        "cards_event": ev_diff,
        "evacuee_groups": grp_diff,
        "group_members": mem_diff,
    }


def restore_version(conn: sqlite3.Connection, version_id: int) -> dict[str, Any]:
    """指定バージョンの状態にDBを復元する（直前に auto_restore を自動作成し、失敗時は全ロールバック）."""
    with transaction(conn):
        row = conn.execute(
            "SELECT id, label, note, kind, data, counts, data_hash, created_at "
            "FROM versions WHERE id = ?",
            (version_id,),
        ).fetchone()
        if not row:
            raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))

        # 現在の状態を auto_restore として保存
        auto_ver = create_version(
            conn,
            label=f"復元前の自動保存（#{version_id} 復元時）",
            note=f"バージョン #{version_id} ({row['label']}) への復元直前に自動作成",
            kind="auto_restore",
        )

        try:
            raw_data = json.loads(row["data"])
        except Exception as exc:
            raise ValidationError([Issue(field="data", message=f"バージョンデータが破損しています: {exc}")]) from exc

        if not isinstance(raw_data, dict):
            raise ValidationError([Issue(field="data", message="バージョンデータの構造が不正です")])

        raw_events = raw_data.get("cards_event", [])
        raw_groups = raw_data.get("evacuee_groups", [])
        raw_members = raw_data.get("group_members", [])
        if (
            not isinstance(raw_events, list)
            or not isinstance(raw_groups, list)
            or not isinstance(raw_members, list)
        ):
            raise ValidationError([Issue(field="data", message="バージョンデータのコレクションが配列ではありません")])

        # lenient モードで検証（構造エラーがあればロールバックさせる: VE-15）
        seen_ev: set[str] = set()
        seen_grp: set[str] = set()
        seen_mem: set[str] = set()

        ev_ids = {
            str(e.get("card_id"))
            for e in raw_events
            if isinstance(e, dict) and e.get("card_id")
        }
        grp_ids = {
            str(g.get("group_id"))
            for g in raw_groups
            if isinstance(g, dict) and g.get("group_id")
        }
        prereq_map = {
            str(e.get("card_id")): e.get("prerequisite_card_id")
            for e in raw_events
            if isinstance(e, dict) and e.get("card_id")
        }

        norm_events: list[dict[str, Any]] = []
        for ev in raw_events:
            rep = validate(
                "event",
                ev,
                ValidationContext(
                    known_event_ids=ev_ids,
                    seen_ids=seen_ev,
                    prerequisite_map=prereq_map,
                ),
                mode="lenient",
            )
            if not rep.ok or not rep.normalized.get("card_id"):
                raise ValidationError(
                    rep.errors or [Issue(field="card_id", message="イベントのcard_idが不正です")]
                )
            norm_events.append(rep.normalized)

        norm_members: list[dict[str, Any]] = []
        members_by_group: dict[str, list[dict[str, Any]]] = {gid: [] for gid in grp_ids}
        for mem in raw_members:
            rep = validate(
                "member",
                mem,
                ValidationContext(known_group_ids=grp_ids, seen_ids=seen_mem),
                mode="lenient",
            )
            if not rep.ok or not rep.normalized.get("member_id"):
                raise ValidationError(
                    rep.errors or [Issue(field="member_id", message="構成員のmember_idが不正です")]
                )
            norm_members.append(rep.normalized)
            gid = rep.normalized["group_id"]
            members_by_group.setdefault(gid, []).append(rep.normalized)

        norm_groups: list[dict[str, Any]] = []
        for grp in raw_groups:
            gid = str(grp.get("group_id") or "") if isinstance(grp, dict) else ""
            rep = validate(
                "group",
                grp,
                ValidationContext(
                    seen_ids=seen_grp,
                    group_members=members_by_group.get(gid, []),
                ),
                mode="lenient",
            )
            if not rep.ok or not rep.normalized.get("group_id"):
                raise ValidationError(
                    rep.errors or [Issue(field="group_id", message="グループのgroup_idが不正です")]
                )
            norm_groups.append(rep.normalized)

        # 3テーブルを全件削除して復元データを投入
        conn.execute("DELETE FROM group_members")
        conn.execute("DELETE FROM evacuee_groups")
        conn.execute("DELETE FROM cards_event")

        now = _now_iso()
        for ev in norm_events:
            conn.execute(
                "INSERT INTO cards_event(card_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)",
                (ev["card_id"], json.dumps(ev, ensure_ascii=False), now, now),
            )
        for grp in norm_groups:
            conn.execute(
                "INSERT INTO evacuee_groups(group_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)",
                (grp["group_id"], json.dumps(grp, ensure_ascii=False), now, now),
            )
        for mem in norm_members:
            conn.execute(
                "INSERT INTO group_members(member_id, group_id, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
                (
                    mem["member_id"],
                    mem["group_id"],
                    json.dumps(mem, ensure_ascii=False),
                    now,
                    now,
                ),
            )

        # 採番カウンタを同期（減らさない: VE-11）
        sync_counters_with_existing(conn)
        prune_auto_versions(conn)

        return {
            "restored_version_id": version_id,
            "auto_version": auto_ver,
            "counts": {
                "events": len(norm_events),
                "groups": len(norm_groups),
                "members": len(norm_members),
            },
        }
