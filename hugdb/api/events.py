"""イベントカード API ルーター."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Response, status

from hugdb.api.deps import get_repo
from hugdb.repository import NotFoundError, Repository

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
def list_events(repo: Repository = Depends(get_repo)) -> list[dict[str, Any]]:
    """イベントカード一覧を取得する."""
    return repo.list_events()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_event(
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """イベントカードを新規作成する（IDは自動採番）."""
    return repo.create_event(payload)


@router.get("/{card_id}")
def get_event(
    card_id: str,
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDのイベントカードを取得する."""
    ev = repo.get_event(card_id)
    if ev is None:
        raise NotFoundError(f"イベント '{card_id}' が見つかりません", record_id=card_id)
    return ev


@router.put("/{card_id}")
def update_event(
    card_id: str,
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDのイベントカードを更新する."""
    return repo.update_event(card_id, payload)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    card_id: str,
    force: bool = Query(False, description="依存する前提カード指定を解除して強制削除するか"),
    repo: Repository = Depends(get_repo),
) -> Response:
    """指定IDのイベントカードを削除する（依存カードがある場合は 409、force=true で削除）."""
    repo.delete_event(card_id, force=force)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
