"""単体テスト: 条件判定・日付範囲判定 (MA-01 〜 MA-21)."""
from __future__ import annotations

import copy
from datetime import date

from hugdb.matching import (
    TrainingConditions,
    is_eligible,
    matches_date_dimension,
    matches_dimension,
)


def test_ma_01_empty_match_and_exclude_always_matches():
    """MA-01: match・exclude が空で、値が何であっても → 適合."""
    assert matches_dimension([], [], {"地震"}, "災害種類").matched is True


def test_ma_02_null_match_treated_as_empty():
    """MA-02: match が null → 空と同じ扱い."""
    assert matches_dimension(None, None, {"地震"}, "災害種類").matched is True


def test_ma_03_single_match_hit():
    """MA-03: match=[地震]、値={地震} → 適合."""
    assert matches_dimension(["地震"], [], {"地震"}, "災害種類").matched is True


def test_ma_04_single_match_miss():
    """MA-04: match=[地震]、値={豪雨} → 不適合（理由「合致条件外: 災害種類」）."""
    res = matches_dimension(["地震"], [], {"豪雨"}, "災害種類")
    assert res.matched is False
    assert res.reason == "合致条件外: 災害種類"


def test_ma_05_exclude_hit():
    """MA-05: exclude=[大雨]、値={大雨} → 不適合（理由「排除: 天候=大雨」）."""
    res = matches_dimension([], ["大雨"], {"大雨"}, "天候")
    assert res.matched is False
    assert res.reason == "排除: 天候=大雨"


def test_ma_06_exclude_takes_priority_over_match():
    """MA-06: match=[大雨]・exclude=[大雨] → 排除を優先して不適合."""
    res = matches_dimension(["大雨"], ["大雨"], {"大雨"}, "天候")
    assert res.matched is False
    assert "排除: 天候=大雨" in (res.reason or "")


def test_ma_07_multi_value_any_match():
    """MA-07: 複数値 {停電,断水}、match=[断水] → 適合（いずれか1つが含まれればよい）."""
    assert matches_dimension(["断水"], [], {"停電", "断水"}, "インフラ状況").matched is True


def test_ma_08_multi_value_any_exclude():
    """MA-08: 複数値 {停電,断水}、exclude=[停電] → 不適合（いずれか1つでも含まれれば除外）."""
    res = matches_dimension(["断水"], ["停電"], {"停電", "断水"}, "インフラ状況")
    assert res.matched is False
    assert res.reason == "排除: インフラ状況=停電"


def test_ma_09_multi_value_no_overlap_with_match():
    """MA-09: 複数値 {停電,断水}、match=[ガス停止] → 不適合."""
    res = matches_dimension(["ガス停止"], [], {"停電", "断水"}, "インフラ状況")
    assert res.matched is False


def test_ma_10_empty_condition_values_skips_filtering():
    """MA-10: 訓練条件の値が未指定（空集合） → その次元では絞り込まず、適合."""
    assert matches_dimension(["地震"], ["豪雨"], set(), "災害種類").matched is True


def test_ma_11_single_date_match():
    """MA-11: 日付 '08/15'、訓練日 2026-08-15 → 適合."""
    assert matches_date_dimension("08/15", None, date(2026, 8, 15)).matched is True
    assert matches_date_dimension("08/15", None, date(2026, 8, 16)).matched is False


def test_ma_12_date_range_within_year():
    """MA-12: 日付 '01/01-01/03'、訓練日 01/03 / 01/04 → 01/03 は適合、01/04 は不適合."""
    assert matches_date_dimension("01/01-01/03", None, "2026-01-03").matched is True
    assert matches_date_dimension("01/01-01/03", None, "2026-01-04").matched is False


def test_ma_13_date_range_wrapping_year():
    """MA-13: 年をまたぐ範囲 '12/29-01/03'、訓練日 12/31 / 01/02 / 12/28 → 12/31 と 01/02 は適合、12/28 は不適合."""
    assert matches_date_dimension("12/29-01/03", None, "2026-12-31").matched is True
    assert matches_date_dimension("12/29-01/03", None, "2027-01-02").matched is True
    assert matches_date_dimension("12/29-01/03", None, "2026-12-28").matched is False


def test_ma_14_comma_separated_multiple_date_specs():
    """MA-14: 複数指定 '01/01, 05/03-05/05' → どれかに該当すれば適合."""
    spec = "01/01, 05/03-05/05"
    assert matches_date_dimension(spec, None, "2026-01-01").matched is True
    assert matches_date_dimension(spec, None, "2026-05-04").matched is True
    assert matches_date_dimension(spec, None, "2026-05-06").matched is False


def test_ma_15_fullwidth_digits_and_wave_dash():
    """MA-15: 全角数字 '０１/０１－０１/０３'、区切りに '〜' → 半角と同じ結果."""
    assert matches_date_dimension("０１/０１－０１/０３", None, "2026-01-02").matched is True
    assert matches_date_dimension("01/01〜01/03", None, "2026-01-02").matched is True


def test_ma_16_date_spec_as_list():
    """MA-16: 配列で指定 ['01/01','08/15'] → 文字列で指定したときと同じ結果."""
    assert matches_date_dimension(["01/01", "08/15"], None, "2026-08-15").matched is True
    assert matches_date_dimension(["01/01", "08/15"], None, "2026-08-16").matched is False


def test_ma_17_leap_day_in_non_leap_year():
    """MA-17: '02/29'、閏年でない年の 02/28 と 03/01 → どちらも不適合（例外を出さない）."""
    assert matches_date_dimension("02/29", None, "2026-02-28").matched is False
    assert matches_date_dimension("02/29", None, "2026-03-01").matched is False
    assert matches_date_dimension("02/29", None, "2024-02-29").matched is True


def test_ma_18_invalid_date_spec_treated_as_unconstrained_with_warning():
    """MA-18: 書式が不正な 'abc' → 判定時は「条件なし」とみなし、警告用の理由を返す."""
    res = matches_date_dimension("abc", None, "2026-05-01")
    assert res.matched is True
    assert len(res.warnings) == 1


def test_ma_19_exclude_dates_hit():
    """MA-19: exclude_dates が訓練日に該当 → 不適合."""
    res = matches_date_dimension(None, "08/13-08/16", "2026-08-15")
    assert res.matched is False
    assert res.reason == "排除: 日付=08/15"


def test_ma_20_is_eligible_combines_all_reasons(s2_payload: dict):
    """MA-20: is_eligible で全次元を組み合わせ、不採用になった次元の理由をすべて返す."""
    card = copy.deepcopy(s2_payload["cards_event"][0])
    card["match_shelters"] = ["小平第五小学校"]
    card["match_disaster_types"] = ["地震"]
    card["exclude_weather"] = ["大雨"]

    cond = TrainingConditions(
        shelter="上宿小学校",
        disaster_type="豪雨",
        weather={"大雨"},
    )
    ok, reasons = is_eligible(card, cond)
    assert ok is False
    assert "合致条件外: 避難所" in reasons
    assert "合致条件外: 災害種類" in reasons
    assert "排除: 天候=大雨" in reasons


def test_ma_21_time_slot_exact_string_match(s2_payload: dict):
    """MA-21: 時間帯 '夜間 (20:00-24:00)' の文字列が完全一致で判定される."""
    card = copy.deepcopy(s2_payload["cards_event"][0])
    card["match_time_slots"] = ["夜間 (20:00-24:00)"]

    ok1, _ = is_eligible(card, TrainingConditions(time_slot="夜間 (20:00-24:00)"))
    ok2, _ = is_eligible(card, TrainingConditions(time_slot="夜間"))
    assert ok1 is True
    assert ok2 is False
