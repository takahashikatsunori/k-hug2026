"""FastAPI アプリケーションエントリポイントおよびエラーハンドラ定義."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

from hugdb import config
from hugdb.api import decks, events, households, images, io, schema, search, versions
from hugdb.db import connect
from hugdb.io_json import PayloadTooLargeError
from hugdb.ordering import PrerequisiteViolation
from hugdb.repository import ConflictError, NotFoundError, ValidationError
from hugdb.static_sync import sync_static_db_json


def create_app(db_path: Path | str | None = None) -> FastAPI:
    """FastAPI アプリケーションを生成・初期化する."""
    app = FastAPI(
        title="HUG カードデータベース管理ツール",
        version="1.0.0",
    )
    app.state.db_path = Path(db_path) if db_path is not None else None

    # 初回起動時にDBスキーマを確実に初期化（デフォルトDB使用時はWeb用JSONも同期）
    conn = connect(app.state.db_path)
    if app.state.db_path is None:
        try:
            sync_static_db_json(conn)
        except Exception:
            pass
    conn.close()

    # ------------------------------------------------------------------
    # 統一エラーハンドラ: {"detail": str, "errors": [{"field","message","record_id"}]}
    # ------------------------------------------------------------------

    @app.exception_handler(NotFoundError)
    async def handle_not_found(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={
                "detail": str(exc),
                "errors": [
                    {
                        "field": "id",
                        "message": str(exc),
                        "record_id": exc.record_id,
                    }
                ],
            },
        )

    @app.exception_handler(ConflictError)
    async def handle_conflict(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={
                "detail": str(exc),
                "dependents": exc.dependents,
                "errors": [
                    e.to_dict()
                    for e in (
                        exc.errors
                        or []
                    )
                ]
                or [{"field": "", "message": str(exc), "record_id": None}],
            },
        )

    @app.exception_handler(PrerequisiteViolation)
    async def handle_prereq_violation(request: Request, exc: PrerequisiteViolation) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={
                "detail": str(exc),
                "dependents": [exc.card_id],
                "errors": [
                    {
                        "field": "prerequisite_card_id",
                        "message": str(exc),
                        "record_id": exc.card_id,
                    }
                ],
            },
        )

    @app.exception_handler(ValidationError)
    async def handle_validation_error(request: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "detail": str(exc),
                "errors": [
                    {
                        "field": e.field,
                        "message": e.message,
                        "record_id": e.record_id,
                    }
                    for e in exc.errors
                ],
            },
        )

    @app.exception_handler(PayloadTooLargeError)
    async def handle_payload_too_large(request: Request, exc: PayloadTooLargeError) -> JSONResponse:
        return JSONResponse(
            status_code=413,
            content={
                "detail": str(exc),
                "errors": [{"field": "file", "message": str(exc), "record_id": None}],
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        formatted_errors: list[dict[str, Any]] = []
        for err in exc.errors():
            loc = [str(x) for x in err.get("loc", []) if x != "body"]
            fld = ".".join(loc) if loc else "request"
            formatted_errors.append(
                {
                    "field": fld,
                    "message": err.get("msg", "入力形式が不正です"),
                    "record_id": None,
                }
            )
        return JSONResponse(
            status_code=422,
            content={
                "detail": "リクエストパラメータが不正です",
                "errors": formatted_errors,
            },
        )

    @app.exception_handler(StarletteHTTPException)
    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        detail_str = str(exc.detail) if exc.detail else "HTTP Error"
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": detail_str,
                "errors": [{"field": "", "message": detail_str, "record_id": None}],
            },
        )

    # ルーター登録
    app.include_router(schema.router)
    app.include_router(events.router)
    app.include_router(households.router)
    app.include_router(search.router)
    app.include_router(io.router)
    app.include_router(decks.router)
    app.include_router(versions.router)
    app.include_router(images.router)

    # 静的ファイルとトップページの配信
    static_dir = config.BASE_DIR / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    data_dir = config.DATA_DIR
    data_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/data", StaticFiles(directory=str(data_dir)), name="data")

    logo_dir = config.BASE_DIR / "logo"
    logo_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/logo", StaticFiles(directory=str(logo_dir)), name="logo")

    _READONLY_POST_PATHS = {
        "/api/deck/build",
        "/api/deck/reorder",
        "/api/deck/export",
        "/api/search",
        "/api/io/export",
        "/api/images/prompts",
    }

    @app.middleware("http")
    async def disable_static_js_cache(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        path = request.url.path
        if (
            path in ("/", "/deck.html", "/web", "/training.html", "/training", "/data/cards_db.json")
            or path.startswith("/static/js/")
            or path.startswith("/static/css/")
        ):
            response.headers["Cache-Control"] = "no-cache"

        # デフォルトDBに対する更新系API完了時に Web用 cards_db.json を自動同期
        if (
            app.state.db_path is None
            and request.method in ("POST", "PUT", "PATCH", "DELETE")
            and path.startswith("/api/")
            and path not in _READONLY_POST_PATHS
            and 200 <= response.status_code < 300
        ):
            try:
                sync_conn = connect(None)
                try:
                    sync_static_db_json(sync_conn)
                finally:
                    sync_conn.close()
            except Exception:
                pass
        return response

    @app.get("/", include_in_schema=False)
    async def serve_index() -> FileResponse:
        index_file = static_dir / "index.html"
        return FileResponse(str(index_file), media_type="text/html; charset=utf-8")

    @app.get("/deck.html", include_in_schema=False)
    @app.get("/web", include_in_schema=False)
    async def serve_web_deck_builder() -> FileResponse:
        web_index_file = config.BASE_DIR / "index.html"
        return FileResponse(str(web_index_file), media_type="text/html; charset=utf-8")

    @app.get("/training.html", include_in_schema=False)
    @app.get("/training", include_in_schema=False)
    async def serve_training_page() -> FileResponse:
        training_file = config.BASE_DIR / "training.html"
        return FileResponse(str(training_file), media_type="text/html; charset=utf-8")

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run("hugdb.main:app", host=config.HOST, port=config.PORT, reload=False)
