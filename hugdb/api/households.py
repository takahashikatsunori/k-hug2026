"""避難者世帯（グループ＋構成員）および構成員個別削除 API ルーター."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Response, status

from hugdb.api.deps import get_repo
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.validation import Issue

router = APIRouter(prefix="/api", tags=["households"])


def _extract_group_and_members(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(payload, dict):
        raise ValidationError([Issue(field="body", message="リクエスト本文が不正です")])
    if "group" in payload:
        grp = payload.get("group")
        members = payload.get("members", [])
    else:
        members = payload.get("members", [])
        grp = {k: v for k, v in payload.items() if k != "members"}

    if not isinstance(grp, dict):
        raise ValidationError([Issue(field="group", message="group はオブジェクトである必要があります")])
    if not isinstance(members, list):
        raise ValidationError([Issue(field="members", message="members は配列である必要があります")])
    return grp, members


@router.get("/households")
def list_households(repo: Repository = Depends(get_repo)) -> list[dict[str, Any]]:
    """全世帯（グループ＋構成員）の一覧を返す."""
    return repo.list_households()


@router.post("/households", status_code=status.HTTP_201_CREATED)
def create_household(
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """世帯（グループ＋構成員）を新規作成する."""
    grp, members = _extract_group_and_members(payload)
    return repo.save_household(grp, members, is_create=True)


@router.get("/households/{group_id}")
def get_household(
    group_id: str,
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDの世帯（グループ＋構成員）を取得する."""
    hh = repo.get_household(group_id)
    if hh is None:
        raise NotFoundError(f"世帯 '{group_id}' が見つかりません", record_id=group_id)
    return hh


@router.put("/households/{group_id}")
def update_household(
    group_id: str,
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDの世帯（グループ＋構成員）を一括更新する."""
    grp, members = _extract_group_and_members(payload)
    return repo.save_household(grp, members, is_create=False, expected_group_id=group_id)


@router.delete("/households/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_household(
    group_id: str,
    repo: Repository = Depends(get_repo),
) -> Response:
    """指定IDの世帯（および所属する全構成員）をカスケード削除する."""
    repo.delete_household(group_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    member_id: str,
    repo: Repository = Depends(get_repo),
) -> Response:
    """構成員を1人だけ削除し、世帯人数を再計算する（最後の人物なら 409）."""
    repo.delete_member(member_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
