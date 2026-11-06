"""単体テスト: 名前の自動生成 (NA-01 〜 NA-09)."""
from __future__ import annotations

import copy

from hugdb.deck import build_deck
from hugdb.names import (
    COMMON_PET_NAMES,
    FEMALE_GIVEN_NAMES,
    MALE_GIVEN_NAMES,
    NEUTRAL_GIVEN_NAMES,
    PET_NAMES_BY_TYPE,
    SURNAMES,
    generate_member_name,
)
from hugdb.repository import Repository


def test_na_01_surname_from_same_household_member():
    """NA-01: 名前が空の人物で、同じ世帯に「国語 太郎」がいる → 姓が「国語」になる."""
    m1 = {"member_id": "M-0001", "data_type": "人物", "name": "国語 太郎", "gender": "男性"}
    m2 = {"member_id": "M-0002", "data_type": "人物", "name": "", "gender": "女性"}
    name = generate_member_name(m2, group={"group_name": "別名グループ"}, household_members=[m1, m2])
    assert name.startswith("国語 ")


def test_na_02_surname_from_group_name_house():
    """NA-02: 世帯の全員の名前が空で、グループ名が「国語家（高齢夫婦）」 → 姓が「国語」になる."""
    m1 = {"member_id": "M-0001", "data_type": "人物", "name": None, "gender": "男性"}
    name = generate_member_name(m1, group={"group_name": "国語家（高齢夫婦）"}, household_members=[m1])
    assert name.startswith("国語 ")


def test_na_03_surname_fallback_to_list():
    """NA-03: 姓の手がかりが無い → 姓のリストから選ぶ."""
    m1 = {"member_id": "M-0001", "data_type": "人物", "name": "", "gender": "男性"}
    name = generate_member_name(m1, group={"group_id": "GRP-001", "group_name": "旅行者3人組"}, household_members=[m1])
    surname = name.split(" ")[0]
    assert surname in SURNAMES


def test_na_04_given_name_by_gender():
    """NA-04: 性別が男性 / 女性 / その他・空 → 男性用 / 女性用 / 中性的な名前のリストから選ぶ."""
    grp = {"group_name": "国語家"}
    m_male = {"member_id": "M-0001", "data_type": "人物", "name": "", "gender": "男性"}
    m_female = {"member_id": "M-0002", "data_type": "人物", "name": "", "gender": "女性"}
    m_other = {"member_id": "M-0003", "data_type": "人物", "name": "", "gender": "その他"}
    m_empty = {"member_id": "M-0004", "data_type": "人物", "name": "", "gender": None}

    assert generate_member_name(m_male, grp).split(" ")[1] in MALE_GIVEN_NAMES
    assert generate_member_name(m_female, grp).split(" ")[1] in FEMALE_GIVEN_NAMES
    assert generate_member_name(m_other, grp).split(" ")[1] in NEUTRAL_GIVEN_NAMES
    assert generate_member_name(m_empty, grp).split(" ")[1] in NEUTRAL_GIVEN_NAMES


def test_na_05_pet_name_by_pet_type():
    """NA-05: 名前が空のペット（犬 / 猫 / 種類が空） → 種類に合った名前（種類が空なら共通のリスト）."""
    p_dog = {"member_id": "M-0010", "data_type": "ペット", "name": "", "pet_type": "犬"}
    p_cat = {"member_id": "M-0011", "data_type": "ペット", "name": "", "pet_type": "猫"}
    p_empty = {"member_id": "M-0012", "data_type": "ペット", "name": "", "pet_type": ""}

    assert generate_member_name(p_dog) in PET_NAMES_BY_TYPE["犬"]
    assert generate_member_name(p_cat) in PET_NAMES_BY_TYPE["猫"]
    assert generate_member_name(p_empty) in COMMON_PET_NAMES


def test_na_06_deterministic_by_member_id():
    """NA-06: 同じ member_id で2回生成する → 同じ名前になる."""
    m = {"member_id": "M-0099", "data_type": "人物", "name": "", "gender": "男性"}
    grp = {"group_id": "GRP-005", "group_name": "グループA"}
    assert generate_member_name(m, grp) == generate_member_name(m, grp)


def test_na_07_existing_name_unchanged():
    """NA-07: 名前がすでにある → 変更しない."""
    m = {"member_id": "M-0001", "data_type": "人物", "name": "既存 氏名", "gender": "男性"}
    assert generate_member_name(m) == "既存 氏名"


def test_na_08_fullwidth_space_in_fullname():
    """NA-08: 全角スペースで区切られた名前「国語　太郎」 → 姓を正しく取り出す."""
    m1 = {"member_id": "M-0001", "data_type": "人物", "name": "国語\u3000太郎", "gender": "男性"}
    m2 = {"member_id": "M-0002", "data_type": "人物", "name": "", "gender": "女性"}
    name = generate_member_name(m2, group={"group_name": "グループ"}, household_members=[m1, m2])
    assert name.startswith("国語 ")


def test_na_09_db_name_remains_empty_after_deck_build(repo: Repository, s2_payload: dict):
    """NA-09: デッキ出力の後のDB → DBの名前は空のまま."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m1["name"] = ""
    saved = repo.save_household(grp, [m1], is_create=True)
    mid = saved["members"][0]["member_id"]

    deck = build_deck(
        repo.list_events(),
        repo.list_groups(),
        repo.list_members(),
        {"disaster_type": "地震", "shelter": "小平第五小学校"},
    )
    assert deck.export_payload["group_members"][0]["name"] != ""
    db_mem = repo.get_member(mid)
    assert db_mem is not None
    assert db_mem["name"] is None
