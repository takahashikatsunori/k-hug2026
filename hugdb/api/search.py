"""カード検索・検索結果エクスポート・保存済み検索 API ルーター."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Response, status

from hugdb.api.deps import get_repo, make_download_response
from hugdb.filtering import SearchQuery, SearchResult, execute_search
from hugdb.io_csv import export_full_csv_zip, export_search_card_csv
from hugdb.io_json import export_search_json
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.validation import Issue, has_missing_required

router = APIRouter(prefix="/api", tags=["search"])


def _run_repo_search(repo: Repository, payload: dict[str, Any] | None) -> SearchResult:
    try:
        query = SearchQuery.from_dict(payload or {})
        ev_meta = repo.list_events_with_meta()
        grp_meta = repo.list_groups_with_meta()
        mem_meta = repo.list_members_with_meta()

        events = [x["data"] for x in ev_meta]
        groups = [x["data"] for x in grp_meta]
        members = [x["data"] for x in mem_meta]

        ev_up = {x["card_id"]: x["updated_at"] for x in ev_meta}
        grp_up = {x["group_id"]: x["updated_at"] for x in grp_meta}
        mem_up = {x["member_id"]: x["updated_at"] for x in mem_meta}

        return execute_search(
            query,
            events,
            groups,
            members,
            event_updated_at=ev_up,
            group_updated_at=grp_up,
            member_updated_at=mem_up,
        )
    except ValueError as exc:
        raise ValidationError([Issue(field="query", message=str(exc))], message=str(exc)) from exc


@router.post("/search")
def search_cards(
    payload: dict[str, Any] = Body(default={}),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """キーワード・項目別・訓練条件によるカード検索を実行する."""
    res = _run_repo_search(repo, payload)
    out = res.to_dict()

    # 各レコードの「要入力（必須項目未入力）」一覧を付与
    missing_map: dict[str, list[str]] = {}
    for ev in repo.list_events():
        m = has_missing_required("event", ev)
        if m:
            missing_map[ev["card_id"]] = m
    for grp in repo.list_groups():
        m = has_missing_required("group", grp)
        if m:
            missing_map[grp["group_id"]] = m
    for mem in repo.list_members():
        m = has_missing_required("member", mem)
        if m:
            missing_map[mem["member_id"]] = m

    out["missing_required"] = missing_map
    return out


@router.post("/search/export")
def export_search_results(
    format: str = Query("json", description="出力形式 (json | cardcsv | fullcsv)"),
    payload: dict[str, Any] = Body(default={}),
    repo: Repository = Depends(get_repo),
) -> Response:
    """検索結果を JSON / カード画像用CSV / 全項目CSV(ZIP) としてダウンロード出力する."""
    res = _run_repo_search(repo, payload)
    all_groups = repo.list_groups()
    all_members = repo.list_members()

    fmt = format.lower().strip()
    if fmt == "json":
        exp_dict = export_search_json(res, all_groups, all_members)
        raw = json.dumps(exp_dict, ensure_ascii=False, indent=2).encode("utf-8")
        return make_download_response(
            raw,
            "application/json; charset=utf-8",
            "HUG検索結果.json",
            "hug_search.json",
        )
    if fmt == "cardcsv":
        raw_csv = export_search_card_csv(res, all_groups, all_members)
        return make_download_response(
            raw_csv,
            "text/csv; charset=utf-8",
            "HUG検索結果_カード画像用.csv",
            "hug_search_cards.csv",
        )
    if fmt == "fullcsv":
        exp_dict = export_search_json(res, all_groups, all_members)
        raw_zip = export_full_csv_zip(
            exp_dict["cards_event"],
            exp_dict["evacuee_groups"],
            exp_dict["group_members"],
        )
        return make_download_response(
            raw_zip,
            "application/zip",
            "HUG検索結果_全項目CSV.zip",
            "hug_search_full_csv.zip",
        )

    raise ValidationError(
        [Issue(field="format", message=f"未対応の出力形式です: {format}")],
        message=f"未対応の出力形式です: {format}",
    )


@router.get("/saved-searches")
def list_saved_searches(repo: Repository = Depends(get_repo)) -> list[dict[str, Any]]:
    """保存済み検索の一覧を返す."""
    return repo.list_saved_searches()


@router.post("/saved-searches", status_code=status.HTTP_201_CREATED)
def create_saved_search(
    payload: dict[str, Any] = Body(...),
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """検索条件と検索結果のID一覧に名前を付けて保存する."""
    name = str(payload.get("name") or "")
    filters = payload.get("filters") or {}
    result_ids = payload.get("result_ids")
    if result_ids is None:
        sr = _run_repo_search(repo, filters)
        result_ids = [u["id"] for u in sr.ordered_units] + [
            m["member_id"] for m in sr.persons + sr.pets
        ]
    return repo.create_saved_search(name, filters, list(result_ids))


@router.get("/saved-searches/{search_id}")
def get_saved_search(
    search_id: int,
    repo: Repository = Depends(get_repo),
) -> dict[str, Any]:
    """指定IDの保存済み検索を取得し、現在のDBに対する再検索結果も合わせて返す."""
    saved = repo.get_saved_search(search_id)
    if saved is None:
        raise NotFoundError(f"保存済み検索 '{search_id}' が見つかりません", record_id=str(search_id))
    sr = _run_repo_search(repo, saved.get("filters") or {})
    out = dict(saved)
    out["search_result"] = sr.to_dict()
    return out


@router.delete("/saved-searches/{search_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_search(
    search_id: int,
    repo: Repository = Depends(get_repo),
) -> Response:
    """指定IDの保存済み検索を削除する."""
    repo.delete_saved_search(search_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
