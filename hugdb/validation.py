"""レコードの検証・正規化モジュール（strict / lenient 2モード対応）."""
from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, Literal
import unicodedata

from hugdb.schema import (
    CONDITION_DIMENSIONS,
    DATA_TYPES,
    EVENT_FIELDS,
    Field,
    GROUP_FIELDS,
    MEMBER_FIELDS,
    MEMBER_KEY_ORDER,
    order_record_keys,
)

Kind = Literal["event", "group", "member"]
ValidationMode = Literal["strict", "lenient"]

_DAYS_IN_MONTH = {
    1: 31,
    2: 29,
    3: 31,
    4: 30,
    5: 31,
    6: 30,
    7: 31,
    8: 31,
    9: 30,
    10: 31,
    11: 30,
    12: 31,
}

_SINGLE_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})$")
_RANGE_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})\s*-\s*(\d{1,2})/(\d{1,2})$")


@dataclass
class Issue:
    """検証で検出されたエラーまたは警告."""

    field: str
    message: str
    record_id: str | None = None
    severity: Literal["error", "warning"] = "error"

    def to_dict(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "message": self.message,
            "record_id": self.record_id,
            "severity": self.severity,
        }


@dataclass
class ValidationContext:
    """参照整合性や世帯内の検証に用いるコンテキスト."""

    known_event_ids: set[str] | None = None
    known_group_ids: set[str] | None = None
    seen_ids: set[str] | None = None
    prerequisite_map: dict[str, str | None] | None = None
    group_members: list[dict[str, Any]] | None = None


@dataclass
class ValidationReport:
    """単一レコードの検証結果."""

    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    normalized: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


def _is_valid_mmdd(month: int, day: int) -> bool:
    if month < 1 or month > 12:
        return False
    return 1 <= day <= _DAYS_IN_MONTH[month]


def normalize_date_ranges(raw: Any) -> tuple[str | None, list[str]]:
    """日付範囲表現を正規化し、(正規化後文字列, 不正トークン一覧) を返す."""
    if raw is None:
        return None, []
    if isinstance(raw, list):
        if not raw:
            return None, []
        raw_str = ", ".join(str(x) for x in raw if x is not None and str(x).strip())
    elif isinstance(raw, str):
        raw_str = raw
    else:
        return str(raw), [str(raw)]

    s = unicodedata.normalize("NFKC", raw_str).strip()
    if not s:
        return None, []

    for dash in ("〜", "～", "−", "ー", "―", "–", "—", "ｰ"):
        s = s.replace(dash, "-")
    s = s.replace("、", ",")

    parts = [p.strip() for p in s.split(",") if p.strip()]
    if not parts:
        return None, []

    normalized_parts: list[str] = []
    invalid_parts: list[str] = []

    for part in parts:
        m_single = _SINGLE_DATE_RE.match(part)
        if m_single:
            mo, da = int(m_single.group(1)), int(m_single.group(2))
            if _is_valid_mmdd(mo, da):
                normalized_parts.append(f"{mo:02d}/{da:02d}")
            else:
                invalid_parts.append(part)
                normalized_parts.append(part)
            continue

        m_range = _RANGE_DATE_RE.match(part)
        if m_range:
            m1, d1, m2, d2 = (
                int(m_range.group(1)),
                int(m_range.group(2)),
                int(m_range.group(3)),
                int(m_range.group(4)),
            )
            if _is_valid_mmdd(m1, d1) and _is_valid_mmdd(m2, d2):
                normalized_parts.append(f"{m1:02d}/{d1:02d}-{m2:02d}/{d2:02d}")
            else:
                invalid_parts.append(part)
                normalized_parts.append(part)
            continue

        invalid_parts.append(part)
        normalized_parts.append(part)

    return ", ".join(normalized_parts), invalid_parts


def _get_fields_for_kind(kind: Kind) -> tuple[Field, ...]:
    if kind == "event":
        return EVENT_FIELDS
    if kind == "group":
        return GROUP_FIELDS
    if kind == "member":
        return MEMBER_FIELDS
    raise ValueError(f"Unknown kind: {kind}")


def _id_field_for_kind(kind: Kind) -> str:
    if kind == "event":
        return "card_id"
    if kind == "group":
        return "group_id"
    return "member_id"


def _detect_cycle(card_id: str, prereq_id: str, prereq_map: dict[str, str | None]) -> list[str] | None:
    """前提カードの循環参照を検出し、循環経路のリストを返す."""
    visited_order: list[str] = [card_id]
    curr: str | None = prereq_id
    while curr:
        if curr in visited_order:
            idx = visited_order.index(curr)
            return visited_order[idx:] + [curr]
        visited_order.append(curr)
        curr = prereq_map.get(curr)
    return None


def has_missing_required(kind: Kind, record: dict[str, Any]) -> list[str]:
    """必須項目が未入力のフィールド名リストを返す（「要入力」バッジ判定用）."""
    fields = _get_fields_for_kind(kind)
    data_type = record.get("data_type", "人物") if kind == "member" else None
    missing: list[str] = []
    for f in fields:
        is_req = f.required is True or (isinstance(f.required, str) and f.required == data_type)
        if not is_req:
            continue
        val = record.get(f.name)
        if val is None:
            missing.append(f.name)
        elif isinstance(val, str) and not val.strip():
            missing.append(f.name)
        elif isinstance(val, list) and len(val) == 0:
            missing.append(f.name)
    return missing


def validate(
    kind: Kind,
    record: dict[str, Any],
    ctx: ValidationContext | None = None,
    mode: ValidationMode = "strict",
) -> ValidationReport:
    """単一レコードを検証・正規化する."""
    ctx = ctx or ValidationContext()
    errors: list[Issue] = []
    warnings: list[Issue] = []

    if not isinstance(record, dict):
        errors.append(Issue(field="", message="レコードがオブジェクト（辞書）ではありません"))
        return ValidationReport(errors=errors, warnings=warnings, normalized={})

    id_field = _id_field_for_kind(kind)
    raw_id = record.get(id_field)
    rec_id = str(raw_id).strip() if isinstance(raw_id, (str, int)) and str(raw_id).strip() else None

    def add_error(fld: str, msg: str) -> None:
        errors.append(Issue(field=fld, message=msg, record_id=rec_id, severity="error"))

    def add_warning(fld: str, msg: str) -> None:
        warnings.append(Issue(field=fld, message=msg, record_id=rec_id, severity="warning"))

    def add_mode_issue(fld: str, msg: str) -> None:
        if mode == "strict":
            add_error(fld, msg)
        else:
            add_warning(fld, msg)

    fields = _get_fields_for_kind(kind)
    known_field_names = {f.name for f in fields}

    # 未知のキーの検出 (VA-19)
    for k in record.keys():
        if k not in known_field_names:
            add_warning(k, f"未知のフィールド '{k}' は削除されます")

    # 構成員の data_type 事前チェック (VA-30)
    data_type: str | None = None
    if kind == "member":
        raw_dt = record.get("data_type")
        if not isinstance(raw_dt, str) or raw_dt not in DATA_TYPES:
            add_error("data_type", f"data_type は {list(DATA_TYPES)} のいずれかである必要があります")
            data_type = "人物"
        else:
            data_type = raw_dt

    # ID重複チェック
    if rec_id and ctx.seen_ids is not None:
        if rec_id in ctx.seen_ids:
            add_error(id_field, f"ID '{rec_id}' が重複しています")
        else:
            ctx.seen_ids.add(rec_id)

    normalized: dict[str, Any] = {}

    for f in fields:
        # 人物の場合はペット専用の4項目をスキップ (SC-04)
        if kind == "member" and data_type == "人物" and f.name in (
            "pet_type",
            "pet_health_condition",
            "pet_vulnerabilities",
            "pet_skills",
        ):
            continue

        raw_val = record.get(f.name)
        key_present = f.name in record
        is_req = f.required is True or (isinstance(f.required, str) and f.required == data_type)

        # 1. multi (配列型)
        if f.kind == "multi":
            if raw_val is None:
                arr: list[str] = []
            elif isinstance(raw_val, str):
                # 文字列が渡された場合は配列に変換し警告 (VA-16)
                s_val = raw_val.strip()
                arr = [s_val] if s_val else []
                if s_val:
                    add_warning(f.name, f"'{f.name}' が文字列のため配列に変換しました")
            elif isinstance(raw_val, list):
                arr = []
                for item in raw_val:
                    if item is None:
                        continue
                    s_item = str(item).strip()
                    if s_item:
                        arr.append(s_item)
            else:
                add_error(f.name, f"'{f.name}' は配列である必要があります")
                arr = []

            # 重複排除（順序保持）(VA-17)
            deduped: list[str] = []
            seen_items: set[str] = set()
            for item in arr:
                if item not in seen_items:
                    seen_items.add(item)
                    deduped.append(item)
            arr = deduped

            # 必須チェック (VA-04)
            if is_req and len(arr) == 0:
                add_mode_issue(f.name, f"必須項目 '{f.label}' ({f.name}) が選択されていません")

            # 選択肢チェック (VA-13, VA-14)
            # ペットにおける人物用項目 (attributes, vulnerabilities, health_condition, skills) は選択肢検証しない
            skip_option_check = kind == "member" and data_type == "ペット" and f.applies_to == "人物"
            if f.options and not skip_option_check:
                for item in arr:
                    if item not in f.options:
                        add_mode_issue(f.name, f"'{f.name}' に選択肢外の値 '{item}' が含まれています")

            normalized[f.name] = arr
            continue

        # 2. int (整数型)
        if f.kind == "int":
            if raw_val is None or (isinstance(raw_val, str) and not raw_val.strip()):
                if is_req:
                    # group の member_count / pet_count は後で再計算される可能性がある
                    if kind == "group" and f.name in ("member_count", "pet_count") and ctx.group_members is not None:
                        normalized[f.name] = 0
                    else:
                        add_mode_issue(f.name, f"必須項目 '{f.label}' ({f.name}) が未入力です")
                        normalized[f.name] = None
                else:
                    normalized[f.name] = None
                continue

            # bool は int のサブクラスだが数値とみなさない (VA-06)
            if isinstance(raw_val, bool):
                add_error(f.name, f"'{f.name}' に真偽値は指定できません")
                normalized[f.name] = None
                continue

            int_val: int | None = None
            if isinstance(raw_val, int):
                int_val = raw_val
            elif isinstance(raw_val, float):
                add_error(f.name, f"'{f.name}' は整数である必要があります")
                normalized[f.name] = None
                continue
            elif isinstance(raw_val, str):
                s_num = raw_val.strip()
                if re.match(r"^[+-]?\d+$", s_num):
                    if mode == "lenient":
                        int_val = int(s_num)
                        add_warning(f.name, f"'{f.name}' の文字列 '{raw_val}' を整数 {int_val} に変換しました")
                    else:
                        int_val = int(s_num)
                        add_warning(f.name, f"'{f.name}' の文字列 '{raw_val}' を整数 {int_val} に変換しました")
                else:
                    add_error(f.name, f"'{f.name}' を整数に変換できません: {raw_val!r}")
                    normalized[f.name] = None
                    continue
            else:
                add_error(f.name, f"'{f.name}' は整数である必要があります")
                normalized[f.name] = None
                continue

            # 範囲チェック (VA-05, VA-26, VA-27)
            if f.name == "age":
                if int_val < 0:
                    add_error(f.name, "年齢 (age) に負の値は指定できません")
                elif int_val > 120:
                    add_warning(f.name, f"年齢 (age={int_val}) が 120 を超えています")
            else:
                if f.min is not None and int_val < f.min:
                    add_error(f.name, f"'{f.name}' は {f.min} 以上である必要があります（入力値: {int_val}）")
                if f.max is not None and int_val > f.max:
                    add_error(f.name, f"'{f.name}' は {f.max} 以下である必要があります（入力値: {int_val}）")

            normalized[f.name] = int_val
            continue

        # 3. daterange (日付範囲テキスト)
        if f.kind == "daterange":
            norm_str, invalid_tokens = normalize_date_ranges(raw_val)
            if invalid_tokens:
                add_mode_issue(f.name, f"日付範囲の書式が不正です: {', '.join(invalid_tokens)}")
            normalized[f.name] = norm_str
            continue

        # 4. id / ref / enum / text / longtext
        # ペットの statement や人物の欠けた statement の扱い (VA-08, VA-09, VA-10)
        if kind == "member" and f.name == "statement":
            if data_type == "ペット":
                normalized["statement"] = str(raw_val).strip() if isinstance(raw_val, str) else ""
                continue
            else:
                # 人物の statement
                if not key_present or raw_val is None or (isinstance(raw_val, str) and not raw_val.strip()):
                    add_mode_issue("statement", "人物の受付時の言葉 (statement) は必須です")
                    normalized["statement"] = ""
                elif not isinstance(raw_val, str):
                    normalized["statement"] = str(raw_val).strip()
                else:
                    normalized["statement"] = raw_val.strip()
                continue

        # ペットの relationship 固定・許容 (VA-11, VA-12)
        if kind == "member" and f.name == "relationship":
            if data_type == "ペット":
                if raw_val is None or (isinstance(raw_val, str) and not raw_val.strip()):
                    normalized["relationship"] = "ペット"
                elif raw_val == "ペット":
                    normalized["relationship"] = "ペット"
                else:
                    add_warning("relationship", f"ペットの relationship '{raw_val}' は 'ペット' として扱われます")
                    normalized["relationship"] = str(raw_val).strip()
                continue
            else:
                # 人物の relationship
                if raw_val is None or (isinstance(raw_val, str) and not raw_val.strip()):
                    normalized["relationship"] = None
                else:
                    s_rel = str(raw_val).strip()
                    if s_rel not in f.options:
                        add_mode_issue("relationship", f"'relationship' に選択肢外の値 '{s_rel}' が指定されています")
                    normalized["relationship"] = s_rel
                continue

        # 一般文字列・enum・id・ref
        if raw_val is None:
            s_val = None
        elif isinstance(raw_val, str):
            s_val = raw_val.strip()
            if s_val == "":
                s_val = None
        else:
            s_val = str(raw_val).strip() or None

        if is_req and s_val is None:
            # data_type は既に上でエラー済みなので二重追加しない
            if not (kind == "member" and f.name == "data_type"):
                add_mode_issue(f.name, f"必須項目 '{f.label}' ({f.name}) が空です")

        if f.kind == "enum" and s_val is not None and f.options:
            if not (kind == "member" and f.name == "data_type"):
                if s_val not in f.options:
                    add_mode_issue(f.name, f"'{f.name}' に選択肢外の値 '{s_val}' が指定されています")

        normalized[f.name] = s_val

    # 5. 同じ値が match_* と exclude_* の両方にあるかチェック (VA-20)
    if kind in ("event", "group"):
        for dim in CONDITION_DIMENSIONS:
            if dim.kind == "multi":
                m_vals = set(normalized.get(dim.match_field) or [])
                e_vals = set(normalized.get(dim.exclude_field) or [])
                overlap = sorted(m_vals & e_vals)
                if overlap:
                    add_mode_issue(
                        dim.match_field,
                        f"'{dim.label}' の合致条件と排除条件に同じ値が含まれています: {', '.join(overlap)}",
                    )
            elif dim.kind == "daterange":
                m_date = normalized.get(dim.match_field)
                e_date = normalized.get(dim.exclude_field)
                if m_date and e_date:
                    m_parts = {p.strip() for p in m_date.split(",") if p.strip()}
                    e_parts = {p.strip() for p in e_date.split(",") if p.strip()}
                    overlap = sorted(m_parts & e_parts)
                    if overlap:
                        add_mode_issue(
                            dim.match_field,
                            f"'{dim.label}' の合致条件と排除条件に同じ値が含まれています: {', '.join(overlap)}",
                        )

    # 6. 前提カードIDの自己参照・循環参照・存在チェック (VA-21, VA-22, VA-23)
    if kind == "event":
        prereq_id = normalized.get("prerequisite_card_id")
        if prereq_id:
            if rec_id and prereq_id == rec_id:
                if mode == "strict":
                    add_error("prerequisite_card_id", f"自分自身 ({rec_id}) を前提カードに指定することはできません")
                else:
                    add_warning("prerequisite_card_id", f"自分自身 ({rec_id}) を前提カードに指定しているため null に変更しました")
                    normalized["prerequisite_card_id"] = None
            else:
                if ctx.known_event_ids is not None and prereq_id not in ctx.known_event_ids:
                    add_mode_issue("prerequisite_card_id", f"前提カード '{prereq_id}' が存在しません")
                if rec_id and ctx.prerequisite_map is not None:
                    temp_map = dict(ctx.prerequisite_map)
                    temp_map[rec_id] = prereq_id
                    cycle = _detect_cycle(rec_id, prereq_id, temp_map)
                    if cycle:
                        path_str = " -> ".join(cycle)
                        if mode == "strict":
                            add_error("prerequisite_card_id", f"前提カードが循環参照しています: {path_str}")
                        else:
                            add_warning("prerequisite_card_id", f"前提カードが循環参照しているため null に変更しました: {path_str}")
                            normalized["prerequisite_card_id"] = None

    # 7. 構成員の所属グループ存在チェック
    if kind == "member":
        grp_id = normalized.get("group_id")
        if not grp_id:
            if not any(e.field == "group_id" for e in errors):
                add_error("group_id", "構成員の group_id が指定されていません")
        elif ctx.known_group_ids is not None and grp_id not in ctx.known_group_ids:
            add_error("group_id", f"所属グループ '{grp_id}' が存在しません")

    # 8. 世帯の人数一致・最低人物数チェック (VA-24, VA-25)
    if kind == "group" and ctx.group_members is not None:
        actual_persons = sum(1 for m in ctx.group_members if m.get("data_type") == "人物")
        actual_pets = sum(1 for m in ctx.group_members if m.get("data_type") == "ペット")

        if actual_persons == 0:
            add_mode_issue("member_count", "世帯には人物が1名以上必要です")

        given_mc = normalized.get("member_count")
        if given_mc != actual_persons:
            add_warning(
                "member_count",
                f"member_count ({given_mc}) が実際の人物数 ({actual_persons}) と異なるため上書きしました",
            )
            normalized["member_count"] = actual_persons

        given_pc = normalized.get("pet_count")
        if given_pc != actual_pets:
            add_warning(
                "pet_count",
                f"pet_count ({given_pc}) が実際のペット数 ({actual_pets}) と異なるため上書きしました",
            )
            normalized["pet_count"] = actual_pets

    normalized = order_record_keys(kind, normalized)
    return ValidationReport(errors=errors, warnings=warnings, normalized=normalized)
