"""API 共通依存性およびレスポンスヘルパー."""
from __future__ import annotations

from collections.abc import Iterator
import sqlite3
from urllib.parse import quote

from fastapi import Depends, Request
from fastapi.responses import Response

from hugdb.db import connect
from hugdb.repository import Repository


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    """リクエストごとの SQLite 接続を生成し、終了時にクローズする."""
    db_path = getattr(request.app.state, "db_path", None)
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_repo(conn: sqlite3.Connection = Depends(get_conn)) -> Repository:
    """Repository インスタンスを注入する."""
    return Repository(conn)


def make_download_response(
    content: bytes,
    media_type: str,
    filename_utf8: str,
    ascii_fallback: str = "export_data",
) -> Response:
    """RFC 5987 準拠の日本語ファイル名付き Content-Disposition ヘッダを持つレスポンスを返す (AP-09)."""
    encoded = quote(filename_utf8, safe="")
    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"
    }
    return Response(content=content, media_type=media_type, headers=headers)
