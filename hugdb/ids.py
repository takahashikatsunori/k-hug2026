"""ID 採番（単調増加）および追加インポート時の ID 振り直しモジュール."""
from __future__ import annotations

from collections.abc import Iterable
import copy
from dataclasses import dataclass, field
import re
import sqlite3
from typing import Any, Literal

from hugdb.validation import Issue

IdPrefix = Literal["EV", "GRP", "M"]

_ID_PATTERNS: dict[IdPrefix, re.Pattern[str]] = {
    "EV": re.compile(r"^EV-(\d+)$"),
    "GRP": re.compile(r"^GRP-(\d+)$"),
    "M": re.compile(r"^M-(\d+)$"),
}

_MIN_DIGITS: dict[IdPrefix, int] = {
    "EV": 3,
    "GRP": 3,
    "M": 4,
}

_TABLE_INFO: dict[IdPrefix, tuple[str, str]] = {
    "EV": ("cards_event", "card_id"),
    "GRP": ("evacuee_groups", "group_id"),
    "M": ("group_members", "member_id"),
}


def parse_id_number(prefix: IdPrefix, id_str: Any) -> int | None:
    """ID 文字列から数値部分を取り出す。形式が合わない場合は None を返す."""
    if not isinstance(id_str, str):
        return None
    m = _ID_PATTERNS[prefix].match(id_str.strip())
    if not m:
        return None
    return int(m.group(1))


def format_id(prefix: IdPrefix, number: int) -> str:
    """プレフィックスと番号から規定桁数（桁あふれ時は自動拡張）の ID を生成する."""
    digits = _MIN_DIGITS[prefix]
    return f"{prefix}-{number:0{digits}d}"


def next_id(
    prefix: IdPrefix,
    existing_ids: Iterable[str] = (),
    counter: int = 0,
) -> tuple[str, int]:
    """既存ID集合とカウンタ値から次の (新しいID, 更新後カウンタ) を返す."""
    max_existing = 0
    for raw in existing_ids:
        num = parse_id_number(prefix, raw)
        if num is not None and num > max_existing:
            max_existing = num
    next_num = max(counter, max_existing) + 1
    return format_id(prefix, next_num), next_num


def get_counter(conn: sqlite3.Connection, prefix: IdPrefix) -> int:
    """DB の meta テーブルから現在の採番カウンタを取得する."""
    key = f"id_counter_{prefix}"
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    if not row:
        return 0
    try:
        return int(row["value"])
    except (TypeError, ValueError):
        return 0


def set_counter(conn: sqlite3.Connection, prefix: IdPrefix, value: int) -> None:
    """DB の meta テーブルの採番カウンタを更新する（現在値より大きい場合のみ更新）."""
    current = get_counter(conn, prefix)
    new_val = max(current, value)
    key = f"id_counter_{prefix}"
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(new_val)),
    )


def get_existing_ids(conn: sqlite3.Connection, prefix: IdPrefix) -> set[str]:
    """指定プレフィックスのテーブルに存在する全 ID を返す."""
    table, col = _TABLE_INFO[prefix]
    rows = conn.execute(f"SELECT {col} FROM {table}").fetchall()
    return {r[0] for r in rows}


def allocate_id(conn: sqlite3.Connection, prefix: IdPrefix) -> str:
    """DB 上で次の ID を採番し、カウンタを更新して返す."""
    existing = get_existing_ids(conn, prefix)
    counter = get_counter(conn, prefix)
    new_id, new_num = next_id(prefix, existing, counter)
    set_counter(conn, prefix, new_num)
    return new_id


def sync_counters_with_existing(conn: sqlite3.Connection) -> None:
    """各テーブルの最大 ID と meta カウンタを同期する（カウンタは減らさない）."""
    for prefix in ("EV", "GRP", "M"):
        existing = get_existing_ids(conn, prefix)  # type: ignore[arg-type]
        max_num = max((n for i in existing if (n := parse_id_number(prefix, i)) is not None), default=0)  # type: ignore[arg-type]
        set_counter(conn, prefix, max_num)  # type: ignore[arg-type]


@dataclass
class RemapResult:
    """追加インポート用 ID 振り直しの結果."""

    payload: dict[str, list[dict[str, Any]]]
    id_map: dict[str, str] = field(default_factory=dict)
    event_map: dict[str, str] = field(default_factory=dict)
    group_map: dict[str, str] = field(default_factory=dict)
    member_map: dict[str, str] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)
    counters: dict[IdPrefix, int] = field(default_factory=dict)


def remap_for_append(
    payload: dict[str, Any],
    existing_event_ids: Iterable[str] = (),
    existing_group_ids: Iterable[str] = (),
    existing_member_ids: Iterable[str] = (),
    counters: dict[IdPrefix, int] | None = None,
) -> RemapResult:
    """追加インポート用に全レコードの ID を振り直し、参照（group_id, prerequisite_card_id）を更新する."""
    counters = dict(counters or {})
    db_ev_ids = set(existing_event_ids)
    db_grp_ids = set(existing_group_ids)
    db_mem_ids = set(existing_member_ids)

    cur_ev_ids = set(db_ev_ids)
    cur_grp_ids = set(db_grp_ids)
    cur_mem_ids = set(db_mem_ids)

    cnt_ev = counters.get("EV", 0)
    cnt_grp = counters.get("GRP", 0)
    cnt_mem = counters.get("M", 0)

    event_map: dict[str, str] = {}
    group_map: dict[str, str] = {}
    member_map: dict[str, str] = {}
    flat_map: dict[str, str] = {}
    issues: list[Issue] = []

    raw_events = copy.deepcopy(payload.get("cards_event") or [])
    raw_groups = copy.deepcopy(payload.get("evacuee_groups") or [])
    raw_members = copy.deepcopy(payload.get("group_members") or [])

    new_events: list[dict[str, Any]] = []
    for idx, ev in enumerate(raw_events):
        old_id = str(ev.get("card_id") or "").strip() or f"__anon_EV_{idx+1}"
        new_id, cnt_ev = next_id("EV", cur_ev_ids, cnt_ev)
        cur_ev_ids.add(new_id)
        if old_id in event_map:
            issues.append(
                Issue(
                    field="card_id",
                    message=f"インポート内でイベントID '{old_id}' が重複しているため別ID '{new_id}' に振り直しました",
                    record_id=old_id,
                    severity="warning",
                )
            )
            flat_map[f"{old_id}#{idx+1}"] = new_id
        else:
            event_map[old_id] = new_id
            flat_map[old_id] = new_id
        ev["card_id"] = new_id
        new_events.append(ev)

    # 前提カードIDの付け替え (ID-11, ID-12, ID-13)
    for ev in new_events:
        prereq = ev.get("prerequisite_card_id")
        if prereq is not None and str(prereq).strip() != "":
            prereq_str = str(prereq).strip()
            if prereq_str in event_map:
                ev["prerequisite_card_id"] = event_map[prereq_str]
            elif prereq_str in db_ev_ids:
                ev["prerequisite_card_id"] = prereq_str
            else:
                ev["prerequisite_card_id"] = None
                issues.append(
                    Issue(
                        field="prerequisite_card_id",
                        message=f"前提カードID '{prereq_str}' がインポート内にもDB内にも存在しないため null に変更しました",
                        record_id=ev["card_id"],
                        severity="warning",
                    )
                )

    new_groups: list[dict[str, Any]] = []
    for idx, grp in enumerate(raw_groups):
        old_id = str(grp.get("group_id") or "").strip() or f"__anon_GRP_{idx+1}"
        new_id, cnt_grp = next_id("GRP", cur_grp_ids, cnt_grp)
        cur_grp_ids.add(new_id)
        if old_id in group_map:
            issues.append(
                Issue(
                    field="group_id",
                    message=f"インポート内でグループID '{old_id}' が重複しているため別ID '{new_id}' に振り直しました",
                    record_id=old_id,
                    severity="warning",
                )
            )
            flat_map[f"{old_id}#{idx+1}"] = new_id
        else:
            group_map[old_id] = new_id
            flat_map[old_id] = new_id
        grp["group_id"] = new_id
        new_groups.append(grp)

    new_members: list[dict[str, Any]] = []
    for idx, mem in enumerate(raw_members):
        old_id = str(mem.get("member_id") or "").strip() or f"__anon_M_{idx+1}"
        old_grp = str(mem.get("group_id") or "").strip()
        # 追加インポートではインポート内のグループにのみ紐付ける (ID-14)
        if not old_grp or old_grp not in group_map:
            issues.append(
                Issue(
                    field="group_id",
                    message=f"構成員 '{old_id}' の所属グループ '{old_grp}' がインポートデータ内に存在しません",
                    record_id=old_id,
                    severity="error",
                )
            )
            continue

        new_id, cnt_mem = next_id("M", cur_mem_ids, cnt_mem)
        cur_mem_ids.add(new_id)
        if old_id in member_map:
            issues.append(
                Issue(
                    field="member_id",
                    message=f"インポート内で構成員ID '{old_id}' が重複しているため別ID '{new_id}' に振り直しました",
                    record_id=old_id,
                    severity="warning",
                )
            )
            flat_map[f"{old_id}#{idx+1}"] = new_id
        else:
            member_map[old_id] = new_id
            flat_map[old_id] = new_id
        mem["member_id"] = new_id
        mem["group_id"] = group_map[old_grp]
        new_members.append(mem)

    return RemapResult(
        payload={
            "cards_event": new_events,
            "evacuee_groups": new_groups,
            "group_members": new_members,
        },
        id_map=flat_map,
        event_map=event_map,
        group_map=group_map,
        member_map=member_map,
        issues=issues,
        counters={"EV": cnt_ev, "GRP": cnt_grp, "M": cnt_mem},
    )
