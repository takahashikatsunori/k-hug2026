"""バージョン管理 API ルーター."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Response, status

from hugdb.api.deps import get_conn, make_download_response
from hugdb.versions import (
    create_version,
    delete_version,
    diff_version,
    export_version_json,
    get_version,
    list_versions,
    restore_version,
    update_version,
)
from hugdb.repository import NotFoundError

router = APIRouter(prefix="/api/versions", tags=["versions"])


@router.get("")
def api_list_versions(
    kind: str | None = Query(default=None, description="種別フィルタ (all | manual | auto | auto_import 等)"),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    """バージョンの一覧を新しい順で返す."""
    return list_versions(conn, kind=kind)


@router.post("", status_code=status.HTTP_201_CREATED)
def api_create_version(
    payload: dict[str, Any] = Body(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """手動でバージョンを作成する."""
    label = str(payload.get("label") or "")
    note = str(payload.get("note") or "")
    return create_version(conn, label=label, note=note, kind="manual")


@router.get("/{version_id}")
def api_get_version(
    version_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """指定IDのバージョン情報を取得する."""
    ver = get_version(conn, version_id)
    if ver is None:
        raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))
    return ver


@router.patch("/{version_id}")
def api_update_version(
    version_id: int,
    payload: dict[str, Any] = Body(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """指定IDのバージョンの名前・メモを変更する."""
    return update_version(
        conn,
        version_id,
        label=payload.get("label"),
        note=payload.get("note"),
    )


@router.delete("/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_version(
    version_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Response:
    """指定IDのバージョンを削除する."""
    delete_version(conn, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{version_id}/diff")
def api_diff_version(
    version_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """指定バージョンと現在のDB状態の差分を返す."""
    return diff_version(conn, version_id)


@router.get("/{version_id}/export")
def api_export_version(
    version_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Response:
    """指定バージョンのデータをサンプル形式の JSON ファイルとして出力する."""
    ver = get_version(conn, version_id)
    if ver is None:
        raise NotFoundError(f"バージョン '{version_id}' が見つかりません", record_id=str(version_id))
    data = export_version_json(conn, version_id)
    raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    return make_download_response(
        raw,
        "application/json; charset=utf-8",
        f"HUGバージョン_{version_id}_{ver['label']}.json",
        f"hug_version_{version_id}.json",
    )


@router.post("/{version_id}/restore")
def api_restore_version(
    version_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """指定バージョンの状態にDBを復元する."""
    return restore_version(conn, version_id)
