"""単体テスト: 休日種別判定 (HO-01 〜 HO-15)."""
from __future__ import annotations

from datetime import date

import pytest

from hugdb import config
from hugdb.holidays import holiday_types


def test_ho_01_weekday():
    """HO-01: 2026-11-04（水） → {平日}."""
    assert holiday_types(date(2026, 11, 4)) == {"平日"}


def test_ho_02_weekend():
    """HO-02: 2026-11-07（土） → {土日}."""
    assert holiday_types(date(2026, 11, 7)) == {"土日"}


def test_ho_03_national_holiday():
    """HO-03: 2026-11-03（火・文化の日） → {祝日}."""
    assert holiday_types(date(2026, 11, 3)) == {"祝日"}


def test_ho_04_new_year_day():
    """HO-04: 2026-01-01（木・元日） → {祝日, 年末年始}."""
    assert holiday_types(date(2026, 1, 1)) == {"祝日", "年末年始"}


def test_ho_05_golden_week_sunday_holiday():
    """HO-05: 2026-05-03（日・憲法記念日） → {土日, 祝日, 大型連休}."""
    assert holiday_types(date(2026, 5, 3)) == {"土日", "祝日", "大型連休"}


def test_ho_06_substitute_holiday_in_gw():
    """HO-06: 2026-05-06（水・振替休日） → {祝日, 大型連休}."""
    assert holiday_types(date(2026, 5, 6)) == {"祝日", "大型連休"}


def test_ho_07_citizens_holiday():
    """HO-07: 2026-09-22（火・国民の休日） → {祝日}."""
    assert holiday_types(date(2026, 9, 22)) == {"祝日"}


def test_ho_08_dec_28_before_year_end():
    """HO-08: 2026-12-28（月） → {平日}（年末年始の範囲外）."""
    assert holiday_types(date(2026, 12, 28)) == {"平日"}


def test_ho_09_dec_29_start_of_year_end():
    """HO-09: 2026-12-29（火） → {年末年始}."""
    assert holiday_types(date(2026, 12, 29)) == {"年末年始"}


def test_ho_10_jan_03_sunday_end_of_year_end():
    """HO-10: 2027-01-03（日） → {土日, 年末年始}."""
    assert holiday_types(date(2027, 1, 3)) == {"土日", "年末年始"}


def test_ho_11_jan_04_after_year_end():
    """HO-11: 2027-01-04（月） → {平日}."""
    assert holiday_types(date(2027, 1, 4)) == {"平日"}


def test_ho_12_obon_period():
    """HO-12: 2026-08-13（木） → {大型連休}（お盆）."""
    assert holiday_types(date(2026, 8, 13)) == {"大型連休"}


def test_ho_13_gw_boundary_apr_28_and_29():
    """HO-13: 2026-04-28（火） / 2026-04-29（水・昭和の日） → {平日} / {祝日, 大型連休}."""
    assert holiday_types(date(2026, 4, 28)) == {"平日"}
    assert holiday_types(date(2026, 4, 29)) == {"祝日", "大型連休"}


def test_ho_14_custom_long_holiday_periods(monkeypatch: pytest.MonkeyPatch):
    """HO-14: 設定で大型連休の期間を変える → 変更後の期間で判定する."""
    monkeypatch.setattr(config, "LONG_HOLIDAY_PERIODS", [((7, 20), (7, 25))])
    assert "大型連休" in holiday_types(date(2026, 7, 22))
    assert "大型連休" not in holiday_types(date(2026, 8, 13))


def test_ho_15_string_and_invalid_date():
    """HO-15: '2026/11/03' などの文字列 / 不正な日付 → 解析して判定 / ValueError."""
    assert holiday_types("2026/11/03") == {"祝日"}
    assert holiday_types("2026-11-04") == {"平日"}
    with pytest.raises(ValueError):
        holiday_types("invalid-date")
    with pytest.raises(ValueError):
        holiday_types("2026-13-40")
