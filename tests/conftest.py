"""共通 pytest フィクスチャ定義."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
import pytest

from hugdb.db import connect
from hugdb.io_json import import_json_payloads
from hugdb.main import create_app
from hugdb.repository import Repository

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
S2_PATH = FIXTURES_DIR / "sample_format2.json"
CSV_EXAMPLE_PATH = FIXTURES_DIR / "csv_rule_example.json"


@pytest.fixture
def s2_payload() -> dict:
    """固定コピーされた sample_format2.json のデータを毎回新しい辞書として返す."""
    return json.loads(S2_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def csv_example_payload() -> dict:
    """変換ルール出力例を再現するデータを返す."""
    return json.loads(CSV_EXAMPLE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """テストごとの一時 SQLite パスを返し、環境変数 HUGDB_DB_PATH にも設定する."""
    p = tmp_path / "test_hug_cards.db"
    monkeypatch.setenv("HUGDB_DB_PATH", str(p))
    return p


@pytest.fixture
def db_conn(db_path: Path) -> sqlite3.Connection:
    """初期化済みの SQLite 接続を返し、テスト終了時にクローズする."""
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture
def repo(db_conn: sqlite3.Connection) -> Repository:
    """Repository インスタンスを返す."""
    return Repository(db_conn)


@pytest.fixture
def client(db_path: Path) -> TestClient:
    """一時DBに接続された FastAPI TestClient を返す."""
    app = create_app(db_path)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def seeded_client(client: TestClient, db_conn: sqlite3.Connection, s2_payload: dict) -> TestClient:
    """S2 データ投入済みの FastAPI TestClient を返す."""
    import_json_payloads(db_conn, [s2_payload], mode="replace")
    return client
