"""単体テスト: 検証・正規化 (VA-01 〜 VA-30)."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from hugdb.validation import ValidationContext, has_missing_required, validate

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
S2_PATH = FIXTURES_DIR / "sample_format2.json"


@pytest.fixture(scope="module")
def s2_data() -> dict:
    return json.loads(S2_PATH.read_text(encoding="utf-8"))


def test_va_01_s2_lenient_zero_errors(s2_data):
    """VA-01: S2 の全レコードを lenient で検証 → エラー0件."""
    ev_ids = {e["card_id"] for e in s2_data["cards_event"]}
    grp_ids = {g["group_id"] for g in s2_data["evacuee_groups"]}
    prereq_map = {e["card_id"]: e.get("prerequisite_card_id") for e in s2_data["cards_event"]}

    for ev in s2_data["cards_event"]:
        ctx = ValidationContext(known_event_ids=ev_ids, prerequisite_map=prereq_map)
        rep = validate("event", ev, ctx, mode="lenient")
        assert rep.errors == []

    for grp in s2_data["evacuee_groups"]:
        members = [m for m in s2_data["group_members"] if m["group_id"] == grp["group_id"]]
        ctx = ValidationContext(group_members=members)
        rep = validate("group", grp, ctx, mode="lenient")
        assert rep.errors == []

    for mem in s2_data["group_members"]:
        ctx = ValidationContext(known_group_ids=grp_ids)
        rep = validate("member", mem, ctx, mode="lenient")
        assert rep.errors == []


def test_va_02_s2_strict_zero_errors(s2_data):
    """VA-02: S2 の全レコードを strict で検証 → エラー0件（ペットの statement が空でもエラーにならない）."""
    ev_ids = {e["card_id"] for e in s2_data["cards_event"]}
    grp_ids = {g["group_id"] for g in s2_data["evacuee_groups"]}
    prereq_map = {e["card_id"]: e.get("prerequisite_card_id") for e in s2_data["cards_event"]}

    for ev in s2_data["cards_event"]:
        ctx = ValidationContext(known_event_ids=ev_ids, prerequisite_map=prereq_map)
        rep = validate("event", ev, ctx, mode="strict")
        assert rep.errors == []

    for grp in s2_data["evacuee_groups"]:
        members = [m for m in s2_data["group_members"] if m["group_id"] == grp["group_id"]]
        ctx = ValidationContext(group_members=members)
        rep = validate("group", grp, ctx, mode="strict")
        assert rep.errors == []

    for mem in s2_data["group_members"]:
        ctx = ValidationContext(known_group_ids=grp_ids)
        rep = validate("member", mem, ctx, mode="strict")
        assert rep.errors == []


def test_va_03_event_name_empty_or_whitespace(s2_data):
    """VA-03: strict で event_name が空 / 空白だけ → 必須エラー."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    for bad in ("", "   ", None):
        ev["event_name"] = bad
        rep = validate("event", ev, mode="strict")
        assert any(e.field == "event_name" for e in rep.errors)
        rep_lenient = validate("event", ev, mode="lenient")
        assert rep_lenient.errors == []
        assert any(w.field == "event_name" for w in rep_lenient.warnings)
        assert "event_name" in has_missing_required("event", rep_lenient.normalized)


def test_va_04_category_empty_array(s2_data):
    """VA-04: strict で category=[] → 必須エラー."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["category"] = []
    rep = validate("event", ev, mode="strict")
    assert any(e.field == "category" for e in rep.errors)


def test_va_05_priority_boundaries(s2_data):
    """VA-05: priority が -1 / 0 / 10 / 11 → -1 と 11 はエラー、0 と 10 は可."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    for valid_p in (0, 10):
        ev["priority"] = valid_p
        rep = validate("event", ev, mode="strict")
        assert rep.errors == []

    for invalid_p in (-1, 11):
        ev["priority"] = invalid_p
        rep = validate("event", ev, mode="strict")
        assert any(e.field == "priority" for e in rep.errors)


def test_va_06_priority_invalid_types(s2_data):
    """VA-06: priority='abc' / 2.5 / True → 型エラー."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    for bad_val in ("abc", 2.5, True, False):
        ev["priority"] = bad_val
        rep = validate("event", ev, mode="lenient")
        assert any(e.field == "priority" for e in rep.errors)


def test_va_07_priority_numeric_string_in_lenient(s2_data):
    """VA-07: priority='3'（数字の文字列）→ lenient では 3 に変換し、警告を出す."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["priority"] = "3"
    rep = validate("event", ev, mode="lenient")
    assert rep.errors == []
    assert rep.normalized["priority"] == 3
    assert any(w.field == "priority" for w in rep.warnings)


def test_va_08_person_statement_empty_in_strict(s2_data):
    """VA-08: strict で人物の statement='' → 必須エラー."""
    mem = copy.deepcopy(s2_data["group_members"][0])
    mem["statement"] = ""
    rep = validate("member", mem, mode="strict")
    assert any(e.field == "statement" for e in rep.errors)


def test_va_09_person_statement_missing_in_lenient(s2_data):
    """VA-09: lenient で人物の statement が無い → 警告を出し、'' を補う."""
    mem = copy.deepcopy(s2_data["group_members"][0])
    del mem["statement"]
    rep = validate("member", mem, mode="lenient")
    assert rep.errors == []
    assert any(w.field == "statement" for w in rep.warnings)
    assert rep.normalized["statement"] == ""


def test_va_10_pet_statement_empty_no_warning_in_strict(s2_data):
    """VA-10: ペットの statement='' → strict でも警告なし."""
    pet = copy.deepcopy( next(m for m in s2_data["group_members"] if m["data_type"] == "ペット") )
    pet["statement"] = ""
    rep = validate("member", pet, mode="strict")
    assert rep.errors == []
    assert rep.warnings == []


def test_va_11_pet_relationship_pet_no_warning(s2_data):
    """VA-11: ペットの relationship='ペット' → 警告なし."""
    pet = copy.deepcopy( next(m for m in s2_data["group_members"] if m["data_type"] == "ペット") )
    pet["relationship"] = "ペット"
    rep = validate("member", pet, mode="strict")
    assert rep.errors == []
    assert rep.warnings == []


def test_va_12_person_relationship_pet_warning(s2_data):
    """VA-12: 人物の relationship='ペット' → 選択肢外の警告 (lenient) / エラー (strict)."""
    mem = copy.deepcopy(s2_data["group_members"][0])
    mem["relationship"] = "ペット"
    rep_lenient = validate("member", mem, mode="lenient")
    assert rep_lenient.errors == []
    assert any(w.field == "relationship" for w in rep_lenient.warnings)

    rep_strict = validate("member", mem, mode="strict")
    assert any(e.field == "relationship" for e in rep_strict.errors)


def test_va_13_pet_person_fields_preserved_without_validation(s2_data):
    """VA-13: ペットの人物用項目（skills=['人懐こい'] など）→ 選択肢の検証をせず、そのまま保持する."""
    pet = copy.deepcopy( next(m for m in s2_data["group_members"] if m["data_type"] == "ペット") )
    pet["skills"] = ["人懐こい", "カスタムペット特技"]
    rep = validate("member", pet, mode="strict")
    assert rep.errors == []
    assert rep.warnings == []
    assert rep.normalized["skills"] == ["人懐こい", "カスタムペット特技"]


def test_va_14_unknown_option_value(s2_data):
    """VA-14: category=['存在しない種別'] → lenient は警告で保持、strict は選択肢外エラー."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["category"] = ["存在しない種別"]
    rep_l = validate("event", ev, mode="lenient")
    assert rep_l.errors == []
    assert any(w.field == "category" for w in rep_l.warnings)
    assert rep_l.normalized["category"] == ["存在しない種別"]

    rep_s = validate("event", ev, mode="strict")
    assert any(e.field == "category" for e in rep_s.errors)


def test_va_15_array_field_null_to_empty_list(s2_data):
    """VA-15: 配列項目が null → [] に変換する."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["match_shelters"] = None
    rep = validate("event", ev, mode="strict")
    assert rep.errors == []
    assert rep.normalized["match_shelters"] == []


def test_va_16_array_field_string_to_list_with_warning(s2_data):
    """VA-16: 配列項目が文字列 '地震' → ['地震'] に変換し、警告を出す."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["match_disaster_types"] = "地震"
    rep = validate("event", ev, mode="lenient")
    assert rep.errors == []
    assert rep.normalized["match_disaster_types"] == ["地震"]
    assert any(w.field == "match_disaster_types" for w in rep.warnings)


def test_va_17_array_deduplication_preserves_order(s2_data):
    """VA-17: 配列内の重複 ['地震','豪雨','地震'] → 重複を除き、順序は保つ."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["match_disaster_types"] = ["地震", "豪雨", "地震"]
    rep = validate("event", ev, mode="strict")
    assert rep.errors == []
    assert rep.normalized["match_disaster_types"] == ["地震", "豪雨"]


def test_va_18_missing_keys_filled_with_defaults():
    """VA-18: キーが欠けているレコード → スキーマに沿って既定値（[] / null）を補う."""
    minimal_ev = {
        "card_id": "EV-001",
        "event_name": "テスト",
        "category": ["行政対応"],
        "priority": 1,
        "difficulty": "初級",
        "must_respond": "なし",
        "content": "本文",
    }
    rep = validate("event", minimal_ev, mode="strict")
    assert rep.errors == []
    assert rep.normalized["match_shelters"] == []
    assert rep.normalized["prerequisite_card_id"] is None
    assert rep.normalized["match_dates"] is None


def test_va_19_unknown_key_warning_and_removed(s2_data):
    """VA-19: 未知のキー foo → 警告を出し、正規化結果からは削除する."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["foo"] = "bar"
    rep = validate("event", ev, mode="lenient")
    assert rep.errors == []
    assert any(w.field == "foo" for w in rep.warnings)
    assert "foo" not in rep.normalized


def test_va_20_same_value_in_match_and_exclude(s2_data):
    """VA-20: 同じ値が match と exclude の両方にある → strict はエラー、lenient は警告."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["match_weather"] = ["大雨"]
    ev["exclude_weather"] = ["大雨"]
    rep_s = validate("event", ev, mode="strict")
    assert any(e.field == "match_weather" for e in rep_s.errors)

    rep_l = validate("event", ev, mode="lenient")
    assert rep_l.errors == []
    assert any(w.field == "match_weather" for w in rep_l.warnings)


def test_va_21_self_prerequisite_reference(s2_data):
    """VA-21: 自分自身を前提カードにしている → strict はエラー、lenient は警告して null に."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["prerequisite_card_id"] = ev["card_id"]
    rep_s = validate("event", ev, mode="strict")
    assert any(e.field == "prerequisite_card_id" for e in rep_s.errors)

    rep_l = validate("event", ev, mode="lenient")
    assert rep_l.errors == []
    assert any(w.field == "prerequisite_card_id" for w in rep_l.warnings)
    assert rep_l.normalized["prerequisite_card_id"] is None


def test_va_22_prerequisite_cycle_detection(s2_data):
    """VA-22: 前提カードの循環（A→B→A、A→B→C→A）→ エラー（循環の経路をメッセージに含める）."""
    ev_a = copy.deepcopy(s2_data["cards_event"][0])
    ev_a["card_id"] = "EV-A"
    ev_a["prerequisite_card_id"] = "EV-B"

    ctx_2 = ValidationContext(
        known_event_ids={"EV-A", "EV-B"},
        prerequisite_map={"EV-A": "EV-B", "EV-B": "EV-A"},
    )
    rep_2 = validate("event", ev_a, ctx_2, mode="strict")
    assert any("EV-A -> EV-B -> EV-A" in e.message for e in rep_2.errors)

    ctx_3 = ValidationContext(
        known_event_ids={"EV-A", "EV-B", "EV-C"},
        prerequisite_map={"EV-A": "EV-B", "EV-B": "EV-C", "EV-C": "EV-A"},
    )
    rep_3 = validate("event", ev_a, ctx_3, mode="strict")
    assert any("EV-A -> EV-B -> EV-C -> EV-A" in e.message for e in rep_3.errors)

    rep_l = validate("event", ev_a, ctx_3, mode="lenient")
    assert rep_l.errors == []
    assert rep_l.normalized["prerequisite_card_id"] is None


def test_va_23_nonexistent_prerequisite_card_id(s2_data):
    """VA-23: 前提カードIDが存在しない → strict はエラー、lenient は警告."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["prerequisite_card_id"] = "EV-999"
    ctx = ValidationContext(known_event_ids={"EV-001", "EV-002"})

    rep_s = validate("event", ev, ctx, mode="strict")
    assert any(e.field == "prerequisite_card_id" for e in rep_s.errors)

    rep_l = validate("event", ev, ctx, mode="lenient")
    assert rep_l.errors == []
    assert any(w.field == "prerequisite_card_id" for w in rep_l.warnings)


def test_va_24_member_count_mismatch_overwritten(s2_data):
    """VA-24: member_count が実際の人数と合わない → 警告を出し、実際の人数で上書きする."""
    grp = copy.deepcopy(s2_data["evacuee_groups"][0])
    grp["member_count"] = 99
    members = [m for m in s2_data["group_members"] if m["group_id"] == grp["group_id"]]
    ctx = ValidationContext(group_members=members)
    rep = validate("group", grp, ctx, mode="lenient")
    assert rep.errors == []
    assert any(w.field == "member_count" for w in rep.warnings)
    assert rep.normalized["member_count"] == 2


def test_va_25_household_with_zero_persons_error_in_strict(s2_data):
    """VA-25: 人物が0人の世帯 → strict はエラー「人物が1名以上必要」."""
    grp = copy.deepcopy(s2_data["evacuee_groups"][0])
    only_pet = [{"member_id": "M-0010", "group_id": grp["group_id"], "data_type": "ペット"}]
    ctx = ValidationContext(group_members=only_pet)
    rep = validate("group", grp, ctx, mode="strict")
    assert any(e.field == "member_count" and "人物が1名以上必要" in e.message for e in rep.errors)


def test_va_26_age_boundaries(s2_data):
    """VA-26: age が -1 / 0 / 120 / 121 / 空 → -1 はエラー、0〜120 は可、121 は警告、空は可."""
    mem = copy.deepcopy(s2_data["group_members"][0])

    mem["age"] = -1
    rep_neg = validate("member", mem, mode="strict")
    assert any(e.field == "age" for e in rep_neg.errors)

    for ok_age in (0, 120, None, ""):
        mem["age"] = ok_age
        rep_ok = validate("member", mem, mode="strict")
        assert rep_ok.errors == []
        assert rep_ok.warnings == []

    mem["age"] = 121
    rep_warn = validate("member", mem, mode="strict")
    assert rep_warn.errors == []
    assert any(w.field == "age" for w in rep_warn.warnings)


def test_va_27_required_people_boundaries(s2_data):
    """VA-27: required_people が 0 / 負数 → 0 は可、負数はエラー."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["required_people"] = 0
    assert validate("event", ev, mode="strict").errors == []

    ev["required_people"] = -1
    rep_neg = validate("event", ev, mode="strict")
    assert any(e.field == "required_people" for e in rep_neg.errors)


def test_va_28_date_range_normalization(s2_data):
    """VA-28: 日付範囲の正規化 ' 1/1 - 1/3 ' → '01/01-01/03' になる."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["match_dates"] = " 1/1 - 1/3 "
    rep = validate("event", ev, mode="strict")
    assert rep.errors == []
    assert rep.normalized["match_dates"] == "01/01-01/03"


def test_va_29_invalid_date_range(s2_data):
    """VA-29: 日付範囲 '13/40' → strict はエラー、lenient は警告."""
    ev = copy.deepcopy(s2_data["cards_event"][0])
    ev["match_dates"] = "13/40"
    rep_s = validate("event", ev, mode="strict")
    assert any(e.field == "match_dates" for e in rep_s.errors)

    rep_l = validate("event", ev, mode="lenient")
    assert rep_l.errors == []
    assert any(w.field == "match_dates" for w in rep_l.warnings)


def test_va_30_invalid_member_data_type(s2_data):
    """VA-30: 構成員の data_type が「人物」「ペット」以外 → エラー."""
    mem = copy.deepcopy(s2_data["group_members"][0])
    mem["data_type"] = "ロボット"
    rep_s = validate("member", mem, mode="strict")
    assert any(e.field == "data_type" for e in rep_s.errors)
    rep_l = validate("member", mem, mode="lenient")
    assert any(e.field == "data_type" for e in rep_l.errors)
