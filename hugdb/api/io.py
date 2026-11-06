"""データ入出力（JSONインポート・デモ読込・エクスポート・全件削除）API ルーター."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, Response, UploadFile

from hugdb.api.deps import get_conn, get_repo, make_download_response
from hugdb.io_csv import export_full_csv_zip, export_records_card_csv
from hugdb.io_json import (
    ImportMode,
    export_all_json,
    import_demo_data,
    import_json_files,
    import_json_payloads,
)
from hugdb.repository import Repository, ValidationError
from hugdb.validation import Issue
from hugdb.versions import create_version

router = APIRouter(prefix="/api", tags=["io"])


@router.post("/import")
async def import_data(
    request: Request,
    mode: ImportMode = Query("replace", description="replace（置換）または append（追加）"),
    dry_run: bool = Query(False, description="ドライラン（プレビューのみ）か"),
    files: list[UploadFile] | None = File(default=None),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """複数JSONファイル（multipart/form-data または JSON ボディ）をインポートする."""
    if mode not in ("replace", "append"):
        raise ValidationError([Issue(field="mode", message=f"不正なモードです: {mode}")])

    if files:
        file_tuples: list[tuple[str, bytes]] = []
        for uf in files:
            content = await uf.read()
            file_tuples.append((uf.filename or "upload.json", content))
        rep = import_json_files(conn, file_tuples, mode=mode, dry_run=dry_run)
        return rep.to_dict()

    # JSON ボディで直接渡された場合のフォールバック
    try:
        body = await request.json()
    except Exception as exc:
        raise ValidationError([Issue(field="files", message="インポートするファイルが指定されていません")]) from exc

    if isinstance(body, dict) and "payloads" in body and isinstance(body["payloads"], list):
        rep = import_json_payloads(conn, body["payloads"], mode=mode, dry_run=dry_run)
        return rep.to_dict()
    if isinstance(body, dict):
        rep = import_json_payloads(conn, [body], mode=mode, dry_run=dry_run)
        return rep.to_dict()

    raise ValidationError([Issue(field="files", message="インポートデータの形式が不正です")])


@router.post("/import/demo")
def import_demo(
    mode: ImportMode = Query("replace", description="replace（置換）または append（追加）"),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """サンプルデータ (docs/sample_format2.json) を読み込む."""
    if mode not in ("replace", "append"):
        raise ValidationError([Issue(field="mode", message=f"不正なモードです: {mode}")])
    rep = import_demo_data(conn, mode=mode)
    return rep.to_dict()


@router.get("/export/json")
def export_json(conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    """DB 全体のカードデータをサンプル形式の JSON ファイルとして出力する."""
    data = export_all_json(conn)
    raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    return make_download_response(
        raw,
        "application/json; charset=utf-8",
        "HUGカードデータベース.json",
        "hug_database.json",
    )


@router.get("/export/csv")
def export_csv(
    format: str = Query("cardcsv", description="cardcsv（11列）または fullcsv（ZIP）"),
    repo: Repository = Depends(get_repo),
) -> Response:
    """DB 全体のカードデータを CSV として出力する."""
    events = repo.list_events()
    groups = repo.list_groups()
    members = repo.list_members()
    fmt = format.lower().strip()
    if fmt == "cardcsv":
        raw = export_records_card_csv(events, groups, members)
        return make_download_response(
            raw,
            "text/csv; charset=utf-8",
            "HUGカード一覧_画像用.csv",
            "hug_cards.csv",
        )
    if fmt == "fullcsv":
        raw_zip = export_full_csv_zip(events, groups, members)
        return make_download_response(
            raw_zip,
            "application/zip",
            "HUGカードデータベース_全項目CSV.zip",
            "hug_full_csv.zip",
        )
    raise ValidationError([Issue(field="format", message=f"未対応のCSV形式です: {format}")])


@router.post("/clear")
def clear_database(
    payload: dict[str, Any] = Body(default={}),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """全件削除を実行する（直前に auto_clear バージョンを自動作成。confirm=='削除' が必須）."""
    confirm = payload.get("confirm")
    if confirm != "削除":
        raise HTTPException(
            status_code=400,
            detail="確認文字列が一致しません（「削除」と入力してください）",
        )
    include_saved = bool(payload.get("include_saved", False))
    auto_ver = create_version(
        conn,
        label="全件削除前の自動保存",
        note="全件削除の直前に自動作成",
        kind="auto_clear",
    )
    repo = Repository(conn)
    repo.clear_all(include_saved=include_saved)
    return {
        "ok": True,
        "include_saved": include_saved,
        "auto_version": auto_ver,
    }
