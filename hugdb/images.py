"""カード用イラスト画像のデュアル管理（SQLite + data/images/）・バッチプロンプト生成・描画モデル変換モジュール."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
from typing import Any, Literal
import zipfile

from hugdb import config
from hugdb.db import transaction
from hugdb.ids import parse_id_number
from hugdb.names import fill_household_names
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.validation import Issue

CardTypeLabel = Literal["避難者", "ペット", "イベント"]
TargetKind = Literal["event", "person", "pet"]

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_VALID_TARGET_ID_RE = re.compile(r"^(EV-\d+|M-\d+)$", re.IGNORECASE)
_IMAGE_EXT_TO_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def get_images_dir_for_conn(conn: sqlite3.Connection) -> Path:
    """SQLite 接続が参照しているDBファイルの親フォルダ配下の images/ ディレクトリを返す."""
    try:
        rows = conn.execute("PRAGMA database_list").fetchall()
        for r in rows:
            if r["name"] == "main" and r["file"]:
                return config.get_images_dir(Path(r["file"]))
    except Exception:
        pass
    return config.get_images_dir()


def infer_target_kind(conn: sqlite3.Connection, target_id: str) -> TargetKind:
    """マスタID (EV-xxx / M-xxxx) から target_kind ('event' | 'person' | 'pet') を判定する."""
    tid = target_id.strip().upper()
    if tid.startswith("EV-"):
        return "event"
    if tid.startswith("M-"):
        row = conn.execute(
            "SELECT data FROM group_members WHERE member_id = ?", (tid,)
        ).fetchone()
        if row:
            try:
                m = json.loads(row["data"])
                if m.get("data_type") == "ペット":
                    return "pet"
            except Exception:
                pass
        return "person"
    raise ValidationError(
        [
            Issue(
                field="target_id",
                message=f"不正なカードID形式です: '{target_id}' (EV-xxx または M-xxxx を指定してください)",
                record_id=target_id,
            )
        ]
    )


def decode_base64_image(raw: str) -> tuple[bytes, str]:
    """Data URL または純粋な Base64 文字列から (bytes, mime_type) を取り出す."""
    s = (raw or "").strip()
    mime_type = "image/png"
    if s.startswith("data:"):
        header, _, b64_part = s.partition(",")
        if ";base64" in header:
            mime_candidate = header[5:].split(";")[0].strip()
            if mime_candidate:
                mime_type = mime_candidate
        s = b64_part
    try:
        data = base64.b64decode(s, validate=False)
    except Exception as exc:
        raise ValidationError(
            [Issue(field="image", message=f"Base64画像のデコードに失敗しました: {exc}")]
        ) from exc
    if not data:
        raise ValidationError([Issue(field="image", message="画像データが空です")])
    return data, mime_type


def _remove_disk_files_for_id(img_dir: Path, target_id: str) -> None:
    """指定IDに対応する data/images/{target_id}.* ファイルをすべて削除する."""
    for ext in _IMAGE_EXT_TO_MIME:
        p = img_dir / f"{target_id}{ext}"
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass


def _write_disk_file(img_dir: Path, target_id: str, data: bytes, mime_type: str = "image/png") -> Path:
    """data/images/{target_id}.png としてディスクに保存する."""
    ext = ".png"
    for k_ext, k_mime in _IMAGE_EXT_TO_MIME.items():
        if k_mime == mime_type:
            ext = k_ext
            break
    # 古い別拡張子ファイルがあれば掃除
    for k_ext in _IMAGE_EXT_TO_MIME:
        if k_ext != ext:
            old_p = img_dir / f"{target_id}{k_ext}"
            if old_p.exists():
                try:
                    old_p.unlink()
                except OSError:
                    pass
    out_path = img_dir / f"{target_id}{ext}"
    out_path.write_bytes(data)
    return out_path


def sync_images(conn: sqlite3.Connection) -> dict[str, int]:
    """SQLite `card_images` テーブルと `data/images/` フォルダを双方向同期する.

    1. フォルダ内に新規またはハッシュが異なる画像ファイル (`EV-xxx.png`, `M-xxxx.png` 等) があれば DB に取り込む。
    2. DB にあるがフォルダ内にファイルが存在しない場合は、DB の BLOB からフォルダへ書き出す。
    """
    img_dir = get_images_dir_for_conn(conn)
    imported_from_disk = 0
    restored_to_disk = 0

    db_rows = conn.execute(
        "SELECT target_id, target_kind, mime_type, image_data, sha256, updated_at FROM card_images"
    ).fetchall()
    db_map: dict[str, sqlite3.Row] = {r["target_id"]: r for r in db_rows}

    disk_files: dict[str, Path] = {}
    for p in sorted(img_dir.iterdir()):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext not in _IMAGE_EXT_TO_MIME:
            continue
        stem = p.stem.upper()
        if not _VALID_TARGET_ID_RE.match(stem):
            continue
        # .png を最優先
        if stem not in disk_files or ext == ".png":
            disk_files[stem] = p

    now = _now_iso()
    with transaction(conn):
        # 1. ディスク → DB 同期
        for tid, file_path in disk_files.items():
            try:
                raw_bytes = file_path.read_bytes()
            except OSError:
                continue
            if not raw_bytes:
                continue
            file_hash = _sha256_hex(raw_bytes)
            mime = _IMAGE_EXT_TO_MIME.get(file_path.suffix.lower(), "image/png")
            db_row = db_map.get(tid)
            if db_row is None or db_row["sha256"] != file_hash:
                kind = infer_target_kind(conn, tid)
                conn.execute(
                    """
                    INSERT INTO card_images(target_id, target_kind, mime_type, image_data, sha256, updated_at)
                    VALUES(?, ?, ?, ?, ?, ?)
                    ON CONFLICT(target_id) DO UPDATE SET
                        target_kind = excluded.target_kind,
                        mime_type = excluded.mime_type,
                        image_data = excluded.image_data,
                        sha256 = excluded.sha256,
                        updated_at = excluded.updated_at
                    """,
                    (tid, kind, mime, raw_bytes, file_hash, now),
                )
                imported_from_disk += 1

        # 2. DB → ディスク 復元（ディスクに存在しないIDのみ書き出し）
        for tid, db_row in db_map.items():
            if tid not in disk_files:
                _write_disk_file(
                    img_dir,
                    tid,
                    bytes(db_row["image_data"]),
                    str(db_row["mime_type"] or "image/png"),
                )
                restored_to_disk += 1

    total = conn.execute("SELECT COUNT(*) FROM card_images").fetchone()[0]
    return {
        "imported_from_disk": imported_from_disk,
        "restored_to_disk": restored_to_disk,
        "total_images": int(total),
    }


def save_card_image(
    conn: sqlite3.Connection,
    target_id: str,
    image_bytes: bytes,
    mime_type: str = "image/png",
) -> dict[str, Any]:
    """指定カードIDのイラストを SQLite と data/images/ の両方に保存する."""
    tid = (target_id or "").strip().upper()
    if not _VALID_TARGET_ID_RE.match(tid):
        raise ValidationError(
            [
                Issue(
                    field="target_id",
                    message=f"不正なカードID形式です: '{target_id}'",
                    record_id=target_id,
                )
            ]
        )
    if not image_bytes:
        raise ValidationError(
            [Issue(field="image", message="画像データが空です", record_id=tid)]
        )

    kind = infer_target_kind(conn, tid)
    sha256 = _sha256_hex(image_bytes)
    now = _now_iso()
    img_dir = get_images_dir_for_conn(conn)

    with transaction(conn):
        conn.execute(
            """
            INSERT INTO card_images(target_id, target_kind, mime_type, image_data, sha256, updated_at)
            VALUES(?, ?, ?, ?, ?, ?)
            ON CONFLICT(target_id) DO UPDATE SET
                target_kind = excluded.target_kind,
                mime_type = excluded.mime_type,
                image_data = excluded.image_data,
                sha256 = excluded.sha256,
                updated_at = excluded.updated_at
            """,
            (tid, kind, mime_type, image_bytes, sha256, now),
        )
        file_path = _write_disk_file(img_dir, tid, image_bytes, mime_type)

    return {
        "target_id": tid,
        "target_kind": kind,
        "mime_type": mime_type,
        "sha256": sha256,
        "size_bytes": len(image_bytes),
        "updated_at": now,
        "file_path": str(file_path),
    }


def get_card_image(conn: sqlite3.Connection, target_id: str) -> dict[str, Any]:
    """指定カードIDのイラスト画像バイナリとメタ情報を取得する（必要に応じてフォルダと自動同期）."""
    tid = (target_id or "").strip().upper()
    img_dir = get_images_dir_for_conn(conn)

    # ディスク上のファイル確認
    disk_file: Path | None = None
    for ext in _IMAGE_EXT_TO_MIME:
        candidate = img_dir / f"{tid}{ext}"
        if candidate.exists() and candidate.is_file():
            disk_file = candidate
            break

    row = conn.execute(
        "SELECT target_id, target_kind, mime_type, image_data, sha256, updated_at FROM card_images WHERE target_id = ?",
        (tid,),
    ).fetchone()

    if disk_file is not None:
        disk_bytes = disk_file.read_bytes()
        if disk_bytes:
            disk_hash = _sha256_hex(disk_bytes)
            mime = _IMAGE_EXT_TO_MIME.get(disk_file.suffix.lower(), "image/png")
            if row is None or row["sha256"] != disk_hash:
                # ディスク側が新しい／直置きされた場合はDBへ反映
                saved = save_card_image(conn, tid, disk_bytes, mime)
                return {
                    **saved,
                    "image_data": disk_bytes,
                }

    if row is None:
        raise NotFoundError(f"カード '{tid}' のイラスト画像は登録されていません", record_id=tid)

    data_bytes = bytes(row["image_data"])
    mime_str = str(row["mime_type"] or "image/png")

    # ディスクにファイルが欠損していれば自動復元
    if disk_file is None:
        _write_disk_file(img_dir, tid, data_bytes, mime_str)

    return {
        "target_id": row["target_id"],
        "target_kind": row["target_kind"],
        "mime_type": mime_str,
        "image_data": data_bytes,
        "sha256": row["sha256"],
        "size_bytes": len(data_bytes),
        "updated_at": row["updated_at"],
    }


def delete_card_image(conn: sqlite3.Connection, target_id: str) -> bool:
    """指定カードIDのイラストを SQLite と data/images/ の両方から削除する."""
    tid = (target_id or "").strip().upper()
    img_dir = get_images_dir_for_conn(conn)

    with transaction(conn):
        cur = conn.execute("DELETE FROM card_images WHERE target_id = ?", (tid,))
        deleted_db = cur.rowcount > 0
        had_file = any((img_dir / f"{tid}{ext}").exists() for ext in _IMAGE_EXT_TO_MIME)
        _remove_disk_files_for_id(img_dir, tid)

    if not deleted_db and not had_file:
        raise NotFoundError(f"カード '{tid}' のイラスト画像は登録されていません", record_id=tid)
    return True


def get_image_meta_map(conn: sqlite3.Connection, *, auto_sync: bool = True) -> dict[str, dict[str, Any]]:
    """登録済みイラストの target_id -> メタ情報辞書を返す."""
    if auto_sync:
        sync_images(conn)
    rows = conn.execute(
        "SELECT target_id, target_kind, mime_type, sha256, length(image_data) AS size_bytes, updated_at FROM card_images"
    ).fetchall()
    return {
        r["target_id"]: {
            "target_id": r["target_id"],
            "target_kind": r["target_kind"],
            "mime_type": r["mime_type"],
            "sha256": r["sha256"],
            "size_bytes": r["size_bytes"],
            "updated_at": r["updated_at"],
            "image_url": f"/api/images/{r['target_id']}?v={r['sha256'][:10]}",
        }
        for r in rows
    }


# ==============================================================================
# カード描画モデル変換 (hug-card-gen の HugCard 構造および io_csv.py と100%互換)
# ==============================================================================


def event_to_card_model(
    event: dict[str, Any],
    *,
    card_number: int | str | None = None,
    image_meta_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """イベントレコードをカード描画モデル (HugCard互換) に変換する."""
    orig_id = str(event.get("card_id") or "")
    display_id = str(card_number) if card_number is not None else orig_id
    categories = [str(c) for c in (event.get("category") or []) if c]
    img_meta = (image_meta_map or {}).get(orig_id)

    return {
        "id": display_id,
        "original_id": orig_id,
        "kind": "event",
        "type": "イベント",
        "name": str(event.get("event_name") or ""),
        "origin": "-",
        "age": "-",
        "gender": "-",
        "attributes": str(event.get("source") or ""),
        "detailedFlags": categories,
        "appearance": str(event.get("scene_description") or ""),
        "dialogue": str(event.get("content") or ""),
        "points": str(event.get("training_point") or ""),
        "hasImage": img_meta is not None,
        "imageUrl": img_meta["image_url"] if img_meta else None,
        "imageSha256": img_meta["sha256"] if img_meta else None,
    }


def member_to_card_model(
    member: dict[str, Any],
    group: dict[str, Any] | None = None,
    *,
    card_number: int | str | None = None,
    image_meta_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """構成員（人物・ペット）レコードをカード描画モデル (HugCard互換) に変換する."""
    orig_id = str(member.get("member_id") or "")
    display_id = str(card_number) if card_number is not None else orig_id
    dt = member.get("data_type", "人物")
    origin = str((group or {}).get("evacuation_origin") or "")
    raw_age = member.get("age")
    age_str = "" if raw_age is None or raw_age == "" else str(raw_age)
    gender = str(member.get("gender") or "")
    appearance = str(member.get("appearance") or "")
    training_point = str(member.get("training_point") or "")

    if dt == "ペット":
        kind_code = "pet"
        type_label: CardTypeLabel = "ペット"
        rel = str(member.get("relationship") or "ペット")
        p_vulns = [str(x) for x in (member.get("pet_vulnerabilities") or []) if x]
        p_health = [
            str(x)
            for x in (member.get("pet_health_condition") or [])
            if x and str(x) != "良好"
        ]
        p_skills = [str(x) for x in (member.get("pet_skills") or []) if x]
        flags = p_vulns + p_health + p_skills
        dialogue = appearance
    else:
        kind_code = "person"
        type_label = "避難者"
        rel = str(member.get("relationship") or "")
        vulns = [str(x) for x in (member.get("vulnerabilities") or []) if x]
        health = [
            str(x)
            for x in (member.get("health_condition") or [])
            if x and str(x) != "良好"
        ]
        skills = [str(x) for x in (member.get("skills") or []) if x]
        flags = vulns + health + skills
        dialogue = str(member.get("statement") or "")

    img_meta = (image_meta_map or {}).get(orig_id)

    return {
        "id": display_id,
        "original_id": orig_id,
        "group_id": str(member.get("group_id") or (group or {}).get("group_id") or ""),
        "group_name": str((group or {}).get("group_name") or ""),
        "kind": kind_code,
        "type": type_label,
        "name": str(member.get("name") or ""),
        "origin": origin,
        "age": age_str,
        "gender": gender,
        "attributes": rel,
        "detailedFlags": flags,
        "appearance": appearance,
        "dialogue": dialogue,
        "points": training_point,
        "hasImage": img_meta is not None,
        "imageUrl": img_meta["image_url"] if img_meta else None,
        "imageSha256": img_meta["sha256"] if img_meta else None,
    }


def build_all_card_models(
    conn: sqlite3.Connection,
    *,
    auto_sync: bool = True,
) -> list[dict[str, Any]]:
    """DB内の全イベントおよび全構成員（氏名自動補完済み）のカード描画モデル一覧を返す."""
    repo = Repository(conn)
    image_meta_map = get_image_meta_map(conn, auto_sync=auto_sync)

    events = repo.list_events()
    groups = repo.list_groups()
    members = repo.list_members()

    group_by_id = {g["group_id"]: g for g in groups}
    members_by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in groups}
    orphan_members: list[dict[str, Any]] = []
    for m in members:
        gid = m.get("group_id")
        if gid in members_by_group:
            members_by_group[gid].append(m)
        else:
            orphan_members.append(m)

    # 世帯ごとに fill_household_names を適用し、構成員ID順を維持できるようマップ化
    filled_member_by_id: dict[str, tuple[dict[str, Any], dict[str, Any] | None]] = {}
    for gid, grp in group_by_id.items():
        grp_members = members_by_group.get(gid, [])
        filled_list = fill_household_names(grp, grp_members)
        for fm in filled_list:
            filled_member_by_id[fm["member_id"]] = (fm, grp)
    for om in orphan_members:
        filled_member_by_id[om["member_id"]] = (om, None)

    models: list[dict[str, Any]] = []
    for ev in events:
        models.append(event_to_card_model(ev, image_meta_map=image_meta_map))

    # 構成員は M-0001 順で追加
    sorted_member_ids = sorted(
        filled_member_by_id.keys(),
        key=lambda mid: (parse_id_number("M", mid) or 999999, mid),
    )
    for mid in sorted_member_ids:
        fm, grp = filled_member_by_id[mid]
        models.append(member_to_card_model(fm, grp, image_meta_map=image_meta_map))

    return models


# ==============================================================================
# AI画像生成用バッチプロンプト生成 & バッチ管理 (hug-card-gen 完全準拠)
# ==============================================================================

BATCH_CONFIG: dict[CardTypeLabel, dict[str, Any]] = {
    "避難者": {
        "chunk_size": 12,
        "cols": 4,
        "rows": 3,
        "template_file": "template_people_12v2.png",
    },
    "ペット": {
        "chunk_size": 12,
        "cols": 4,
        "rows": 3,
        "template_file": "template_pets.png",
    },
    "イベント": {
        "chunk_size": 9,
        "cols": 3,
        "rows": 3,
        "template_file": "template_events_9.png",
    },
}


def build_prompt_text(card_type: CardTypeLabel, target_cards: list[dict[str, Any]]) -> str:
    """hug-card-gen の getPrompt と完全一致するグリッド画像生成プロンプトを組み立てる."""
    cols = 3 if card_type == "イベント" else 4
    rows = 3

    if card_type == "避難者":
        prompt = (
            f"添付の画像は{cols}列×{rows}行のグリッド状に人物が配置されたテンプレート画像です。\n"
            f"【絶対に厳守する構造ルール】\n"
            f"- テンプレート画像は、{cols}列×{rows}行のグリッド状に12人の人物が配置されています。\n"
            f"- この「{cols}列×{rows}行の配置（構図・グリッド）」を完全に維持したまま、各人物のイラストを指定された特徴に描き換えてください。\n"
            f"- 各人物の境界線や配置間隔は絶対に変更しないでください。配置が少しでもずれるとシステムがエラーを起こします。\n"
            f"- 各行には必ず「4つ」の独立した枠があります。絶対に同じ人物を隣の枠に複製しないでください。\n\n"
            f"【イラスト生成の厳守事項】\n"
            f"1. 【最重要】各位置の人物は、指定された「年齢」「性別」「属性」を厳密に反映してください。（例：2歳の女の子なら幼児として描き、絶対に小学生のランドセルなどは描かないこと）。\n"
            f"2. 【構図の厳守】人物の頭の先から胸・肩までが枠内に完全に収まるように、人物全体を少し小さめに描画してください。上下が切れるのは絶対に避けてください。左右に余白（空白）ができても全く構いません。\n"
            f"3. 各枠には必ず「1名のみ」を描画してください。複数人は描かないでください。\n"
            f"4. イラスト内にセリフの吹き出しや文字は一切入れないでください。\n"
            f"5. 画風は統一し、日本の一般的な避難所の雰囲気に合わせてください。\n\n"
            f"【各位置の描画指示】\n"
        )
        for i, c in enumerate(target_cards):
            row = (i // cols) + 1
            col = (i % cols) + 1
            age_raw = str(c.get("age") or "")
            age_disp = age_raw if "歳" in age_raw else f"{age_raw}歳"
            gender = str(c.get("gender") or "")
            appearance = str(c.get("appearance") or "")
            attributes = str(c.get("attributes") or "")
            dialogue = str(c.get("dialogue") or "")
            prompt += f"左から{col}番目、上から{row}番目: 【年齢】{age_disp} 【性別】{gender} 【容姿】{appearance} 【属性・状況】{attributes} / {dialogue}\n"
    elif card_type == "ペット":
        prompt = (
            f"添付の画像は{cols}列×{rows}行のグリッド状にペット（犬、猫、うさぎ、鳥等の動物）が配置されたテンプレート画像です。\n"
            f"【絶対に厳守する構造ルール】\n"
            f"- テンプレート画像は、{cols}列×{rows}行のグリッド状に12匹のペット（動物）が配置されています。\n"
            f"- この「{cols}列×{rows}行の配置（構図・グリッド）」を完全に維持したまま、各枠のペットを指定された特徴（犬種・猫種、外観、性格、状況など）に描き換えてください。\n"
            f"- 各イラストの境界線や配置間隔は絶対に変更しないでください。配置が少しでもずれるとシステムがエラーを起こします。\n"
            f"- 各行には必ず「4つ」の独立した枠があります。絶対に同じペットを隣の枠に複製しないでください。\n\n"
            f"【イラスト生成の厳守事項】\n"
            f"1. 【最重要】人物ではなく、必ずペット（犬、猫、小動物などの動物）のイラストを生成してください。人間（人物）の姿は絶対に描かないでください。\n"
            f"2. 各位置のペットは、指定された「名前・種類」「年齢」「性別」「属性」「容姿・特徴」を厳密に反映してください。\n"
            f"3. 【構図の厳守】ペットの顔や全身が枠内に完全に収まるように、枠の中にバランスよく配置してください。上下左右が切れるのは避けてください。\n"
            f"4. 各枠には必ず「1匹（1頭）のみ」を描画してください。複数匹は描かないでください。\n"
            f"5. イラスト内にセリフの吹き出しや文字は一切入れないでください。\n"
            f"6. 画風は統一し、親しみやすいイラスト調にしてください。\n\n"
            f"【各位置の描画指示】\n"
        )
        for i, c in enumerate(target_cards):
            row = (i // cols) + 1
            col = (i % cols) + 1
            name = str(c.get("name") or "")
            age_raw = str(c.get("age") or "")
            age_disp = (age_raw if "歳" in age_raw else f"{age_raw}歳") if age_raw else "不明"
            gender = str(c.get("gender") or "")
            appearance = str(c.get("appearance") or "")
            attributes = str(c.get("attributes") or "")
            dialogue = str(c.get("dialogue") or "")
            prompt += f"左から{col}番目、上から{row}番目: 【名前・種類】{name} 【年齢】{age_disp} 【性別】{gender} 【容姿・特徴】{appearance} 【属性・状況】{attributes} / {dialogue}\n"
    else:
        prompt = (
            f"添付の画像は{cols}列×{rows}行のグリッド状にイラストが配置されたテンプレート画像です。\n"
            f"【絶対に厳守する構造ルール】\n"
            f"- テンプレート画像は、{cols}列×{rows}行のグリッド状に9個のイラストが配置されています。\n"
            f"- この「{cols}列×{rows}行の配置（構図・グリッド）」を完全に維持したまま、各イラストを指定された状況に描き換えてください。\n"
            f"- 各イラストの境界線や配置間隔は絶対に変更しないでください。配置が少しでもずれるとシステムがエラーを起こします。\n"
            f"- 各行には必ず「3つ」の独立した枠があります。絶対に同じ内容を隣の枠に複製しないでください。\n\n"
            f"【イラスト生成の厳守事項】\n"
            f"1. イラスト内にセリフの吹き出しや文字は一切入れないでください。\n"
            f"2. 以下のリストにある各位置の「状況・セリフ」の内容をイラストで表現してください。\n"
            f"3. 画風は統一し、日本の一般的な避難所の雰囲気に合わせてください。\n\n"
            f"【各位置の描画指示】\n"
        )
        for i, c in enumerate(target_cards):
            row = (i // cols) + 1
            col = (i % cols) + 1
            name = str(c.get("name") or "")
            dialogue = str(c.get("dialogue") or "")
            prompt += f"左から{col}番目、上から{row}番目: {name} - 状況: {dialogue}\n"

    return prompt


def generate_batches(
    conn: sqlite3.Connection,
    batch_type: CardTypeLabel | None = None,
    *,
    target_ids: list[str] | None = None,
    only_missing: bool = True,
) -> list[dict[str, Any]]:
    """指定種別（未指定時は全種別）のカードからバッチプロンプトを生成し DB (`image_batches`) に保存する."""
    all_models = build_all_card_models(conn, auto_sync=True)
    model_by_id = {m["original_id"]: m for m in all_models}

    types_to_process: list[CardTypeLabel] = (
        [batch_type] if batch_type is not None else ["避難者", "ペット", "イベント"]
    )
    now = _now_iso()

    with transaction(conn):
        for btype in types_to_process:
            if btype not in BATCH_CONFIG:
                raise ValidationError([Issue(field="batch_type", message=f"不正な種別です: {btype}")])
            cfg = BATCH_CONFIG[btype]
            chunk_size = cfg["chunk_size"]
            cols = cfg["cols"]
            rows = cfg["rows"]
            template_file = cfg["template_file"]

            if target_ids is not None:
                target_list = [
                    model_by_id[tid]
                    for tid in target_ids
                    if tid in model_by_id and model_by_id[tid]["type"] == btype
                ]
            else:
                target_list = [
                    m
                    for m in all_models
                    if m["type"] == btype and (not only_missing or not m["hasImage"])
                ]

            conn.execute("DELETE FROM image_batches WHERE batch_type = ?", (btype,))

            for i in range(0, len(target_list), chunk_size):
                chunk = target_list[i : i + chunk_size]
                batch_num = (i // chunk_size) + 1
                batch_id = f"{btype}-batch-{batch_num}"
                chunk_ids = [c["original_id"] for c in chunk]
                prompt_str = build_prompt_text(btype, chunk)
                conn.execute(
                    """
                    INSERT INTO image_batches(
                        batch_id, batch_number, batch_type, target_ids, prompt,
                        template_file, cols, rows, is_adopted, created_at, updated_at
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (
                        batch_id,
                        batch_num,
                        btype,
                        json.dumps(chunk_ids, ensure_ascii=False),
                        prompt_str,
                        template_file,
                        cols,
                        rows,
                        now,
                        now,
                    ),
                )

    return list_batches(conn, batch_type=batch_type, all_models=all_models)


def list_batches(
    conn: sqlite3.Connection,
    batch_type: CardTypeLabel | None = None,
    *,
    all_models: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """DBに保存されているバッチ一覧を、最新のカード情報付きで返す."""
    # 旧テンプレート名 (template_events.png 等) がDBに残っている場合は最新の BATCH_CONFIG に自動補正
    for btype_key, cfg in BATCH_CONFIG.items():
        conn.execute(
            "UPDATE image_batches SET template_file = ? WHERE batch_type = ? AND template_file != ?",
            (cfg["template_file"], btype_key, cfg["template_file"]),
        )

    models = all_models if all_models is not None else build_all_card_models(conn, auto_sync=False)
    model_by_id = {m["original_id"]: m for m in models}

    if batch_type is not None:
        rows = conn.execute(
            "SELECT * FROM image_batches WHERE batch_type = ? ORDER BY batch_number ASC",
            (batch_type,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM image_batches ORDER BY batch_type ASC, batch_number ASC"
        ).fetchall()

    result: list[dict[str, Any]] = []
    for r in rows:
        t_ids: list[str] = json.loads(r["target_ids"])
        target_cards: list[dict[str, Any]] = []
        for tid in t_ids:
            if tid in model_by_id:
                target_cards.append(model_by_id[tid])
            else:
                target_cards.append(
                    {
                        "id": tid,
                        "original_id": tid,
                        "type": r["batch_type"],
                        "name": f"(削除済み: {tid})",
                        "hasImage": False,
                    }
                )
        result.append(
            {
                "id": r["batch_id"],
                "batch_id": r["batch_id"],
                "batchNumber": r["batch_number"],
                "type": r["batch_type"],
                "targetIds": t_ids,
                "targetCards": target_cards,
                "prompt": r["prompt"],
                "templateFileName": r["template_file"],
                "cols": r["cols"],
                "rows": r["rows"],
                "isAdopted": bool(r["is_adopted"]),
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            }
        )
    return result


def apply_batch_slices(
    conn: sqlite3.Connection,
    batch_id: str,
    slices: list[Any],
) -> dict[str, Any]:
    """グリッド分割された画像配列をバッチの target_ids（または個別指定された target_id）へ一括保存する.

    `slices` には以下のいずれかの形式を指定可能:
    1. Base64文字列のリスト `["data:image/png;base64,...", ...]` -> バッチの `target_ids` の先頭から順に割り当て（端数バッチの場合は `target_ids` の枚数分のみ保存し、余りセルは無視）
    2. 辞書のリスト `[{"target_id": "M-0001", "image_base64": "...", "enabled": True}, ...]` -> セルごとの取捨選択（`enabled=False` はスキップ）および割当先IDの個別変更に対応
    """
    row = conn.execute(
        "SELECT * FROM image_batches WHERE batch_id = ?", (batch_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"バッチ '{batch_id}' が見つかりません", record_id=batch_id)

    batch_target_ids: list[str] = json.loads(row["target_ids"])
    saved_ids: list[str] = []

    with transaction(conn):
        for idx, item in enumerate(slices):
            if item is None:
                continue
            if isinstance(item, str):
                if idx >= len(batch_target_ids):
                    break
                tid = batch_target_ids[idx]
                b64_str = item
                enabled = True
            elif isinstance(item, dict):
                enabled = item.get("enabled", True)
                if not enabled:
                    continue
                tid = str(
                    item.get("target_id")
                    or (batch_target_ids[idx] if idx < len(batch_target_ids) else "")
                ).strip()
                b64_str = str(item.get("image_base64") or item.get("image") or "")
            else:
                continue

            if not tid or not b64_str:
                continue

            img_bytes, mime_type = decode_base64_image(b64_str)
            save_card_image(conn, tid, img_bytes, mime_type)
            saved_ids.append(tid.upper())

        conn.execute(
            "UPDATE image_batches SET is_adopted = 1, updated_at = ? WHERE batch_id = ?",
            (_now_iso(), batch_id),
        )

    return {
        "batch_id": batch_id,
        "saved_count": len(saved_ids),
        "saved_ids": saved_ids,
    }


def get_images_status_summary(conn: sqlite3.Connection) -> dict[str, Any]:
    """全カードの画像設定状況・統計・バッチ一覧・カード描画モデル一覧を一括取得する."""
    sync_info = sync_images(conn)
    all_models = build_all_card_models(conn, auto_sync=False)

    # まだバッチが1件も作られていない種別があり、未設定カードが存在する場合は初期バッチを自動生成
    existing_batches = list_batches(conn, all_models=all_models)
    batches_by_type: dict[str, list[dict[str, Any]]] = {
        "避難者": [],
        "ペット": [],
        "イベント": [],
    }
    for b in existing_batches:
        if b["type"] in batches_by_type:
            batches_by_type[b["type"]].append(b)

    for btype in ("避難者", "ペット", "イベント"):
        missing = [m for m in all_models if m["type"] == btype and not m["hasImage"]]
        if not batches_by_type[btype] and missing:
            batches_by_type[btype] = generate_batches(conn, btype, only_missing=True)

    counts: dict[str, dict[str, int]] = {}
    for btype in ("避難者", "ペット", "イベント"):
        typed_cards = [m for m in all_models if m["type"] == btype]
        with_img = sum(1 for m in typed_cards if m["hasImage"])
        counts[btype] = {
            "total": len(typed_cards),
            "with_image": with_img,
            "without_image": len(typed_cards) - with_img,
        }

    image_ids = [m["original_id"] for m in all_models if m["hasImage"]]
    # DB上にある全画像IDも含める（カードインポート前の事前画像登録にも対応）
    all_db_img_ids = [
        r["target_id"]
        for r in conn.execute("SELECT target_id FROM card_images").fetchall()
    ]
    merged_image_ids = sorted(set(image_ids) | set(all_db_img_ids))

    return {
        "sync": sync_info,
        "counts": counts,
        "image_ids": merged_image_ids,
        "cards": all_models,
        "batches_by_type": batches_by_type,
        "images_dir": str(get_images_dir_for_conn(conn)),
    }


# ==============================================================================
# 個別イラストZIP入出力 (EV-001.png, M-0001.png ...)
# ==============================================================================


def export_images_zip(conn: sqlite3.Connection) -> bytes:
    """登録済みの全個別イラストを `{target_id}.png` 形式で格納した ZIP バイト列を返す."""
    sync_images(conn)
    rows = conn.execute(
        "SELECT target_id, mime_type, image_data FROM card_images ORDER BY target_id ASC"
    ).fetchall()

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for r in rows:
            tid = r["target_id"]
            mime = str(r["mime_type"] or "image/png")
            ext = ".png"
            for k_ext, k_mime in _IMAGE_EXT_TO_MIME.items():
                if k_mime == mime:
                    ext = k_ext
                    break
            zf.writestr(f"{tid}{ext}", bytes(r["image_data"]))
    return zip_buf.getvalue()


def import_images_zip(conn: sqlite3.Connection, zip_bytes: bytes) -> dict[str, Any]:
    """`EV-001.png`, `M-0001.png` 等を含む ZIP から個別イラストを一括インポートする."""
    if not zip_bytes:
        raise ValidationError([Issue(field="file", message="ZIPファイルが空です")])
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), mode="r")
    except Exception as exc:
        raise ValidationError(
            [Issue(field="file", message=f"不正なZIPファイルです: {exc}")]
        ) from exc

    imported_ids: list[str] = []
    skipped_files: list[str] = []

    with zf, transaction(conn):
        for info in zf.infolist():
            if info.is_dir():
                continue
            p = Path(info.filename)
            ext = p.suffix.lower()
            stem = p.stem.upper()
            if ext not in _IMAGE_EXT_TO_MIME or not _VALID_TARGET_ID_RE.match(stem):
                skipped_files.append(info.filename)
                continue
            raw_bytes = zf.read(info.filename)
            if not raw_bytes:
                skipped_files.append(info.filename)
                continue
            mime = _IMAGE_EXT_TO_MIME[ext]
            save_card_image(conn, stem, raw_bytes, mime)
            imported_ids.append(stem)

    return {
        "imported_count": len(imported_ids),
        "imported_ids": imported_ids,
        "skipped_files": skipped_files,
    }
