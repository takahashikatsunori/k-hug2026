"""JSON インポート（複数ファイル統合・置換/追加・ドライラン・デモ読込）およびエクスポートモジュール."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Literal

from hugdb import config
from hugdb.db import transaction
from hugdb.filtering import SearchResult
from hugdb.ids import (
    get_counter,
    get_existing_ids,
    next_id,
    remap_for_append,
    set_counter,
    sync_counters_with_existing,
)
from hugdb.repository import NotFoundError, Repository, ValidationError
from hugdb.schema import order_record_keys
from hugdb.validation import Issue, ValidationContext, validate
from hugdb.versions import create_version

ImportMode = Literal["replace", "append"]
COLLECTION_KEYS = ("cards_event", "evacuee_groups", "group_members")


class PayloadTooLargeError(Exception):
    """ファイルサイズが上限（10MB）を超えた場合の例外 (HTTP 413 用)."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


@dataclass
class ImportReport:
    """インポート（またはドライラン）の結果レポート."""

    ok: bool
    mode: ImportMode
    dry_run: bool
    counts: dict[str, int] = field(default_factory=dict)
    excluded_counts: dict[str, int] = field(default_factory=dict)
    id_map: dict[str, str] = field(default_factory=dict)
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    payload: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    auto_version: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "mode": self.mode,
            "dry_run": self.dry_run,
            "counts": self.counts,
            "excluded_counts": self.excluded_counts,
            "id_map": self.id_map,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
            "auto_version": self.auto_version,
        }


def parse_json_bytes(raw_bytes: bytes, filename: str = "input.json") -> dict[str, Any]:
    """バイト列をサイズ・文字コード（UTF-8 / UTF-8 BOM）・構造チェックの上で辞書として解析する."""
    if len(raw_bytes) > config.MAX_IMPORT_BYTES:
        raise PayloadTooLargeError(
            f"ファイル '{filename}' のサイズ ({len(raw_bytes)} bytes) が上限 (10MB) を超えています"
        )
    if len(raw_bytes) == 0 or not raw_bytes.strip():
        raise ValidationError([Issue(field="file", message=f"ファイル '{filename}' が空です")])

    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationError(
            [Issue(field="file", message=f"ファイル '{filename}' を UTF-8 として読み込めません: {exc}")]
        ) from exc

    if not text.strip():
        raise ValidationError([Issue(field="file", message=f"ファイル '{filename}' が空です")])

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValidationError(
            [Issue(field="file", message=f"ファイル '{filename}' のJSON書式が不正です: {exc.msg}")]
        ) from exc

    if not isinstance(parsed, dict):
        raise ValidationError(
            [Issue(field="file", message=f"ファイル '{filename}' の最上位はJSONオブジェクトである必要があります")]
        )

    has_any_key = False
    for k in COLLECTION_KEYS:
        if k in parsed:
            if not isinstance(parsed[k], list):
                raise ValidationError(
                    [Issue(field=k, message=f"'{k}' は配列である必要があります")]
                )
            has_any_key = True

    if not has_any_key:
        raise ValidationError(
            [
                Issue(
                    field="file",
                    message=f"ファイル '{filename}' に cards_event / evacuee_groups / group_members のいずれも含まれていません",
                )
            ]
        )

    return parsed


def merge_payloads(payloads: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """複数の JSON ペイロードを 3 コレクションごとに結合する."""
    merged: dict[str, list[dict[str, Any]]] = {
        "cards_event": [],
        "evacuee_groups": [],
        "group_members": [],
    }
    for p in payloads:
        for k in COLLECTION_KEYS:
            items = p.get(k)
            if isinstance(items, list):
                merged[k].extend(copy.deepcopy(items))
    return merged


def _prepare_replace(
    conn: sqlite3.Connection,
    merged: dict[str, list[dict[str, Any]]],
    dry_run: bool,
) -> tuple[ImportReport, dict[str, int]]:
    errors: list[Issue] = []
    warnings: list[Issue] = []
    id_map: dict[str, str] = {}

    raw_events = merged["cards_event"]
    raw_groups = merged["evacuee_groups"]
    raw_members = merged["group_members"]

    # 1. ファイル内（および複数ファイル間）のID重複チェック (IJ-06, IJ-07)
    dup_errors: list[Issue] = []
    for coll_name, id_field, items in (
        ("cards_event", "card_id", raw_events),
        ("evacuee_groups", "group_id", raw_groups),
        ("group_members", "member_id", raw_members),
    ):
        seen: set[str] = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            rid = item.get(id_field)
            if rid is not None and str(rid).strip():
                s_rid = str(rid).strip()
                if s_rid in seen:
                    dup_errors.append(
                        Issue(
                            field=id_field,
                            message=f"{coll_name} 内で ID '{s_rid}' が重複しています",
                            record_id=s_rid,
                            severity="error",
                        )
                    )
                seen.add(s_rid)

    if dup_errors:
        raise ValidationError(dup_errors, message="インポートデータ内に重複するIDがあります")

    # 構成員ファイルのみでグループが1件も無い場合は全体エラー (IJ-05)
    if raw_members and not raw_groups and not raw_events:
        raise ValidationError(
            [
                Issue(
                    field="group_id",
                    message="避難者グループ (evacuee_groups) が無いため構成員のみでの置換インポートはできません",
                )
            ]
        )

    cnt_ev = get_counter(conn, "EV")
    cnt_grp = get_counter(conn, "GRP")
    cnt_mem = get_counter(conn, "M")

    existing_ev_in_payload = {
        str(e.get("card_id")).strip()
        for e in raw_events
        if isinstance(e, dict) and e.get("card_id") and str(e.get("card_id")).strip()
    }
    existing_grp_in_payload = {
        str(g.get("group_id")).strip()
        for g in raw_groups
        if isinstance(g, dict) and g.get("group_id") and str(g.get("group_id")).strip()
    }
    existing_mem_in_payload = {
        str(m.get("member_id")).strip()
        for m in raw_members
        if isinstance(m, dict) and m.get("member_id") and str(m.get("member_id")).strip()
    }

    # 2. イベントの検証（ID欠損時は自動採番して警告: IJ-14、構造破損行は除外: IJ-12）
    valid_events_raw: list[dict[str, Any]] = []
    excluded_ev_count = 0
    for idx, ev in enumerate(raw_events):
        if not isinstance(ev, dict):
            errors.append(Issue(field="cards_event", message=f"イベント[{idx}] がオブジェクトではありません"))
            excluded_ev_count += 1
            continue
        ev_copy = copy.deepcopy(ev)
        cid = ev_copy.get("card_id")
        if cid is None or not str(cid).strip():
            new_cid, cnt_ev = next_id("EV", existing_ev_in_payload, cnt_ev)
            existing_ev_in_payload.add(new_cid)
            ev_copy["card_id"] = new_cid
            id_map[f"__missing_EV_{idx+1}"] = new_cid
            warnings.append(
                Issue(
                    field="card_id",
                    message=f"card_id が未指定のため '{new_cid}' を自動採番しました",
                    record_id=new_cid,
                    severity="warning",
                )
            )
        else:
            cid_str = str(cid).strip()
            ev_copy["card_id"] = cid_str
            id_map[cid_str] = cid_str

        rep = validate("event", ev_copy, mode="lenient")
        warnings.extend(rep.warnings)
        if not rep.ok:
            errors.extend(rep.errors)
            excluded_ev_count += 1
            existing_ev_in_payload.discard(ev_copy["card_id"])
            id_map.pop(ev_copy["card_id"], None)
            continue
        valid_events_raw.append(rep.normalized)

    # 除外されたイベントや存在しない前提カードを参照している場合は null にして警告 (IJ-13)
    surviving_ev_ids = {e["card_id"] for e in valid_events_raw}
    prereq_map = {e["card_id"]: e.get("prerequisite_card_id") for e in valid_events_raw}
    final_events: list[dict[str, Any]] = []
    for ev in valid_events_raw:
        pre = ev.get("prerequisite_card_id")
        if pre and pre not in surviving_ev_ids:
            ev["prerequisite_card_id"] = None
            prereq_map[ev["card_id"]] = None
            warnings.append(
                Issue(
                    field="prerequisite_card_id",
                    message=f"前提カード '{pre}' が存在しない（または除外された）ため null に変更しました",
                    record_id=ev["card_id"],
                    severity="warning",
                )
            )
        # 循環参照チェック
        rep2 = validate(
            "event",
            ev,
            ValidationContext(known_event_ids=surviving_ev_ids, prerequisite_map=prereq_map),
            mode="lenient",
        )
        for w in rep2.warnings:
            if w.field == "prerequisite_card_id" and not any(
                 ew.record_id == w.record_id and ew.message == w.message for ew in warnings
            ):
                warnings.append(w)
        final_events.append(rep2.normalized)

    # 3. グループの一次検証（構造エラーのグループを除外）
    valid_groups_by_id: dict[str, dict[str, Any]] = {}
    valid_groups_order: list[str] = []
    excluded_grp_count = 0
    for idx, grp in enumerate(raw_groups):
        if not isinstance(grp, dict):
            errors.append(Issue(field="evacuee_groups", message=f"グループ[{idx}] がオブジェクトではありません"))
            excluded_grp_count += 1
            continue
        grp_copy = copy.deepcopy(grp)
        gid = grp_copy.get("group_id")
        if gid is None or not str(gid).strip():
            errors.append(Issue(field="group_id", message=f"グループ[{idx}] の group_id が空のため除外しました"))
            excluded_grp_count += 1
            continue
        gid_str = str(gid).strip()
        grp_copy["group_id"] = gid_str

        rep = validate("group", grp_copy, mode="lenient")
        if not rep.ok:
            errors.extend(rep.errors)
            excluded_grp_count += 1
            continue
        valid_groups_by_id[gid_str] = grp_copy
        valid_groups_order.append(gid_str)
        id_map[gid_str] = gid_str

    # 4. 構成員の検証（所属グループが無い・除外された構成員も連鎖除外: IJ-12）
    surviving_grp_ids = set(valid_groups_by_id.keys())
    final_members: list[dict[str, Any]] = []
    members_by_group: dict[str, list[dict[str, Any]]] = {gid: [] for gid in surviving_grp_ids}
    excluded_mem_count = 0

    for idx, mem in enumerate(raw_members):
        if not isinstance(mem, dict):
            errors.append(Issue(field="group_members", message=f"構成員[{idx}] がオブジェクトではありません"))
            excluded_mem_count += 1
            continue
        mem_copy = copy.deepcopy(mem)
        mid = mem_copy.get("member_id")
        if mid is None or not str(mid).strip():
            new_mid, cnt_mem = next_id("M", existing_mem_in_payload, cnt_mem)
            existing_mem_in_payload.add(new_mid)
            mem_copy["member_id"] = new_mid
            warnings.append(
                Issue(
                    field="member_id",
                    message=f"member_id が未指定のため '{new_mid}' を自動採番しました",
                    record_id=new_mid,
                    severity="warning",
                )
            )
        else:
            mem_copy["member_id"] = str(mid).strip()

        rep = validate(
            "member",
            mem_copy,
            ValidationContext(known_group_ids=surviving_grp_ids),
            mode="lenient",
        )
        warnings.extend(rep.warnings)
        if not rep.ok:
            errors.extend(rep.errors)
            excluded_mem_count += 1
            continue

        norm_m = rep.normalized
        final_members.append(norm_m)
        members_by_group[norm_m["group_id"]].append(norm_m)
        id_map[norm_m["member_id"]] = norm_m["member_id"]

    # 5. グループの人数再計算と正規化
    final_groups: list[dict[str, Any]] = []
    for gid in valid_groups_order:
        grp_raw = valid_groups_by_id[gid]
        g_mems = members_by_group.get(gid, [])
        rep_g = validate(
            "group",
            grp_raw,
            ValidationContext(group_members=g_mems),
            mode="lenient",
        )
        warnings.extend(rep_g.warnings)
        final_groups.append(rep_g.normalized)

    payload_out = {
        "cards_event": final_events,
        "evacuee_groups": final_groups,
        "group_members": final_members,
    }
    report = ImportReport(
        ok=True,
        mode="replace",
        dry_run=dry_run,
        counts={
            "events": len(final_events),
            "groups": len(final_groups),
            "members": len(final_members),
        },
        excluded_counts={
            "events": excluded_ev_count,
            "groups": excluded_grp_count,
            "members": excluded_mem_count,
        },
        id_map=id_map,
        errors=errors,
        warnings=warnings,
        payload=payload_out,
    )
    return report, {"EV": cnt_ev, "GRP": cnt_grp, "M": cnt_mem}


def _prepare_append(
    conn: sqlite3.Connection,
    merged: dict[str, list[dict[str, Any]]],
    dry_run: bool,
) -> tuple[ImportReport, dict[str, int]]:
    errors: list[Issue] = []
    warnings: list[Issue] = []

    raw_events = merged["cards_event"]
    raw_groups = merged["evacuee_groups"]
    raw_members = merged["group_members"]

    # 構成員のみ追加インポートしようとした場合はエラー (IJ-04 / ID-14)
    if raw_members and not raw_groups and not raw_events:
        raise ValidationError(
            [
                Issue(
                    field="group_id",
                    message="追加モードではインポートデータ内に所属グループ (evacuee_groups) が必要です",
                )
            ]
        )

    # 1. 構造エラー行の事前除外（連鎖除外含む: IJ-12）
    pre_events: list[dict[str, Any]] = []
    excluded_ev_count = 0
    for idx, ev in enumerate(raw_events):
        if not isinstance(ev, dict):
            errors.append(Issue(field="cards_event", message=f"イベント[{idx}] がオブジェクトではありません"))
            excluded_ev_count += 1
            continue
        rep = validate("event", ev, mode="lenient")
        if not rep.ok:
            errors.extend(rep.errors)
            excluded_ev_count += 1
            continue
        pre_events.append(ev)

    pre_groups: list[dict[str, Any]] = []
    valid_old_group_ids: set[str] = set()
    excluded_grp_count = 0
    for idx, grp in enumerate(raw_groups):
        if not isinstance(grp, dict) or not grp.get("group_id") or not str(grp.get("group_id")).strip():
            errors.append(Issue(field="group_id", message=f"グループ[{idx}] の group_id が不正なため除外しました"))
            excluded_grp_count += 1
            continue
        rep = validate("group", grp, mode="lenient")
        if not rep.ok:
            errors.extend(rep.errors)
            excluded_grp_count += 1
            continue
        pre_groups.append(grp)
        valid_old_group_ids.add(str(grp["group_id"]).strip())

    pre_members: list[dict[str, Any]] = []
    excluded_mem_count = 0
    for idx, mem in enumerate(raw_members):
        if not isinstance(mem, dict):
            errors.append(Issue(field="group_members", message=f"構成員[{idx}] がオブジェクトではありません"))
            excluded_mem_count += 1
            continue
        rep = validate(
            "member",
            mem,
            ValidationContext(known_group_ids=valid_old_group_ids),
            mode="lenient",
        )
        if not rep.ok:
            errors.extend(rep.errors)
            excluded_mem_count += 1
            continue
        pre_members.append(mem)

    db_ev_ids = get_existing_ids(conn, "EV")
    db_grp_ids = get_existing_ids(conn, "GRP")
    db_mem_ids = get_existing_ids(conn, "M")
    counters = {
        "EV": get_counter(conn, "EV"),
        "GRP": get_counter(conn, "GRP"),
        "M": get_counter(conn, "M"),
    }

    remap_res = remap_for_append(
        {
            "cards_event": pre_events,
            "evacuee_groups": pre_groups,
            "group_members": pre_members,
        },
        existing_event_ids=db_ev_ids,
        existing_group_ids=db_grp_ids,
        existing_member_ids=db_mem_ids,
        counters=counters,  # type: ignore[arg-type]
    )

    for iss in remap_res.issues:
        if iss.severity == "error":
            errors.append(iss)
            excluded_mem_count += 1
        else:
            warnings.append(iss)

    remapped_events = remap_res.payload["cards_event"]
    remapped_groups = remap_res.payload["evacuee_groups"]
    remapped_members = remap_res.payload["group_members"]

    all_known_ev_ids = db_ev_ids | {e["card_id"] for e in remapped_events}
    prereq_map = {e["card_id"]: e.get("prerequisite_card_id") for e in remapped_events}
    new_grp_ids = {g["group_id"] for g in remapped_groups}

    final_events: list[dict[str, Any]] = []
    for ev in remapped_events:
        rep = validate(
            "event",
            ev,
            ValidationContext(known_event_ids=all_known_ev_ids, prerequisite_map=prereq_map),
            mode="lenient",
        )
        warnings.extend(rep.warnings)
        final_events.append(rep.normalized)

    final_members: list[dict[str, Any]] = []
    members_by_group: dict[str, list[dict[str, Any]]] = {gid: [] for gid in new_grp_ids}
    for mem in remapped_members:
        rep = validate(
            "member",
            mem,
            ValidationContext(known_group_ids=new_grp_ids),
            mode="lenient",
        )
        warnings.extend(rep.warnings)
        final_members.append(rep.normalized)
        members_by_group[rep.normalized["group_id"]].append(rep.normalized)

    final_groups: list[dict[str, Any]] = []
    for grp in remapped_groups:
        gid = grp["group_id"]
        rep = validate(
            "group",
            grp,
            ValidationContext(group_members=members_by_group.get(gid, [])),
            mode="lenient",
        )
        warnings.extend(rep.warnings)
        final_groups.append(rep.normalized)

    payload_out = {
        "cards_event": final_events,
        "evacuee_groups": final_groups,
        "group_members": final_members,
    }
    report = ImportReport(
        ok=True,
        mode="append",
        dry_run=dry_run,
        counts={
            "events": len(final_events),
            "groups": len(final_groups),
            "members": len(final_members),
        },
        excluded_counts={
            "events": excluded_ev_count,
            "groups": excluded_grp_count,
            "members": excluded_mem_count,
        },
        id_map=remap_res.id_map,
        errors=errors,
        warnings=warnings,
        payload=payload_out,
    )
    return report, {k: int(v) for k, v in remap_res.counters.items()}


def import_json_payloads(
    conn: sqlite3.Connection,
    payloads: list[dict[str, Any]],
    *,
    mode: ImportMode = "replace",
    dry_run: bool = False,
) -> ImportReport:
    """1つ以上の辞書ペイロードを統合し、検証・インポート（またはドライラン）を実行する."""
    if mode not in ("replace", "append"):
        raise ValueError(f"不正なインポートモードです: {mode}")
    if not payloads:
        raise ValidationError([Issue(field="file", message="インポートするデータがありません")])

    merged = merge_payloads(payloads)

    if mode == "replace":
        report, new_counters = _prepare_replace(conn, merged, dry_run=dry_run)
    else:
        report, new_counters = _prepare_append(conn, merged, dry_run=dry_run)

    if dry_run:
        return report

    with transaction(conn):
        # インポートの直前に auto_import バージョンを自動作成 (IJ-15)
        auto_ver = create_version(
            conn,
            label=f"インポート前の自動保存 ({mode})",
            note=f"{mode} インポート直前に自動作成",
            kind="auto_import",
        )
        report.auto_version = auto_ver

        if mode == "replace":
            conn.execute("DELETE FROM group_members")
            conn.execute("DELETE FROM evacuee_groups")
            conn.execute("DELETE FROM cards_event")

        now = _now_iso()
        for ev in report.payload["cards_event"]:
            conn.execute(
                "INSERT INTO cards_event(card_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)",
                (ev["card_id"], json.dumps(ev, ensure_ascii=False), now, now),
            )
        for grp in report.payload["evacuee_groups"]:
            conn.execute(
                "INSERT INTO evacuee_groups(group_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)",
                (grp["group_id"], json.dumps(grp, ensure_ascii=False), now, now),
            )
        for mem in report.payload["group_members"]:
            conn.execute(
                "INSERT INTO group_members(member_id, group_id, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
                (
                    mem["member_id"],
                    mem["group_id"],
                    json.dumps(mem, ensure_ascii=False),
                    now,
                    now,
                ),
            )

        for prefix in ("EV", "GRP", "M"):
            set_counter(conn, prefix, new_counters.get(prefix, 0))  # type: ignore[arg-type]
        sync_counters_with_existing(conn)

    return report


def import_json_files(
    conn: sqlite3.Connection,
    files: list[tuple[str, bytes]],
    *,
    mode: ImportMode = "replace",
    dry_run: bool = False,
) -> ImportReport:
    """(filename, raw_bytes) のリストを受け取り、インポートを実行する."""
    if not files:
        raise ValidationError([Issue(field="file", message="ファイルが指定されていません")])
    payloads = [parse_json_bytes(content, fname) for fname, content in files]
    return import_json_payloads(conn, payloads, mode=mode, dry_run=dry_run)


def import_demo_data(
    conn: sqlite3.Connection,
    *,
    mode: ImportMode = "replace",
    sample_path: Path | None = None,
) -> ImportReport:
    """config.SAMPLE_PATH からデモデータを読み込んでインポートする (IJ-16, IJ-17)."""
    target_path = sample_path if sample_path is not None else config.SAMPLE_PATH
    if not target_path.exists():
        raise NotFoundError(f"デモデータファイルが見つかりません: {target_path}")
    raw = target_path.read_bytes()
    return import_json_files(conn, [(target_path.name, raw)], mode=mode, dry_run=False)


def export_all_json(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    """DB 全体のデータをサンプル形式（キー順も完全一致）で返す (IJ-01)."""
    repo = Repository(conn)
    return {
        "cards_event": repo.list_events(),
        "evacuee_groups": repo.list_groups(),
        "group_members": repo.list_members(),
    }


def export_search_json(
    search_result: SearchResult,
    all_groups: list[dict[str, Any]],
    all_members: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """検索結果をサンプル形式の 3 コレクションで返す（世帯の構成員も含める: IJ-18）."""
    events = [order_record_keys("event", e) for e in search_result.events]

    group_by_id = {g["group_id"]: g for g in all_groups}
    members_by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in all_groups}
    for m in all_members:
        gid = m.get("group_id")
        if gid in members_by_group:
            members_by_group[gid].append(m)

    groups_out: list[dict[str, Any]] = []
    members_out: list[dict[str, Any]] = []
    seen_groups: set[str] = set()
    seen_members: set[str] = set()

    for hh in search_result.households:
        grp = hh["group"]
        gid = grp["group_id"]
        if gid not in seen_groups:
            seen_groups.add(gid)
            groups_out.append(order_record_keys("group", grp))
        for m in hh.get("members") or members_by_group.get(gid, []):
            mid = m["member_id"]
            if mid not in seen_members:
                seen_members.add(mid)
                members_out.append(order_record_keys("member", m))

    for m in search_result.persons + search_result.pets:
        mid = m["member_id"]
        gid = m.get("group_id", "")
        if gid and gid in group_by_id and gid not in seen_groups:
            seen_groups.add(gid)
            groups_out.append(order_record_keys("group", group_by_id[gid]))
        if mid not in seen_members:
            seen_members.add(mid)
            members_out.append(order_record_keys("member", m))

    return {
        "cards_event": events,
        "evacuee_groups": groups_out,
        "group_members": members_out,
    }
