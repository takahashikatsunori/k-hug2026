"""SQLite データベース接続・スキーマ初期化・マイグレーション管理モジュール."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
import sqlite3

from hugdb import config

SCHEMA_VERSION = "1"

DDL_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS cards_event (
        card_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS evacuee_groups (
        group_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS group_members (
        member_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES evacuee_groups(group_id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        filters TEXT NOT NULL,
        result_ids TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS saved_decks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        conditions TEXT NOT NULL,
        manual_order TEXT,
        resolutions TEXT,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        note TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('manual','auto_import','auto_clear','auto_restore')),
        data TEXT NOT NULL,
        counts TEXT NOT NULL,
        data_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS card_images (
        target_id TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL CHECK(target_kind IN ('event', 'person', 'pet')),
        mime_type TEXT NOT NULL DEFAULT 'image/png',
        image_data BLOB NOT NULL,
        sha256 TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS image_batches (
        batch_id TEXT PRIMARY KEY,
        batch_number INTEGER NOT NULL,
        batch_type TEXT NOT NULL CHECK(batch_type IN ('避難者', 'ペット', 'イベント')),
        target_ids TEXT NOT NULL,
        prompt TEXT NOT NULL,
        template_file TEXT NOT NULL,
        cols INTEGER NOT NULL,
        rows INTEGER NOT NULL,
        is_adopted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_card_images_meta
    ON card_images(target_id, target_kind, mime_type, sha256, updated_at)
    """,
)


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    """SQLite 接続を開き、外部キー制約の有効化とスキーマ初期化を行う."""
    path = Path(db_path) if db_path is not None else config.get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        str(path),
        timeout=30.0,
        check_same_thread=False,
        isolation_level=None,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn)
    return conn


def _is_db_already_initialized(conn: sqlite3.Connection) -> bool:
    """すでに最新スキーマかつカウンタ・画像管理テーブルが存在するか読み取りのみで判定する."""
    try:
        rows = conn.execute(
            "SELECT key, value FROM meta WHERE key IN "
            "('schema_version', 'id_counter_EV', 'id_counter_GRP', 'id_counter_M')"
        ).fetchall()
        tbl_count = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE "
            "(type='table' AND name IN ('card_images', 'image_batches')) OR "
            "(type='index' AND name = 'idx_card_images_meta')"
        ).fetchone()[0]
    except sqlite3.OperationalError:
        return False
    kv = {r["key"]: r["value"] for r in rows}
    return (
        kv.get("schema_version") == SCHEMA_VERSION
        and "id_counter_EV" in kv
        and "id_counter_GRP" in kv
        and "id_counter_M" in kv
        and tbl_count == 3
    )


def init_db(conn: sqlite3.Connection) -> None:
    """テーブル作成およびスキーマバージョンのマイグレーションを実行する."""
    conn.execute("PRAGMA foreign_keys = ON")
    if _is_db_already_initialized(conn):
        return
    with transaction(conn):
        for stmt in DDL_STATEMENTS:
            conn.execute(stmt)

        row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        current_ver = row["value"] if row else None

        if current_ver != SCHEMA_VERSION:
            _run_migrations(conn, current_ver)
            conn.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (SCHEMA_VERSION,),
            )

        for counter_key in ("id_counter_EV", "id_counter_GRP", "id_counter_M"):
            conn.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES(?, '0')",
                (counter_key,),
            )


def _run_migrations(conn: sqlite3.Connection, from_version: str | None) -> None:
    """古い schema_version からのマイグレーション処理（既存データを保持）."""
    if from_version is None:
        return
    # 将来または旧バージョン(0)からの不足カラム補完
    saved_decks_cols = {
        r["name"] for r in conn.execute("PRAGMA table_info(saved_decks)").fetchall()
    }
    if "resolutions" not in saved_decks_cols:
        conn.execute("ALTER TABLE saved_decks ADD COLUMN resolutions TEXT")
    if "content_hash" not in saved_decks_cols:
        conn.execute("ALTER TABLE saved_decks ADD COLUMN content_hash TEXT")


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """トランザクションのコンテキストマネージャ（ネスト対応・例外時ロールバック）."""
    already_in_tx = conn.in_transaction
    if not already_in_tx:
        conn.execute("BEGIN")
    try:
        yield conn
        if not already_in_tx and conn.in_transaction:
            conn.execute("COMMIT")
    except Exception:
        if not already_in_tx and conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
