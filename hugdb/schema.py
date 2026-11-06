"""スキーマ定義（フィールド定義・選択肢マスタ・キー順序）モジュール."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

FieldKind = Literal["id", "text", "longtext", "int", "enum", "multi", "daterange", "ref"]
AppliesTo = Literal["人物", "ペット"]

# ==============================================================================
# 3. 複数選択因子の標準選択肢マスタ定義
# ==============================================================================

# 3.1 イベント属性定義
CATEGORY: tuple[str, ...] = (
    "災害・被害",
    "行政対応",
    "外部団体対応",
    "避難者対応",
    "避難所管理",
    "衛生・ゴミ",
    "マスコミ・視察",
    "避難所設備",
    "天候・気候",
)

DIFFICULTY: tuple[str, ...] = (
    "初級",
    "中級",
    "上級",
    "極高（現場混乱）",
)

MUST_RESPOND: tuple[str, ...] = (
    "あり（要即時対応）",
    "なし",
)

# 3.2 抽出条件定義（イベント・避難者グループ共通）
SHELTERS: tuple[str, ...] = (
    "上宿小学校",
    "小平第十二小学校",
    "小平第五中学校",
    "小平第一小学校",
    "小平第十五小学校",
    "小平第十三小学校",
    "小平第二中学校",
    "小平第六小学校",
    "小平元気村おがわ東",
    "小平第四中学校",
    "小平第四小学校",
    "小平第十小学校",
    "小平第十四小学校",
    "小平第二小学校",
    "小平第一中学校",
    "学園東小学校",
    "上水中学校",
    "小平第三小学校",
    "小平第九小学校",
    "小平第三中学校",
    "小平第八小学校",
    "鈴木小学校",
    "小平第七小学校",
    "小平第六中学校",
    "花小金井小学校",
    "小平第十一小学校",
    "小平第五小学校",
    "花小金井南中学校",
    "市民総合体育館",
    "上宿公民館",
    "小川公民館",
    "小川西町公民館",
    "津田公民館",
    "仲町公民館",
    "上水南公民館",
    "鈴木公民館",
    "大沼公民館",
    "花小金井北公民館",
    "花小金井南公民館",
)

HOLIDAY_TYPE: tuple[str, ...] = (
    "平日",
    "土日",
    "祝日",
    "大型連休",
    "年末年始",
)

TIME_SLOTS: tuple[str, ...] = (
    "早朝 (05:00-08:00)",
    "朝 (08:00-12:00)",
    "昼 (12:00-17:00)",
    "夕方 (17:00-20:00)",
    "夜間 (20:00-24:00)",
    "深夜 (00:00-05:00)",
)

DISASTER_TYPES: tuple[str, ...] = (
    "地震",
    "豪雨",
    "噴火",
    "大規模インフラ障害",
    "津波",
    "土砂災害",
    "豪雪",
    "火災",
)

INFRASTRUCTURE: tuple[str, ...] = (
    "停電",
    "断水",
    "ガス停止",
    "下水道破損",
    "通信障害",
    "交通機関不通",
)

WEATHER: tuple[str, ...] = (
    "晴れ",
    "雨",
    "大雨",
    "強風",
    "豪雪",
    "降灰",
    "極寒",
    "猛暑",
)

# 3.3 抽出後・並び順制御属性（ソート専用）
DISASTER_PHASE: tuple[str, ...] = (
    "発災直後",
    "初日",
    "2日目",
    "3日目",
    "4日目",
    "5日目以降",
)

RELATIVE_TIMING: tuple[str, ...] = (
    "先頭（開所・初期）",
    "序盤",
    "中盤",
    "終盤",
    "最後（振り返り・収束）",
)

# 3.4 避難者グループ専用属性
EVACUATION_ORIGIN: tuple[str, ...] = (
    "天神町１丁目",
    "天神町２丁目",
    "天神町３丁目",
    "天神町４丁目",
    "花小金井１丁目",
    "花小金井２丁目",
    "花小金井３丁目",
    "花小金井４丁目",
    "花小金井５丁目",
    "花小金井６丁目",
    "花小金井７丁目",
    "花小金井８丁目",
    "大沼町１丁目",
    "大沼町２丁目",
    "大沼町３丁目",
    "大沼町４丁目",
    "大沼町５丁目",
    "大沼町６丁目",
    "大沼町７丁目",
    "回田町",
    "鈴木町１丁目",
    "鈴木町２丁目",
    "御幸町",
    "花小金井南町１丁目",
    "花小金井南町２丁目",
    "花小金井南町３丁目",
    "小川西町１丁目",
    "小川西町２丁目",
    "小川西町３丁目",
    "小川西町４丁目",
    "小川西町５丁目",
    "上水本町１丁目",
    "上水本町２丁目",
    "上水本町３丁目",
    "上水本町４丁目",
    "上水本町５丁目",
    "上水本町６丁目",
    "上水新町１丁目",
    "上水新町２丁目",
    "上水新町３丁目",
    "津田町１丁目",
    "津田町２丁目",
    "津田町３丁目",
    "美園町１丁目",
    "美園町２丁目",
    "美園町３丁目",
    "喜平町１丁目",
    "喜平町２丁目",
    "喜平町３丁目",
    "上水南町１丁目",
    "上水南町２丁目",
    "上水南町３丁目",
    "上水南町４丁目",
    "学園西町１丁目",
    "学園西町２丁目",
    "学園西町３丁目",
    "学園東町",
    "学園東町１丁目",
    "学園東町２丁目",
    "学園東町３丁目",
    "たかの台",
    "小川町１丁目",
    "小川町２丁目",
    "中島町",
    "仲町",
    "小川東町",
    "小川東町１丁目",
    "小川東町２丁目",
    "小川東町３丁目",
    "小川東町４丁目",
    "小川東町５丁目",
    "栄町１丁目",
    "栄町２丁目",
    "栄町３丁目",
    "その他（市外）",
)

URGENCY_LEVEL: tuple[str, ...] = (
    "通常",
    "要即時対応",
)

PERSONAL_EQUIPMENT: tuple[str, ...] = (
    "乗用車",
    "トラック",
    "リヤカー",
    "テント",
    "発電機",
    "ポータブル電源",
    "カセットコンロ",
    "ストーブ",
    "車椅子",
    "大型スーツケース",
)

# 3.5 避難者（人物）構成員属性定義
RELATIONSHIP: tuple[str, ...] = (
    "世帯主",
    "夫",
    "妻",
    "父",
    "母",
    "子",
    "祖父",
    "祖母",
    "孫",
    "友人",
    "職場の同僚",
    "同行者",
)

GENDER: tuple[str, ...] = (
    "男性",
    "女性",
    "その他",
)

ATTRIBUTES: tuple[str, ...] = (
    "帰宅困難者",
    "旅行者",
    "近隣住民",
    "自治会役員",
    "市民ボランティア",
    "単身者",
    "行政職員",
)

VULNERABILITIES: tuple[str, ...] = (
    "車椅子",
    "外国籍",
    "ペット",
    "喫煙",
    "LGBTQ",
    "電源必要",
    "妊婦",
    "認知症",
    "視覚障害",
    "聴覚障害",
    "乳幼児",
    "アレルギー",
    "人工透析",
    "精神疾患",
    "言語障害",
)

HEALTH_CONDITION: tuple[str, ...] = (
    "良好",
    "発熱",
    "下痢・嘔吐",
    "骨折",
    "感染症疑い",
    "熱中症",
    "擦り傷",
    "精神的ショック",
    "慢性疾患あり",
    "泥酔",
    "重傷",
)

SKILLS: tuple[str, ...] = (
    "力仕事",
    "建築関係",
    "医療関係",
    "飲食関係",
    "手話・要約筆記",
    "多言語通訳",
    "重機運転",
    "保育・教育",
    "電気・設備",
    "IT関係",
)

# 3.6 ペット構成員属性定義
PET_HEALTH_CONDITION: tuple[str, ...] = (
    "病気",
    "ケガ",
    "温度管理必要",
    "混乱・怯え",
    "特殊エサ",
    "高齢・要介護",
)

PET_VULNERABILITIES: tuple[str, ...] = (
    "ワクチン未接種",
    "無駄吠え・夜鳴き",
    "未去勢",
    "ケージNG",
    "威嚇・噛み癖",
)

PET_SKILLS: tuple[str, ...] = (
    "癒し",
    "人懐こい",
    "見張り・警戒",
)

PET_HOUSING: tuple[str, ...] = (
    "手持ちカゴ",
    "中ケージ",
    "大ケージ(小屋)",
    "水槽",
    "多機能水槽",
    "リードのみ",
    "抱っこ",
)

DATA_TYPES: tuple[str, ...] = ("人物", "ペット")
PET_TYPES: tuple[str, ...] = ("犬", "猫", "小型鳥類", "ウサギ", "爬虫類", "その他")

# 設計書 3章の選択肢群番号 → 定数のマッピング
OPTION_GROUPS: dict[str, tuple[str, ...]] = {
    "1.1": CATEGORY,
    "1.2": DIFFICULTY,
    "1.3": MUST_RESPOND,
    "2.1": SHELTERS,
    "2.2": HOLIDAY_TYPE,
    "2.3": TIME_SLOTS,
    "2.4": DISASTER_TYPES,
    "2.5": INFRASTRUCTURE,
    "2.6": WEATHER,
    "3.1": DISASTER_PHASE,
    "3.2": RELATIVE_TIMING,
    "4.1": EVACUATION_ORIGIN,
    "4.2": URGENCY_LEVEL,
    "4.3": PERSONAL_EQUIPMENT,
    "5.1": RELATIONSHIP,
    "5.2": GENDER,
    "5.3": ATTRIBUTES,
    "5.4": VULNERABILITIES,
    "5.5": HEALTH_CONDITION,
    "5.6": SKILLS,
    "6.1": PET_HEALTH_CONDITION,
    "6.2": PET_VULNERABILITIES,
    "6.3": PET_SKILLS,
    "6.4": PET_HOUSING,
}

OPTION_GROUPS_BY_NAME: dict[str, tuple[str, ...]] = {
    "category": CATEGORY,
    "difficulty": DIFFICULTY,
    "must_respond": MUST_RESPOND,
    "shelters": SHELTERS,
    "holiday_type": HOLIDAY_TYPE,
    "time_slots": TIME_SLOTS,
    "disaster_types": DISASTER_TYPES,
    "infrastructure": INFRASTRUCTURE,
    "weather": WEATHER,
    "disaster_phase": DISASTER_PHASE,
    "relative_timing": RELATIVE_TIMING,
    "evacuation_origin": EVACUATION_ORIGIN,
    "urgency_level": URGENCY_LEVEL,
    "personal_equipment": PERSONAL_EQUIPMENT,
    "relationship": RELATIONSHIP,
    "gender": GENDER,
    "attributes": ATTRIBUTES,
    "vulnerabilities": VULNERABILITIES,
    "health_condition": HEALTH_CONDITION,
    "skills": SKILLS,
    "pet_health_condition": PET_HEALTH_CONDITION,
    "pet_vulnerabilities": PET_VULNERABILITIES,
    "pet_skills": PET_SKILLS,
    "pet_housing": PET_HOUSING,
}


@dataclass(frozen=True)
class Field:
    """レコードの1フィールド定義."""

    name: str
    label: str
    kind: FieldKind
    required: bool | AppliesTo = False
    options: tuple[str, ...] = ()
    section: str = ""
    applies_to: AppliesTo | None = None
    min: int | None = None
    max: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "kind": self.kind,
            "required": self.required,
            "options": list(self.options),
            "section": self.section,
            "applies_to": self.applies_to,
            "min": self.min,
            "max": self.max,
        }


@dataclass(frozen=True)
class ConditionDimension:
    """検索抽出条件の次元定義（match_* / exclude_* のペア）."""

    key: str
    label: str
    kind: Literal["multi", "daterange"]
    options: tuple[str, ...] = ()

    @property
    def match_field(self) -> str:
        return f"match_{self.key}"

    @property
    def exclude_field(self) -> str:
        return f"exclude_{self.key}"


# 選択肢型の6次元 + 日付範囲の1次元（計7次元 = 14フィールド）
CONDITION_DIMENSIONS: tuple[ConditionDimension, ...] = (
    ConditionDimension("shelters", "避難所", "multi", SHELTERS),
    ConditionDimension("dates", "日付", "daterange", ()),
    ConditionDimension("holiday_type", "休日種別", "multi", HOLIDAY_TYPE),
    ConditionDimension("time_slots", "時間帯", "multi", TIME_SLOTS),
    ConditionDimension("disaster_types", "災害種類", "multi", DISASTER_TYPES),
    ConditionDimension("infrastructure", "インフラ状況", "multi", INFRASTRUCTURE),
    ConditionDimension("weather", "天候", "multi", WEATHER),
)

MULTI_CONDITION_DIMENSIONS: tuple[ConditionDimension, ...] = tuple(
    d for d in CONDITION_DIMENSIONS if d.kind == "multi"
)


def _build_condition_fields() -> tuple[Field, ...]:
    fields: list[Field] = []
    for dim in CONDITION_DIMENSIONS:
        fields.append(
            Field(
                name=dim.match_field,
                label=f"[合致] {dim.label}",
                kind=dim.kind,
                required=False,
                options=dim.options,
                section="検索抽出用条件",
            )
        )
        fields.append(
            Field(
                name=dim.exclude_field,
                label=f"[排除] {dim.label}",
                kind=dim.kind,
                required=False,
                options=dim.options,
                section="検索抽出用条件",
            )
        )
    return tuple(fields)


CONDITION_FIELDS: tuple[Field, ...] = _build_condition_fields()

ORDERING_FIELDS: tuple[Field, ...] = (
    Field(
        "disaster_phase",
        "災害進行度",
        "multi",
        required=False,
        options=DISASTER_PHASE,
        section="デッキ並び順制御用属性",
    ),
    Field(
        "relative_timing",
        "相対発生時期",
        "multi",
        required=False,
        options=RELATIVE_TIMING,
        section="デッキ並び順制御用属性",
    ),
)

# 2.1 イベントカードマスタ (cards_event)
EVENT_FIELDS: tuple[Field, ...] = (
    Field("card_id", "カードID", "id", required=True, section="基本情報"),
    Field("event_name", "イベント名", "text", required=True, section="基本情報"),
    Field("category", "種別", "multi", required=True, options=CATEGORY, section="基本情報"),
    Field("priority", "優先度", "int", required=True, min=0, max=10, section="基本情報"),
    Field("difficulty", "対応難易度", "enum", required=True, options=DIFFICULTY, section="基本情報"),
    Field("must_respond", "対応必須フラグ", "enum", required=True, options=MUST_RESPOND, section="基本情報"),
    Field("prerequisite_card_id", "前提カードID", "ref", required=False, section="基本情報"),
    Field("source", "発生源", "text", required=False, section="基本情報"),
    Field("additional_equipment", "追加資機材", "text", required=False, section="基本情報"),
    Field("required_people", "必要人数", "int", required=False, min=0, section="基本情報"),
    Field("content", "イベント内容", "longtext", required=True, section="本文・指導"),
    Field("scene_description", "情景・読み上げ", "longtext", required=False, section="本文・指導"),
    Field("training_point", "訓練ポイント", "longtext", required=False, section="本文・指導"),
    *CONDITION_FIELDS,
    *ORDERING_FIELDS,
)

# 2.2 避難者グループマスタ (evacuee_groups)
GROUP_FIELDS: tuple[Field, ...] = (
    Field("group_id", "グループID", "id", required=True, section="基本情報"),
    Field("group_name", "世帯・グループ名", "text", required=True, section="基本情報"),
    Field("member_count", "一行人数", "int", required=True, min=0, section="基本情報"),
    Field("evacuation_origin", "避難元", "enum", required=True, options=EVACUATION_ORIGIN, section="基本情報"),
    Field("urgency_level", "到着時緊急度", "enum", required=True, options=URGENCY_LEVEL, section="基本情報"),
    Field("personal_equipment", "私物資機材", "multi", required=False, options=PERSONAL_EQUIPMENT, section="基本情報"),
    Field("pet_count", "ペット頭数", "int", required=True, min=0, section="基本情報"),
    *CONDITION_FIELDS,
    *ORDERING_FIELDS,
)

# 2.3 避難者構成員＆ペットマスタ (group_members)
MEMBER_FIELDS: tuple[Field, ...] = (
    Field("member_id", "構成員ID", "id", required=True, section="基本情報"),
    Field("group_id", "グループID", "ref", required=True, section="基本情報"),
    Field("data_type", "データ種別", "enum", required=True, options=DATA_TYPES, section="基本情報"),
    Field("relationship", "続柄・関係", "enum", required=False, options=RELATIONSHIP, section="人物用属性", applies_to="人物"),
    Field("name", "名前", "text", required=False, section="基本情報"),
    Field("gender", "性別", "enum", required=False, options=GENDER, section="基本情報"),
    Field("age", "年齢", "int", required=False, min=0, max=120, section="基本情報"),
    Field("attributes", "属性", "multi", required=False, options=ATTRIBUTES, section="人物用属性", applies_to="人物"),
    Field("vulnerabilities", "要配慮特性", "multi", required=False, options=VULNERABILITIES, section="人物用属性", applies_to="人物"),
    Field("health_condition", "体調・ケガ", "multi", required=False, options=HEALTH_CONDITION, section="人物用属性", applies_to="人物"),
    Field("skills", "スキル", "multi", required=False, options=SKILLS, section="人物用属性", applies_to="人物"),
    Field("statement", "受付時の言葉", "longtext", required="人物", section="人物用属性", applies_to="人物"),
    Field("pet_type", "種別", "text", required=False, options=PET_TYPES, section="ペット用属性", applies_to="ペット"),
    Field("pet_health_condition", "ペット健康属性", "multi", required=False, options=PET_HEALTH_CONDITION, section="ペット用属性", applies_to="ペット"),
    Field("pet_vulnerabilities", "ペット配慮属性", "multi", required=False, options=PET_VULNERABILITIES, section="ペット用属性", applies_to="ペット"),
    Field("pet_skills", "ペットスキル", "multi", required=False, options=PET_SKILLS, section="ペット用属性", applies_to="ペット"),
    Field("pet_housing", "飼育方法", "multi", required=False, options=PET_HOUSING, section="ペット用属性", applies_to="ペット"),
    Field("appearance", "容姿・特徴", "longtext", required=True, section="共通テキストフィールド"),
    Field("training_point", "訓練ポイント", "longtext", required=True, section="共通テキストフィールド"),
)

EVENT_KEY_ORDER: tuple[str, ...] = tuple(f.name for f in EVENT_FIELDS)
GROUP_KEY_ORDER: tuple[str, ...] = tuple(f.name for f in GROUP_FIELDS)

# サンプルデータ (sample_format2.json) と完全一致する構成員のキー順序
MEMBER_KEY_ORDER: dict[str, tuple[str, ...]] = {
    "人物": (
        "member_id",
        "group_id",
        "data_type",
        "relationship",
        "name",
        "gender",
        "age",
        "attributes",
        "vulnerabilities",
        "health_condition",
        "skills",
        "statement",
        "pet_housing",
        "appearance",
        "training_point",
    ),
    "ペット": (
        "member_id",
        "group_id",
        "data_type",
        "relationship",
        "name",
        "gender",
        "age",
        "attributes",
        "vulnerabilities",
        "health_condition",
        "skills",
        "pet_type",
        "pet_health_condition",
        "pet_vulnerabilities",
        "pet_skills",
        "pet_housing",
        "appearance",
        "training_point",
        "statement",
    ),
}

EVENT_FIELD_MAP: dict[str, Field] = {f.name: f for f in EVENT_FIELDS}
GROUP_FIELD_MAP: dict[str, Field] = {f.name: f for f in GROUP_FIELDS}
MEMBER_FIELD_MAP: dict[str, Field] = {f.name: f for f in MEMBER_FIELDS}


def order_record_keys(kind: Literal["event", "group", "member"], record: dict[str, Any]) -> dict[str, Any]:
    """レコードのキーをサンプル形式の標準順序に並べ替える."""
    if kind == "event":
        keys = EVENT_KEY_ORDER
    elif kind == "group":
        keys = GROUP_KEY_ORDER
    else:
        dt = record.get("data_type", "人物")
        keys = MEMBER_KEY_ORDER.get(dt, MEMBER_KEY_ORDER["人物"])

    ordered: dict[str, Any] = {}
    for k in keys:
        if k in record:
            ordered[k] = record[k]
    return ordered


def schema_to_dict() -> dict[str, Any]:
    """API `/api/schema` 用の辞書表現を返す."""
    return {
        "events": [f.to_dict() for f in EVENT_FIELDS],
        "groups": [f.to_dict() for f in GROUP_FIELDS],
        "members": [f.to_dict() for f in MEMBER_FIELDS],
        "member_key_order": {k: list(v) for k, v in MEMBER_KEY_ORDER.items()},
        "condition_dimensions": [
            {
                "key": d.key,
                "label": d.label,
                "kind": d.kind,
                "options": list(d.options),
                "match_field": d.match_field,
                "exclude_field": d.exclude_field,
            }
            for d in CONDITION_DIMENSIONS
        ],
        "options": {k: list(v) for k, v in OPTION_GROUPS_BY_NAME.items()},
    }
