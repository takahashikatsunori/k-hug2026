"""CSV 出力（カード画像用11列 CSV および全項目 CSV の ZIP）モジュール."""
from __future__ import annotations

import csv
import io
from typing import Any
import zipfile

from hugdb import config
from hugdb.deck import DeckBuildResult
from hugdb.filtering import SearchResult
from hugdb.schema import EVENT_KEY_ORDER, GROUP_KEY_ORDER, MEMBER_KEY_ORDER

UTF8_BOM = "\ufeff"

CARD_CSV_HEADERS: tuple[str, ...] = (
    "カード番号",
    "種別",
    "氏名/イベント名",
    "避難元",
    "年齢",
    "性別",
    "属性",
    "詳細フラグ",
    "具体的な容姿・表情",
    "具体的なセリフ・状況",
    "判定ポイント",
)


def event_to_card_csv_row(card_number: int, event: dict[str, Any]) -> list[str]:
    """イベントカードをカード画像用 CSV の 11 列に変換する."""
    categories = [str(c) for c in (event.get("category") or []) if c]
    return [
        str(card_number),
        "イベント",
        str(event.get("event_name") or ""),
        "-",
        "-",
        "-",
        str(event.get("source") or ""),
        " ".join(categories),
        str(event.get("scene_description") or ""),
        str(event.get("content") or ""),
        str(event.get("training_point") or ""),
    ]


def member_to_card_csv_row(
    card_number: int,
    member: dict[str, Any],
    group: dict[str, Any] | None = None,
) -> list[str]:
    """構成員（人物またはペット）をカード画像用 CSV の 11 列に変換する."""
    dt = member.get("data_type", "人物")
    origin = str((group or {}).get("evacuation_origin") or "")
    raw_age = member.get("age")
    age_str = "" if raw_age is None or raw_age == "" else str(raw_age)
    gender = str(member.get("gender") or "")
    appearance = str(member.get("appearance") or "")
    training_point = str(member.get("training_point") or "")

    if dt == "ペット":
        kind_label = "ペット"
        rel = str(member.get("relationship") or "ペット")
        p_vulns = [str(x) for x in (member.get("pet_vulnerabilities") or []) if x]
        p_health = [
            str(x)
            for x in (member.get("pet_health_condition") or [])
            if x and str(x) != "良好"
        ]
        p_skills = [str(x) for x in (member.get("pet_skills") or []) if x]
        flags = " ".join(p_vulns + p_health + p_skills)
        statement_or_situation = appearance
    else:
        kind_label = "避難者"
        rel = str(member.get("relationship") or "")
        vulns = [str(x) for x in (member.get("vulnerabilities") or []) if x]
        health = [
            str(x)
            for x in (member.get("health_condition") or [])
            if x and str(x) != "良好"
        ]
        skills = [str(x) for x in (member.get("skills") or []) if x]
        flags = " ".join(vulns + health + skills)
        statement_or_situation = str(member.get("statement") or "")

    return [
        str(card_number),
        kind_label,
        str(member.get("name") or ""),
        origin,
        age_str,
        gender,
        rel,
        flags,
        appearance,
        statement_or_situation,
        training_point,
    ]


def _rows_to_csv_bytes(headers: tuple[str, ...] | list[str], rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(
        buf,
        lineterminator="\r\n",
        quoting=csv.QUOTE_MINIMAL,
    )
    writer.writerow(headers)
    writer.writerows(rows)
    return (UTF8_BOM + buf.getvalue()).encode("utf-8")


def export_deck_card_csv(deck: DeckBuildResult) -> bytes:
    """構築済みデッキからカード画像用 11 列 CSV（BOM付きUTF-8、CRLF）を生成する."""
    rows: list[list[str]] = []
    for c in deck.cards:
        if c.kind == "event":
            rows.append(event_to_card_csv_row(c.card_number, c.data))
        else:
            rows.append(member_to_card_csv_row(c.card_number, c.data, c.group))
    return _rows_to_csv_bytes(CARD_CSV_HEADERS, rows)


def export_records_card_csv(
    events: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
) -> bytes:
    """イベント・グループ・構成員のリストを順番どおりに 11 列 CSV に変換する."""
    group_by_id = {g["group_id"]: g for g in groups}
    rows: list[list[str]] = []
    seq = 0

    for ev in events:
        seq += 1
        rows.append(event_to_card_csv_row(seq, ev))

    for m in members:
        seq += 1
        grp = group_by_id.get(m.get("group_id", ""))
        rows.append(member_to_card_csv_row(seq, m, grp))

    return _rows_to_csv_bytes(CARD_CSV_HEADERS, rows)


def export_search_card_csv(
    search_result: SearchResult,
    all_groups: list[dict[str, Any]],
    all_members: list[dict[str, Any]],
) -> bytes:
    """検索結果をカード画像用 11 列 CSV に変換する（世帯表示の場合は構成員に展開して連番付与: CS-13）."""
    group_by_id = {g["group_id"]: g for g in all_groups}
    members_by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in all_groups}
    for m in all_members:
        gid = m.get("group_id")
        if gid in members_by_group:
            members_by_group[gid].append(m)

    rows: list[list[str]] = []
    seq = 0

    if search_result.ordered_units:
        for u in search_result.ordered_units:
            if u["kind"] == "event":
                seq += 1
                rows.append(event_to_card_csv_row(seq, u["event"]))
            else:
                grp = u["group"]
                gid = grp["group_id"]
                m_list = list(u.get("members") or members_by_group.get(gid, []))
                m_list.sort(key=lambda m: 0 if m.get("data_type") == "人物" else 1)
                for m in m_list:
                    seq += 1
                    rows.append(member_to_card_csv_row(seq, m, grp))
    else:
        for m in search_result.persons + search_result.pets:
            seq += 1
            grp = group_by_id.get(m.get("group_id", ""))
            rows.append(member_to_card_csv_row(seq, m, grp))

    return _rows_to_csv_bytes(CARD_CSV_HEADERS, rows)


def _format_cell_value(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, list):
        if not val:
            return ""
        return config.CSV_ARRAY_JOINER.join(str(x) for x in val if x is not None)
    return str(val)


def _collection_to_full_csv_bytes(
    headers: tuple[str, ...],
    records: list[dict[str, Any]],
) -> bytes:
    rows: list[list[str]] = []
    for rec in records:
        rows.append([_format_cell_value(rec.get(h)) for h in headers])
    return _rows_to_csv_bytes(headers, rows)


def export_full_csv_zip(
    events: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
) -> bytes:
    """全項目 CSV 3ファイル (cards_event.csv, evacuee_groups.csv, group_members.csv) を格納した ZIP バイト列を返す (CS-14, CS-15)."""
    member_headers = MEMBER_KEY_ORDER["ペット"]

    ev_bytes = _collection_to_full_csv_bytes(EVENT_KEY_ORDER, events)
    grp_bytes = _collection_to_full_csv_bytes(GROUP_KEY_ORDER, groups)
    mem_bytes = _collection_to_full_csv_bytes(member_headers, members)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("cards_event.csv", ev_bytes)
        zf.writestr("evacuee_groups.csv", grp_bytes)
        zf.writestr("group_members.csv", mem_bytes)
    return zip_buf.getvalue()
