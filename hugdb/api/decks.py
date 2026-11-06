"""デッキ構築・手動並べ替え検証・デッキ出力・デッキ保存 API ルーター."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Response, status

from hugdb.api.deps import get_repo, make_download_response
from hugdb.deck import build_deck, inspect_saved_deck
from hugdb.io_csv import export_deck_card_csv
from hugdb.ordering import PrerequisiteViolation, apply_manual_order, build_units, compute_order
from hugdb.repository import ConflictError, NotFoundError, Repository, ValidationError
from hugdb.validation import Issue

router = APIRouter(prefix="/api", tags=["decks"])


def _build_deck_from_payload(repo: Repository, payload: dict[str, Any]) -> Any:
    conditions = payload.get("conditions", payload)
    resolutions = payload.get("resolutions") or {}
    manual_order = payload.get("manual_order")
    phase_first = bool(payload.get("phase_first", False))

    try:
        return build_deck(
            repo.list_events(),
            repo.list_groups(),
            repo.list_members(),
            conditions,
            resolutions=resolutions,
            manual_order=manual_order,
            phase_first=phase_first,
        )
    except PrerequisiteViolation as exc:
        raise ConflictError(
            str(exc),
            dependents=[exc.card_id],
            errors=[
                Issue(
                    field="manual_order",
                    message=str(exc),
                    record_id=exc.card_id,
                )
            ],
        ) from exc


@router.post("/deck/build")
def api_build_deck(
    payload: dict[str, Any] = Body(default={}),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """訓練条件・矛盾解決・手動順序を受け取り、デッキを構築して返す."""
    deck = _build_deck_from_payload(repo, payload)
    return deck.to_dict()


@router.post("/deck/reorder")
def api_reorder_deck(
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """手動の並べ替え順序を検証し、前提カード制約に反する場合は 409 を返す (AP-17)."""
    manual_order = payload.get("manual_order") or payload.get("unit_ids") or []
    if not isinstance(manual_order, list):
        raise ValidationError([Issue(field="manual_order", message="manual_order は配列である必要があります")])

    if "conditions" in payload:
        deck = _build_deck_from_payload(repo, {**payload, "manual_order": manual_order})
        return deck.to_dict()

    units = build_units(repo.list_events(), repo.list_groups())
    computed = compute_order(units)
    try:
        reordered = apply_manual_order(computed, manual_order)
    except PrerequisiteViolation as exc:
        raise ConflictError(
            str(exc),
            dependents=[exc.card_id],
            errors=[
                Issue(
                    field="manual_order",
                    message=str(exc),
                    record_id=exc.card_id,
                )
            ],
        ) from exc

    return {
        "ok": True,
        "unit_ids": [u.id for u in reordered],
    }


@router.post("/deck/export")
def api_export_deck(
    format: str = Query("json", description="出力形式 (json | cardcsv)"),
    payload: dict[str, Any] = Body(default={}),
    repo: Repository = Depends(get_repo),
) -> Response:
    """デッキを JSON またはカード画像用 11 列 CSV としてダウンロード出力する (AP-18)."""
    deck = _build_deck_from_payload(repo, payload)
    fmt = format.lower().strip()
    if fmt == "json":
        raw = json.dumps(deck.export_payload, ensure_ascii=False, indent=2).encode("utf-8")
        return make_download_response(
            raw,
            "application/json; charset=utf-8",
            "HUG訓練デッキ.json",
            "hug_deck.json",
        )
    if fmt == "cardcsv":
        raw_csv = export_deck_card_csv(deck)
        return make_download_response(
            raw_csv,
            "text/csv; charset=utf-8",
            "HUG訓練デッキ_カード画像用.csv",
            "hug_deck.csv",
        )
    raise ValidationError([Issue(field="format", message=f"未対応の出力形式です: {format}")])


@router.get("/decks")
def list_saved_decks(repo: Repository = Depends(get_repo)) -> list[dict[str, Any]]:
    """保存済みデッキ条件の一覧を返す（changed フラグ付き）."""
    events = repo.list_events()
    groups = repo.list_groups()
    members = repo.list_members()
    decks = repo.list_saved_decks()
    return [inspect_saved_deck(d, events, groups, members) for d in decks]


@router.post("/decks", status_code=status.HTTP_201_CREATED)
def create_saved_deck(
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """デッキ条件・手動順序・矛盾解決を保存する."""
    name = str(payload.get("name") or "")
    conditions = payload.get("conditions") or {}
    manual_order = payload.get("manual_order")
    resolutions = payload.get("resolutions") or {}
    content_hash = payload.get("content_hash")

    if not content_hash:
        built = build_deck(
            repo.list_events(),
            repo.list_groups(),
            repo.list_members(),
            conditions,
            resolutions=resolutions,
        )
        content_hash = built.content_hash

    saved = repo.create_saved_deck(
        name=name,
        conditions=conditions,
        manual_order=manual_order,
        resolutions=resolutions,
        content_hash=content_hash,
    )
    return inspect_saved_deck(
        saved,
        repo.list_events(),
        repo.list_groups(),
        repo.list_members(),
    )


@router.get("/decks/{deck_id}")
def get_saved_deck(
    deck_id: int,
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDの保存済みデッキを取得する（カード編集による changed 検知・再計算情報付き: AP-19）."""
    saved = repo.get_saved_deck(deck_id)
    if saved is None:
        raise NotFoundError(f"保存済みデッキ '{deck_id}' が見つかりません", record_id=str(deck_id))
    return inspect_saved_deck(
        saved,
        repo.list_events(),
        repo.list_groups(),
        repo.list_members(),
    )


@router.put("/decks/{deck_id}")
def update_saved_deck(
    deck_id: int,
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDの保存済みデッキを更新する."""
    conditions = payload.get("conditions")
    resolutions = payload.get("resolutions")
    content_hash = payload.get("content_hash")
    if content_hash is None and conditions is not None:
        built = build_deck(
            repo.list_events(),
            repo.list_groups(),
            repo.list_members(),
            conditions,
            resolutions=resolutions,
        )
        content_hash = built.content_hash

    updated = repo.update_saved_deck(
        deck_id,
        name=payload.get("name"),
        conditions=conditions,
        manual_order=payload.get("manual_order"),
        resolutions=resolutions,
        content_hash=content_hash,
    )
    return inspect_saved_deck(
        updated,
        repo.list_events(),
        repo.list_groups(),
        repo.list_members(),
    )


@router.delete("/decks/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_deck(
    deck_id: int,
    repo: Repository = Depends(get_repo),
) -> Response:
    """指定IDの保存済みデッキを削除する."""
    repo.delete_saved_deck(deck_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
