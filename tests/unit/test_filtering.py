"""単体テスト: 絞り込み・検索 (FI-01 〜 FI-26)."""
from __future__ import annotations

import copy
import pytest

from hugdb.filtering import FieldFilter, SearchQuery, execute_search
from hugdb.matching import TrainingConditions
from hugdb.ordering import build_units, compute_order
from hugdb.schema import EVENT_FIELDS, GROUP_FIELDS, MEMBER_FIELDS


def _run(s2_payload: dict, **kwargs):
    q = SearchQuery.from_dict(kwargs)
    return execute_search(
        q,
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )


def test_fi_01_keyword_blanket(s2_payload: dict):
    """FI-01: キーワード「毛布」 → EV-006 がヒットする."""
    res = _run(s2_payload, keyword="毛布")
    assert [e["card_id"] for e in res.events] == ["EV-006"]


def test_fi_02_keyword_in_member_hits_household_and_person(s2_payload: dict):
    """FI-02: キーワードが構成員の項目にだけある（例「授乳室」） → 世帯表示では GRP-002、人物表示では M-0004 がヒットする."""
    res_hh = _run(s2_payload, view="household", keyword="授乳室")
    assert [h["group"]["group_id"] for h in res_hh.households] == ["GRP-002"]

    res_p = _run(s2_payload, view="person", keyword="授乳室")
    assert [m["member_id"] for m in res_p.persons] == ["M-0004"]


def test_fi_03_keyword_nfkc_and_case_insensitive(s2_payload: dict):
    """FI-03: キーワードの全角・半角、大文字・小文字 → 正規化（NFKC）して同じ扱いにする."""
    r1 = _run(s2_payload, keyword="５強")
    r2 = _run(s2_payload, keyword="5強")
    assert [e["card_id"] for e in r1.events] == [e["card_id"] for e in r2.events]
    assert "EV-001" in [e["card_id"] for e in r1.events]


def test_fi_04_multiple_keywords_and_search(s2_payload: dict):
    """FI-04: スペース区切りの複数キーワード → AND で検索する."""
    res = _run(s2_payload, keyword="毛布　深夜")
    assert [e["card_id"] for e in res.events] == ["EV-006"]


def test_fi_05_category_any(s2_payload: dict):
    """FI-05: category=[行政対応]、「いずれかに一致」 → 6件."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "category", "op": "any", "value": ["行政対応"]}],
    )
    assert len(res.events) == 6


def test_fi_06_category_all(s2_payload: dict):
    """FI-06: category=[行政対応, 避難所管理]、「すべてに一致」 → 両方を含むカードだけ（EV-001 など）."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "category", "op": "all", "value": ["行政対応", "避難所管理"]}],
    )
    assert len(res.events) > 0
    assert "EV-001" in [e["card_id"] for e in res.events]
    for e in res.events:
        assert {"行政対応", "避難所管理"}.issubset(set(e["category"]))


def test_fi_07_difficulty_filter(s2_payload: dict):
    """FI-07: difficulty=[上級, 極高（現場混乱）] → 5件."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "difficulty", "op": "any", "value": ["上級", "極高（現場混乱）"]}],
    )
    assert len(res.events) == 5


def test_fi_08_must_respond_filter(s2_payload: dict):
    """FI-08: must_respond=[あり（要即時対応）] → 11件."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "must_respond", "op": "any", "value": ["あり（要即時対応）"]}],
    )
    assert len(res.events) == 11


def test_fi_09_priority_range(s2_payload: dict):
    """FI-09: priority の範囲 0〜1 → 8件（0が1件、1が7件）."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "priority", "op": "range", "value": {"min": 0, "max": 1}}],
    )
    assert len(res.events) == 8


def test_fi_10_relative_timing_event(s2_payload: dict):
    """FI-10: relative_timing=[終盤]（イベント） → 4件."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "relative_timing", "op": "any", "value": ["終盤"]}],
    )
    assert len(res.events) == 4


def test_fi_11_disaster_phase_event(s2_payload: dict):
    """FI-11: disaster_phase=[4日目]（イベント） → 4件."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "disaster_phase", "op": "any", "value": ["4日目"]}],
    )
    assert len(res.events) == 4


def test_fi_12_prerequisite_empty(s2_payload: dict):
    """FI-12: 「未設定のもの」で prerequisite_card_id を絞り込む → 16件."""
    res = _run(
        s2_payload,
        view="event",
        fields=[{"field": "prerequisite_card_id", "op": "empty", "value": True}],
    )
    assert len(res.events) == 16


def test_fi_13_urgency_level_household(s2_payload: dict):
    """FI-13: urgency_level=[要即時対応]（世帯） → 6件."""
    res = _run(
        s2_payload,
        view="household",
        fields=[{"field": "urgency_level", "op": "any", "value": ["要即時対応"]}],
    )
    assert len(res.households) == 6


def test_fi_14_personal_equipment_wheelchair(s2_payload: dict):
    """FI-14: personal_equipment=[車椅子] → 1件."""
    res = _run(
        s2_payload,
        view="household",
        fields=[{"field": "personal_equipment", "op": "any", "value": ["車椅子"]}],
    )
    assert len(res.households) == 1
    assert res.households[0]["group"]["group_id"] == "GRP-008"


def test_fi_15_member_vulnerability_filters_households(s2_payload: dict):
    """FI-15: 構成員の vulnerabilities=[外国籍] で世帯を絞り込む → 構成員が該当する世帯だけ."""
    res = _run(
        s2_payload,
        view="household",
        fields=[{"field": "vulnerabilities", "op": "any", "value": ["外国籍"]}],
    )
    assert [h["group"]["group_id"] for h in res.households] == ["GRP-003"]


def test_fi_16_person_age_range_excludes_pets(s2_payload: dict):
    """FI-16: 人物の age の範囲 0〜6 → 該当する人物だけ（ペットは含まない）."""
    res = _run(
        s2_payload,
        view="all",
        fields=[{"field": "age", "op": "range", "value": {"min": 0, "max": 6}}],
    )
    assert len(res.persons) == 2
    assert res.pets == []
    for p in res.persons:
        assert p["data_type"] == "人物"
        assert 0 <= p["age"] <= 6


def test_fi_17_pet_type_dog(s2_payload: dict):
    """FI-17: ペットの pet_type=[犬] → 2件."""
    res = _run(
        s2_payload,
        view="pet",
        fields=[{"field": "pet_type", "op": "any", "value": ["犬"]}],
    )
    assert len(res.pets) == 2


def test_fi_18_training_condition_all_match(s2_payload: dict):
    """FI-18: 訓練条件 災害=地震・避難所=小平第五小学校 → 全件."""
    res = _run(
        s2_payload,
        training={"disaster_type": "地震", "shelter": "小平第五小学校"},
    )
    assert len(res.events) == 20
    assert len(res.households) == 10


def test_fi_19_training_condition_none_match(s2_payload: dict):
    """FI-19: 訓練条件 災害=豪雨 → 0件."""
    res = _run(
        s2_payload,
        training={"disaster_type": "豪雨"},
    )
    assert len(res.events) == 0
    assert len(res.households) == 0


def test_fi_20_training_condition_multi_infrastructure(s2_payload: dict):
    """FI-20: 訓練条件 インフラ={停電, 断水}（複数選択） → MA-07/08 の判定に従った件数."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][0]["match_infrastructure"] = ["断水"]
    data["cards_event"][1]["exclude_infrastructure"] = ["停電"]
    data["cards_event"][2]["match_infrastructure"] = ["ガス停止"]

    res = _run(data, view="event", training={"infrastructure": ["停電", "断水"]})
    ids = {e["card_id"] for e in res.events}
    assert "EV-001" in ids
    assert "EV-002" not in ids
    assert "EV-003" not in ids
    assert len(ids) == 18


def test_fi_21_training_condition_multi_weather_and_holiday(s2_payload: dict):
    """FI-21: 天候・休日の複数選択 → 同じく OR で判定する."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][0]["match_weather"] = ["雨"]
    data["cards_event"][1]["exclude_holiday_type"] = ["祝日"]

    res = _run(
        data,
        view="event",
        training={"weather": ["晴れ", "雨"], "holiday_type": ["土日", "祝日"]},
    )
    ids = {e["card_id"] for e in res.events}
    assert "EV-001" in ids
    assert "EV-002" not in ids


def test_fi_22_combined_keyword_field_and_training(s2_payload: dict):
    """FI-22: キーワード＋項目別＋訓練条件を組み合わせる → すべて AND で判定する."""
    res = _run(
        s2_payload,
        view="event",
        keyword="トイレ",
        fields=[{"field": "priority", "op": "range", "value": {"min": 0, "max": 1}}],
        training={"disaster_type": "地震"},
    )
    assert [e["card_id"] for e in res.events] == ["EV-003"]


def test_fi_23_switch_views(s2_payload: dict):
    """FI-23: 表示種別（イベント/世帯/人物/ペット）を切り替える → 該当する種別だけを返す."""
    r_ev = _run(s2_payload, view="event")
    assert len(r_ev.events) == 20 and r_ev.households == []

    r_hh = _run(s2_payload, view="household")
    assert len(r_hh.households) == 10 and r_hh.events == []

    r_pe = _run(s2_payload, view="person")
    assert len(r_pe.persons) == 19 and r_pe.pets == []

    r_pt = _run(s2_payload, view="pet")
    assert len(r_pt.pets) == 2 and r_pt.persons == []


def test_fi_24_sort_modes(s2_payload: dict):
    """FI-24: 並び順「デッキ順 / ID / 更新日 / 優先度」 → 期待どおりの順。デッキ順は ordering と一致."""
    r_deck = _run(s2_payload, sort="deck")
    expected_units = compute_order(build_units(s2_payload["cards_event"], s2_payload["evacuee_groups"]))
    assert [u["id"] for u in r_deck.ordered_units] == [u.id for u in expected_units]

    r_id = _run(s2_payload, sort="id")
    assert [e["card_id"] for e in r_id.events] == [f"EV-{i:03d}" for i in range(1, 21)]

    r_pri = _run(s2_payload, sort="priority")
    priorities = [e["priority"] for e in r_pri.events]
    assert priorities == sorted(priorities)

    r_upd = execute_search(
        SearchQuery(sort="updated"),
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        event_updated_at={"EV-020": "2026-12-31T00:00:00Z", "EV-001": "2026-01-01T00:00:00Z"},
    )
    assert r_upd.events[0]["card_id"] == "EV-020"


@pytest.mark.parametrize(
    "field_def",
    [*EVENT_FIELDS, *GROUP_FIELDS, *MEMBER_FIELDS],
    ids=lambda f: f"{f.section}:{f.name}",
)
def test_fi_25_all_schema_fields_filterable(s2_payload: dict, field_def):
    """FI-25: スキーマの全フィールドを1つずつ絞り込みに使う（パラメータ化テスト）."""
    if field_def.kind == "int":
        flt = FieldFilter(field=field_def.name, op="range", value={"min": 0, "max": 100})
    elif field_def.options:
        flt = FieldFilter(field=field_def.name, op="any", value=[field_def.options[0]])
    else:
        flt = FieldFilter(field=field_def.name, op="empty", value=False)

    res = execute_search(
        SearchQuery(fields=[flt]),
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    assert isinstance(res.counts["units"], int)


def test_fi_26_unknown_field_or_invalid_operator(s2_payload: dict):
    """FI-26: 存在しないフィールド名・不正な演算子 → ValueError."""
    with pytest.raises(ValueError):
        _run(s2_payload, fields=[{"field": "no_such_field", "op": "any", "value": ["x"]}])
    with pytest.raises(ValueError):
        _run(s2_payload, fields=[{"field": "category", "op": "bad_op", "value": ["x"]}])
