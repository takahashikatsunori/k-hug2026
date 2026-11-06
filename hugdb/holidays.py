"""日付から休日種別（平日・土日・祝日・大型連休・年末年始）を判定するモジュール."""
from __future__ import annotations

from datetime import date, datetime
import re

import jpholiday

from hugdb import config


def parse_date(value: date | str) -> date:
    """date または日付文字列 ('YYYY-MM-DD' / 'YYYY/MM/DD') を date に変換する."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not isinstance(value, str):
        raise ValueError(f"日付の形式が不正です: {value!r}")

    s = value.strip().replace("/", "-")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if not m:
        raise ValueError(f"日付の形式が不正です: {value!r}")
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return date(year, month, day)


def _in_mmdd_periods(
    month: int,
    day: int,
    periods: list[tuple[tuple[int, int], tuple[int, int]]],
) -> bool:
    md = (month, day)
    for start, end in periods:
        if start <= end:
            if start <= md <= end:
                return True
        else:
            # 年またぎ（例: 12/29〜1/3）
            if md >= start or md <= end:
                return True
    return False


def holiday_types(
    target_date: date | str,
    *,
    long_holiday_periods: list[tuple[tuple[int, int], tuple[int, int]]] | None = None,
    year_end_periods: list[tuple[tuple[int, int], tuple[int, int]]] | None = None,
) -> set[str]:
    """指定日の休日種別集合を返す。いずれにも該当しない場合は {'平日'} を返す."""
    dt = parse_date(target_date)
    lh_periods = (
        long_holiday_periods
        if long_holiday_periods is not None
        else config.LONG_HOLIDAY_PERIODS
    )
    ye_periods = (
        year_end_periods
        if year_end_periods is not None
        else config.YEAR_END_PERIODS
    )

    result: set[str] = set()

    # 土日
    if dt.weekday() in (5, 6):
        result.add("土日")

    # 祝日（振替休日・国民の休日を含む）
    if jpholiday.is_holiday(dt):
        result.add("祝日")

    # 年末年始
    if _in_mmdd_periods(dt.month, dt.day, ye_periods):
        result.add("年末年始")

    # 大型連休（GW・お盆等）
    if _in_mmdd_periods(dt.month, dt.day, lh_periods):
        result.add("大型連休")

    if not result:
        result.add("平日")

    return result
