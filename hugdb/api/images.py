"""カード用イラスト画像管理・バッチプロンプト生成・ZIP入出力 API ルーター."""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Request, Response, UploadFile, status

from hugdb import config
from hugdb.api.deps import get_conn, make_download_response
from hugdb.images import (
    apply_batch_slices,
    build_all_card_models,
    decode_base64_image,
    delete_card_image,
    export_images_zip,
    generate_batches,
    get_card_image,
    get_images_status_summary,
    import_images_zip,
    save_card_image,
    sync_images,
)
from hugdb.io_json import PayloadTooLargeError
from hugdb.repository import ValidationError
from hugdb.validation import Issue

router = APIRouter(prefix="/api/images", tags=["images"])

_EXT_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


@router.get("/status")
def api_images_status(
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """全カードのイラスト設定状況・未設定件数・バッチ一覧・描画用モデル一覧を取得する."""
    return get_images_status_summary(conn)


@router.get("/cards")
def api_images_cards(
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """全カードの描画用モデル一覧 (HugCard 形式) を取得する."""
    cards = build_all_card_models(conn, auto_sync=True)
    return {"cards": cards}


@router.post("/sync")
def api_images_sync(
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """SQLite `card_images` と `data/images/` フォルダの双方向同期を実行する."""
    sync_result = sync_images(conn)
    status_data = get_images_status_summary(conn)
    return {
        **status_data,
        "sync": sync_result,
    }


@router.post("/batches/generate")
def api_generate_batches(
    payload: dict[str, Any] = Body(default_factory=dict),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """指定種別（または全種別）の画像未設定カードから12枚/9枚バッチプロンプトを生成する."""
    batch_type = payload.get("type") or payload.get("batch_type")
    target_ids = payload.get("target_ids")
    only_missing = bool(payload.get("only_missing", True))

    batches = generate_batches(
        conn,
        batch_type=batch_type,
        target_ids=target_ids,
        only_missing=only_missing,
    )
    status_data = get_images_status_summary(conn)
    return {
        "batches": batches,
        "status": status_data,
    }


@router.post("/batches/{batch_id}/apply")
def api_apply_batch(
    batch_id: str,
    payload: dict[str, Any] = Body(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """分割されたグリッド画像の各セルをバッチ対象カード（または個別指定カード）へ一括保存する."""
    slices = payload.get("slices")
    if not isinstance(slices, list) or len(slices) == 0:
        raise ValidationError(
            [Issue(field="slices", message="分割画像データ (slices) が空です", record_id=batch_id)]
        )
    res = apply_batch_slices(conn, batch_id, slices)
    status_data = get_images_status_summary(conn)
    return {
        **res,
        "status": status_data,
    }


@router.get("/export/zip")
def api_export_images_zip(
    conn: sqlite3.Connection = Depends(get_conn),
) -> Response:
    """登録済みの全個別イラストを `{ID}.png` 形式の ZIP としてダウンロードする."""
    zip_bytes = export_images_zip(conn)
    return make_download_response(
        zip_bytes,
        "application/zip",
        "HUGカードイラスト一括.zip",
        "hug_card_images.zip",
    )


@router.post("/import/zip")
async def api_import_images_zip(
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """`EV-001.png`, `M-0001.png` 等を含む ZIP から個別イラストを一括インポートする."""
    raw = await file.read()
    if len(raw) > config.MAX_IMPORT_BYTES * 5:
        raise PayloadTooLargeError("アップロードされたZIPファイルのサイズが大きすぎます")
    res = import_images_zip(conn, raw)
    status_data = get_images_status_summary(conn)
    return {
        **res,
        "status": status_data,
    }


@router.get("/{target_id}")
def api_get_image(
    target_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Response:
    """指定カードID (`EV-xxx` / `M-xxxx`) のイラスト画像を返す."""
    info = get_card_image(conn, target_id)
    return Response(
        content=info["image_data"],
        media_type=info["mime_type"],
        headers={
            "ETag": f"\"{info['sha256']}\"",
            "Cache-Control": "no-cache",
        },
    )


@router.put("/{target_id}")
async def api_put_image(
    target_id: str,
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    """指定カードIDのイラスト画像を登録・差し替えする（JSON Base64 / Multipart 両対応）."""
    content_type = (request.headers.get("content-type") or "").lower()

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file") or form.get("image")
        if upload is None or not hasattr(upload, "read"):
            raise ValidationError(
                [Issue(field="file", message="画像ファイルが指定されていません", record_id=target_id)]
            )
        img_bytes = await upload.read()  # type: ignore[union-attr]
        filename = getattr(upload, "filename", "") or ""
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ".png"
        mime_type = getattr(upload, "content_type", None) or _EXT_TO_MIME.get(ext, "image/png")
    else:
        try:
            body = await request.json()
        except Exception as exc:
            raise ValidationError(
                [Issue(field="image", message=f"リクエストボディが不正です: {exc}", record_id=target_id)]
            ) from exc
        raw_b64 = body.get("image_base64") or body.get("image") or body.get("dataUrl") or ""
        img_bytes, mime_type = decode_base64_image(str(raw_b64))

    saved = save_card_image(conn, target_id, img_bytes, mime_type)
    return saved


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_image(
    target_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Response:
    """指定カードIDのイラスト画像を SQLite と data/images/ の両方から削除する."""
    delete_card_image(conn, target_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
