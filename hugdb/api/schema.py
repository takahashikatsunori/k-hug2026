"""スキーマおよび休日種別判定 API ルーター."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from hugdb.holidays import holiday_types
from hugdb.repository import ValidationError
from hugdb.schema import HOLIDAY_TYPE, schema_to_dict
from hugdb.validation import Issue

router = APIRouter(prefix="/api", tags=["schema"])


@router.get("/schema")
def get_schema() -> dict[str, Any]:
    """フィールド定義・選択肢マスタ・キー順序を返す."""
    return schema_to_dict()


@router.get("/holiday-types")
def get_holiday_types(date: str = Query(..., description="対象日付 (YYYY-MM-DD)")) -> dict[str, Any]:
    """指定日付の休日種別一覧を返す."""
    try:
        types_set = holiday_types(date)
    except ValueError as exc:
        raise ValidationError(
            [Issue(field="date", message=str(exc))],
            message=f"日付の形式が不正です: {date}",
        ) from exc

    ordered = [t for t in HOLIDAY_TYPE if t in types_set]
    return {
        "date": date,
        "holiday_types": ordered,
    }
