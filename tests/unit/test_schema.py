"""単体テスト: スキーマ定義 (SC-01 〜 SC-07)."""
from __future__ import annotations

import json
from pathlib import Path
import re

from hugdb import config, schema

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
S2_PATH = FIXTURES_DIR / "sample_format2.json"


def _parse_design_doc_options(md_text: str) -> dict[str, tuple[str, ...]]:
    """詳細設計書 V6.2.md の 3章から選択肢群 1.1〜6.4 を抽出する."""
    results: dict[str, list[str]] = {}
    current_group: str | None = None

    for raw_line in md_text.splitlines():
        line = raw_line.strip()
        m_header = re.search(r"選択肢群\s*(\d+\.\d+)[：:]", line)
        if m_header:
            current_group = m_header.group(1)
            results[current_group] = []
            continue
        if current_group:
            if line.startswith("##") or line.startswith("###"):
                current_group = None
                continue
            if line.startswith("*"):
                content = line.lstrip("*").strip()
                items = [it.strip() for it in content.split("/") if it.strip()]
                results[current_group].extend(items)
    return {k: tuple(v) for k, v in results.items()}


def test_sc_01_design_doc_options_match():
    """SC-01: 設計書 md の「選択肢群 X.X」を解析し、schema.py の定数と比べる."""
    md_text = config.DESIGN_DOC_PATH.read_text(encoding="utf-8")
    doc_groups = _parse_design_doc_options(md_text)
    assert len(doc_groups) == 24
    assert set(doc_groups.keys()) == set(schema.OPTION_GROUPS.keys())
    for grp_id, expected_opts in doc_groups.items():
        actual_opts = schema.OPTION_GROUPS[grp_id]
        assert actual_opts == expected_opts, f"選択肢群 {grp_id} が設計書と不一致"


def test_sc_02_event_fields_key_order():
    """SC-02: EVENT_FIELDS のキー順が S2 のイベントのキー順と一致する."""
    s2 = json.loads(S2_PATH.read_text(encoding="utf-8"))
    ev_keys = tuple(s2["cards_event"][0].keys())
    assert schema.EVENT_KEY_ORDER == ev_keys


def test_sc_03_group_fields_key_order():
    """SC-03: GROUP_FIELDS のキー順が S2 のグループのキー順と一致する."""
    s2 = json.loads(S2_PATH.read_text(encoding="utf-8"))
    grp_keys = tuple(s2["evacuee_groups"][0].keys())
    assert schema.GROUP_KEY_ORDER == grp_keys


def test_sc_04_member_key_order_person_and_pet():
    """SC-04: MEMBER_KEY_ORDER['人物'] / ['ペット'] が S2 の M-0001 / M-0010 のキー順と一致する."""
    s2 = json.loads(S2_PATH.read_text(encoding="utf-8"))
    members = {m["member_id"]: m for m in s2["group_members"]}
    person_keys = tuple(members["M-0001"].keys())
    pet_keys = tuple(members["M-0010"].keys())
    assert schema.MEMBER_KEY_ORDER["人物"] == person_keys
    assert schema.MEMBER_KEY_ORDER["ペット"] == pet_keys


def test_sc_05_condition_fields_present_in_event_and_group():
    """SC-05: 検索条件のフィールド（6選択次元×2 + 日付×2）がイベントとグループの両方にある."""
    assert len(schema.MULTI_CONDITION_DIMENSIONS) == 6
    assert len(schema.CONDITION_DIMENSIONS) == 7
    cond_names = [f.name for f in schema.CONDITION_FIELDS]
    assert len(cond_names) == 14
    for name in cond_names:
        assert name in schema.EVENT_FIELD_MAP
        assert name in schema.GROUP_FIELD_MAP


def test_sc_06_required_flags_match_design_doc():
    """SC-06: 必須フラグが設計書の「必須 ○」と一致する（statement は人物のみ必須）."""
    req_event = {f.name for f in schema.EVENT_FIELDS if f.required is True}
    assert req_event == {
        "card_id",
        "event_name",
        "category",
        "priority",
        "difficulty",
        "must_respond",
        "content",
    }

    req_group = {f.name for f in schema.GROUP_FIELDS if f.required is True}
    assert req_group == {
        "group_id",
        "group_name",
        "member_count",
        "evacuation_origin",
        "urgency_level",
        "pet_count",
    }

    req_member_always = {f.name for f in schema.MEMBER_FIELDS if f.required is True}
    assert req_member_always == {
        "member_id",
        "group_id",
        "data_type",
        "appearance",
        "training_point",
    }
    assert schema.MEMBER_FIELD_MAP["statement"].required == "人物"


def test_sc_07_schema_to_dict_serializable():
    """SC-07: /api/schema 用の JSON 化で全フィールドに必須キーが揃っている."""
    data = schema.schema_to_dict()
    json_str = json.dumps(data, ensure_ascii=False)
    parsed = json.loads(json_str)
    required_keys = {"name", "label", "kind", "options", "required", "section"}
    for collection in ("events", "groups", "members"):
        assert len(parsed[collection]) > 0
        for fld in parsed[collection]:
            assert required_keys.issubset(fld.keys())
