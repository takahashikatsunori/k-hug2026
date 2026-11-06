"""構成員（人物・ペット）の空欄氏名を決定論的に自動生成するモジュール."""
from __future__ import annotations

import copy
import hashlib
import re
from typing import Any

SURNAMES: tuple[str, ...] = (
    "佐藤",
    "鈴木",
    "高橋",
    "田中",
    "伊藤",
    "渡辺",
    "山本",
    "中村",
    "小林",
    "加藤",
    "吉田",
    "山田",
    "佐々木",
    "山口",
    "松本",
    "井上",
    "木村",
    "林",
    "斎藤",
    "清水",
)

MALE_GIVEN_NAMES: tuple[str, ...] = (
    "太郎",
    "一郎",
    "健太",
    "翔太",
    "大輔",
    "誠",
    "隆",
    "浩",
    "修",
    "健一",
    "拓也",
    "雄太",
    "直樹",
    "和彦",
    "正",
    "勇",
)

FEMALE_GIVEN_NAMES: tuple[str, ...] = (
    "花子",
    "陽子",
    "恵子",
    "美咲",
    "さくら",
    "優子",
    "由美",
    "真由美",
    "愛",
    "結衣",
    "彩",
    "奈々",
    "千春",
    "和代",
    "節子",
    "トミ",
)

NEUTRAL_GIVEN_NAMES: tuple[str, ...] = (
    "ひかる",
    "あおい",
    "つばさ",
    "はるか",
    "みらい",
    "りお",
    "ゆう",
    "れん",
    "そら",
    "なぎさ",
)

PET_NAMES_BY_TYPE: dict[str, tuple[str, ...]] = {
    "犬": ("ポチ", "ハチ", "コロ", "モモ", "レオ", "ソラ", "マロン", "チョコ", "コタロウ", "マックス"),
    "猫": ("タマ", "ミケ", "クロ", "トラ", "ルナ", "モモ", "メイ", "フク", "ジジ", "チビ"),
    "小型鳥類": ("ピーちゃん", "ピヨ", "ソラ", "キイ", "レモン"),
    "ウサギ": ("モコ", "ミミ", "ユキ", "マロン", "ロップ"),
    "爬虫類": ("ミド", "リク", "カメ吉", "レオン", "ドラ"),
}

COMMON_PET_NAMES: tuple[str, ...] = (
    "モモ",
    "ココ",
    "ソラ",
    "レオ",
    "マル",
    "ハナ",
    "フク",
    "ラッキー",
)

_GROUP_HOUSE_RE = re.compile(r"^([^\s（(]+?)家(?:[\s（(]|$)")


def _seed_int(seed_text: str) -> int:
    digest = hashlib.sha256(seed_text.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def extract_surname_from_fullname(fullname: str | None) -> str | None:
    """半角または全角スペースで区切られた氏名から姓を取り出す (NA-01, NA-08)."""
    if not fullname or not isinstance(fullname, str):
        return None
    normalized = fullname.replace("\u3000", " ").strip()
    parts = [p for p in normalized.split(" ") if p]
    if len(parts) >= 2:
        return parts[0]
    return None


def infer_group_surname(
    group: dict[str, Any] | None,
    members: list[dict[str, Any]] | None = None,
    fallback_seed: str = "",
) -> str:
    """世帯の構成員氏名 → グループ名の「〇〇家」 → 姓リストの優先順で姓を決定する."""
    for m in members or []:
        if m.get("data_type") == "人物":
            surname = extract_surname_from_fullname(m.get("name"))
            if surname:
                return surname

    if group:
        gname = str(group.get("group_name") or "").strip()
        m_house = _GROUP_HOUSE_RE.match(gname)
        if m_house:
            return m_house.group(1)

    seed_key = str((group or {}).get("group_id") or fallback_seed or "default_group")
    idx = _seed_int(f"surname:{seed_key}") % len(SURNAMES)
    return SURNAMES[idx]


def generate_member_name(
    member: dict[str, Any],
    group: dict[str, Any] | None = None,
    household_members: list[dict[str, Any]] | None = None,
) -> str:
    """構成員の名前が空欄の場合に決定論的に名前を生成して返す（既存名があればそのまま返す）."""
    existing = member.get("name")
    if isinstance(existing, str) and existing.strip():
        return existing.strip()

    mid = str(member.get("member_id") or "M-0000")
    dt = member.get("data_type", "人物")

    if dt == "ペット":
        pet_type = str(member.get("pet_type") or "").strip()
        candidates = PET_NAMES_BY_TYPE.get(pet_type, COMMON_PET_NAMES)
        idx = _seed_int(f"pet:{mid}") % len(candidates)
        return candidates[idx]

    surname = infer_group_surname(group, household_members, fallback_seed=mid)
    gender = str(member.get("gender") or "").strip()
    if gender == "男性":
        pool = MALE_GIVEN_NAMES
    elif gender == "女性":
        pool = FEMALE_GIVEN_NAMES
    else:
        pool = NEUTRAL_GIVEN_NAMES

    idx = _seed_int(f"given:{mid}") % len(pool)
    given = pool[idx]
    return f"{surname} {given}"


def fill_household_names(
    group: dict[str, Any],
    members: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """世帯の構成員リストのコピーを作成し、空欄の名前を埋めて返す（元の辞書やDBは変更しない）."""
    copied = [copy.deepcopy(m) for m in members]
    for m in copied:
        m["name"] = generate_member_name(m, group=group, household_members=copied)
    return copied
