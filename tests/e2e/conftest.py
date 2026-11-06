"""Playwright E2E テスト共通フィクスチャ (Uvicorn 起動・DB初期化・コンソールエラー監視 UI-27)."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import sqlite3
import threading
import time
from typing import Generator

import pytest
import uvicorn

from hugdb.config import get_images_dir
from hugdb.db import connect, transaction
from hugdb.main import create_app


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="session")
def e2e_server(tmp_path_factory: pytest.TempPathFactory) -> Generator[dict[str, str], None, None]:
    """セッション中 Uvicorn サーバーを別スレッドで起動する."""
    db_dir = tmp_path_factory.mktemp("hugdb_e2e")
    db_path = db_dir / "e2e_hug.db"
    os.environ["HUGDB_DB_PATH"] = str(db_path)

    port = _find_free_port()
    app = create_app(db_path=db_path)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    # 起動待機
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)

    yield {"base_url": base_url, "db_path": str(db_path)}

    server.should_exit = True
    thread.join(timeout=3.0)


@pytest.fixture(autouse=True)
def reset_e2e_db(e2e_server: dict[str, str]) -> None:
    """各テストの前に SQLite DB を完全に初期状態へリセットする."""
    db_path = Path(e2e_server["db_path"])
    conn = connect(db_path)
    try:
        with transaction(conn):
            conn.execute("DELETE FROM group_members")
            conn.execute("DELETE FROM evacuee_groups")
            conn.execute("DELETE FROM cards_event")
            conn.execute("DELETE FROM saved_searches")
            conn.execute("DELETE FROM saved_decks")
            conn.execute("DELETE FROM versions")
            conn.execute("DELETE FROM card_images")
            conn.execute("DELETE FROM image_batches")
            conn.execute("UPDATE meta SET value = '0' WHERE key LIKE 'id_counter_%'")
    finally:
        conn.close()
    images_dir = get_images_dir(db_path)
    if images_dir.exists():
        for png_file in images_dir.glob("*.png"):
            try:
                png_file.unlink()
            except OSError:
                pass


@pytest.fixture(autouse=True)
def monitor_console_errors(page) -> Generator[list[str], None, None]:
    """UI-27: 全 E2E テストを通して JS の pageerror / console.error が 0 件であることを検証する."""
    js_errors: list[str] = []

    def on_pageerror(err) -> None:
        js_errors.append(f"pageerror: {err}")

    def on_console(msg) -> None:
        if msg.type == "error":
            text = msg.text or ""
            # 意図的な409/422テスト時のブラウザ標準ネットワークログは除外し、500やJSエラーを捕捉
            if text.startswith("Failed to load resource: the server responded with a status of 4"):
                return
            js_errors.append(f"console.error: {text}")

    page.on("pageerror", on_pageerror)
    page.on("console", on_console)

    yield js_errors

    assert js_errors == [], f"ブラウザで JS エラーが発生しました: {js_errors}"
