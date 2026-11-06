"""リポジトリ層（イベント・世帯・構成員・保存済み検索/デッキの永続化）."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3
from typing import Any

from hugdb.db import transaction
from hugdb.ids import allocate_id, parse_id_number
from hugdb.schema import order_record_keys
from hugdb.validation import Issue, ValidationContext, validate


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class NotFoundError(Exception):
    """対象レコードが存在しない場合の例外."""

    def __init__(self, message: str, record_id: str | None = None) -> None:
        super().__init__(message)
        self.record_id = record_id


class ConflictError(Exception):
    """参照制約や前提カード依存などの競合例外 (HTTP 409 用)."""

    def __init__(
        self,
        message: str,
        dependents: list[str] | None = None,
        errors: list[Issue] | None = None,
    ) -> None:
        super().__init__(message)
        self.dependents = dependents or []
        self.errors = errors or []


class ValidationError(Exception):
    """入力検証エラー例外 (HTTP 422 用)."""

    def __init__(self, errors: list[Issue], message: str = "入力内容に誤りがあります") -> None:
        super().__init__(message)
        self.errors = errors


class Repository:
    """SQLite データベースに対する CRUD 操作を提供するクラス."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    # ------------------------------------------------------------------
    # イベントカード (cards_event)
    # ------------------------------------------------------------------

    def list_events(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT data FROM cards_event").fetchall()
        events = [order_record_keys("event", json.loads(r["data"])) for r in rows]
        events.sort(key=lambda e: (parse_id_number("EV", e.get("card_id")) or 999999, e.get("card_id", "")))
        return events

    def list_events_with_meta(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT card_id, data, created_at, updated_at FROM cards_event"
        ).fetchall()
        result = [
            {
                "card_id": r["card_id"],
                "data": order_record_keys("event", json.loads(r["data"])),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
        result.sort(key=lambda x: (parse_id_number("EV", x["card_id"]) or 999999, x["card_id"]))
        return result

    def get_event(self, card_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT data FROM cards_event WHERE card_id = ?", (card_id,)
        ).fetchone()
        if not row:
            return None
        return order_record_keys("event", json.loads(row["data"]))

    def get_event_meta(self, card_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT card_id, data, created_at, updated_at FROM cards_event WHERE card_id = ?",
            (card_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "card_id": row["card_id"],
            "data": order_record_keys("event", json.loads(row["data"])),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def create_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        with transaction(self.conn):
            new_id = allocate_id(self.conn, "EV")
            record = dict(payload)
            record["card_id"] = new_id

            existing_events = self.list_events()
            known_ids = {e["card_id"] for e in existing_events} | {new_id}
            prereq_map = {e["card_id"]: e.get("prerequisite_card_id") for e in existing_events}

            ctx = ValidationContext(known_event_ids=known_ids, prerequisite_map=prereq_map)
            rep = validate("event", record, ctx, mode="strict")
            if not rep.ok:
                raise ValidationError(rep.errors)

            now = _now_iso()
            self.conn.execute(
                "INSERT INTO cards_event(card_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)",
                (new_id, json.dumps(rep.normalized, ensure_ascii=False), now, now),
            )
            return rep.normalized

    def update_event(self, card_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with transaction(self.conn):
            existing = self.get_event(card_id)
            if existing is None:
                raise NotFoundError(f"イベント '{card_id}' が見つかりません", record_id=card_id)

            if "card_id" in payload and payload["card_id"] is not None and payload["card_id"] != card_id:
                raise ValidationError(
                    [Issue(field="card_id", message="カードIDは変更できません", record_id=card_id)]
                )

            record = dict(payload)
            record["card_id"] = card_id

            all_events = self.list_events()
            known_ids = {e["card_id"] for e in all_events}
            prereq_map = {
                e["card_id"]: e.get("prerequisite_card_id")
                for e in all_events
                if e["card_id"] != card_id
            }

            ctx = ValidationContext(known_event_ids=known_ids, prerequisite_map=prereq_map)
            rep = validate("event", record, ctx, mode="strict")
            if not rep.ok:
                raise ValidationError(rep.errors)

            now = _now_iso()
            self.conn.execute(
                "UPDATE cards_event SET data = ?, updated_at = ? WHERE card_id = ?",
                (json.dumps(rep.normalized, ensure_ascii=False), now, card_id),
            )
            return rep.normalized

    def get_dependent_events(self, card_id: str) -> list[dict[str, Any]]:
        events = self.list_events()
        return [e for e in events if e.get("prerequisite_card_id") == card_id]

    def delete_event(self, card_id: str, force: bool = False) -> list[str]:
        with transaction(self.conn):
            existing = self.get_event(card_id)
            if existing is None:
                raise NotFoundError(f"イベント '{card_id}' が見つかりません", record_id=card_id)

            dependents = self.get_dependent_events(card_id)
            dep_ids = [d["card_id"] for d in dependents]
            if dep_ids and not force:
                raise ConflictError(
                    f"イベント '{card_id}' は他のカード ({', '.join(dep_ids)}) の前提カードになっています",
                    dependents=dep_ids,
                    errors=[
                        Issue(
                            field="prerequisite_card_id",
                            message=f"依存しているカード: {', '.join(dep_ids)}",
                            record_id=card_id,
                        )
                    ],
                )

            now = _now_iso()
            for dep in dependents:
                dep["prerequisite_card_id"] = None
                ordered = order_record_keys("event", dep)
                self.conn.execute(
                    "UPDATE cards_event SET data = ?, updated_at = ? WHERE card_id = ?",
                    (json.dumps(ordered, ensure_ascii=False), now, dep["card_id"]),
                )

            self.conn.execute("DELETE FROM cards_event WHERE card_id = ?", (card_id,))
            return dep_ids

    # ------------------------------------------------------------------
    # 避難者グループ & 構成員 (evacuee_groups / group_members)
    # ------------------------------------------------------------------

    def list_groups(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT data FROM evacuee_groups").fetchall()
        groups = [order_record_keys("group", json.loads(r["data"])) for r in rows]
        groups.sort(key=lambda g: (parse_id_number("GRP", g.get("group_id")) or 999999, g.get("group_id", "")))
        return groups

    def list_groups_with_meta(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT group_id, data, created_at, updated_at FROM evacuee_groups"
        ).fetchall()
        result = [
            {
                "group_id": r["group_id"],
                "data": order_record_keys("group", json.loads(r["data"])),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
        result.sort(key=lambda x: (parse_id_number("GRP", x["group_id"]) or 999999, x["group_id"]))
        return result

    def list_members(self, group_id: str | None = None) -> list[dict[str, Any]]:
        if group_id is not None:
            rows = self.conn.execute(
                "SELECT data FROM group_members WHERE group_id = ?", (group_id,)
            ).fetchall()
        else:
            rows = self.conn.execute("SELECT data FROM group_members").fetchall()
        members = [order_record_keys("member", json.loads(r["data"])) for r in rows]
        members.sort(key=lambda m: (parse_id_number("M", m.get("member_id")) or 999999, m.get("member_id", "")))
        return members

    def list_members_with_meta(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT member_id, group_id, data, created_at, updated_at FROM group_members"
        ).fetchall()
        result = [
            {
                "member_id": r["member_id"],
                "group_id": r["group_id"],
                "data": order_record_keys("member", json.loads(r["data"])),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
        result.sort(key=lambda x: (parse_id_number("M", x["member_id"]) or 999999, x["member_id"]))
        return result

    def get_group(self, group_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT data FROM evacuee_groups WHERE group_id = ?", (group_id,)
        ).fetchone()
        if not row:
            return None
        return order_record_keys("group", json.loads(row["data"]))

    def get_member(self, member_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT data FROM group_members WHERE member_id = ?", (member_id,)
        ).fetchone()
        if not row:
            return None
        return order_record_keys("member", json.loads(row["data"]))

    def get_household(self, group_id: str) -> dict[str, Any] | None:
        grp = self.get_group(group_id)
        if grp is None:
            return None
        members = self.list_members(group_id)
        return {"group": grp, "members": members}

    def list_households(self) -> list[dict[str, Any]]:
        groups = self.list_groups()
        all_members = self.list_members()
        by_group: dict[str, list[dict[str, Any]]] = {g["group_id"]: [] for g in groups}
        for m in all_members:
            gid = m.get("group_id")
            if gid in by_group:
                by_group[gid].append(m)
        return [{"group": g, "members": by_group.get(g["group_id"], [])} for g in groups]

    def save_household(
        self,
        group: dict[str, Any],
        members: list[dict[str, Any]],
        *,
        is_create: bool = False,
        expected_group_id: str | None = None,
    ) -> dict[str, Any]:
        """世帯（グループ＋構成員）を1トランザクションで一括保存し、人数を自動計算する."""
        with transaction(self.conn):
            grp_data = dict(group)
            if expected_group_id is not None:
                existing_grp = self.get_group(expected_group_id)
                if existing_grp is None:
                    raise NotFoundError(
                        f"グループ '{expected_group_id}' が見つかりません",
                        record_id=expected_group_id,
                    )
                if (
                    "group_id" in grp_data
                    and grp_data["group_id"] is not None
                    and grp_data["group_id"] != expected_group_id
                ):
                    raise ValidationError(
                        [
                            Issue(
                                field="group_id",
                                message="グループIDは変更できません",
                                record_id=expected_group_id,
                            )
                        ]
                    )
                group_id = expected_group_id
                is_new_group = False
            elif is_create or not grp_data.get("group_id"):
                group_id = allocate_id(self.conn, "GRP")
                is_new_group = True
            else:
                group_id = str(grp_data["group_id"])
                existing_grp = self.get_group(group_id)
                is_new_group = existing_grp is None

            grp_data["group_id"] = group_id

            existing_members_map = {
                m["member_id"]: m for m in self.list_members(group_id)
            }

            all_errors: list[Issue] = []
            normalized_members: list[dict[str, Any]] = []
            seen_member_ids: set[str] = set()

            for raw_mem in members:
                if not isinstance(raw_mem, dict):
                    raise ValidationError([Issue(field="members", message="構成員データが不正です")])

                mem_data = dict(raw_mem)
                raw_mid = mem_data.get("member_id")
                mid = str(raw_mid).strip() if raw_mid and str(raw_mid).strip() else None

                if is_create or not mid:
                    mid = allocate_id(self.conn, "M")
                else:
                    # 既存構成員における group_id の不整合チェック (RE-09)
                    given_gid = mem_data.get("group_id")
                    if given_gid and str(given_gid).strip() != group_id:
                        target_gid = str(given_gid).strip()
                        if self.get_group(target_gid) is None:
                            raise sqlite3.IntegrityError(f"FOREIGN KEY constraint failed: group_id={target_gid}")
                        all_errors.append(
                            Issue(
                                field="group_id",
                                message=f"構成員の group_id ('{target_gid}') が世帯の group_id ('{group_id}') と一致しません",
                                record_id=mid,
                            )
                        )
                    # 既存構成員の data_type 変更禁止チェック (RE-08)
                    old_mem = existing_members_map.get(mid) or self.get_member(mid)
                    if old_mem is not None:
                        if old_mem.get("group_id") != group_id:
                            all_errors.append(
                                Issue(
                                    field="member_id",
                                    message=f"構成員ID '{mid}' は別グループに属しています",
                                    record_id=mid,
                                )
                            )
                        if mem_data.get("data_type") != old_mem.get("data_type"):
                            all_errors.append(
                                Issue(
                                    field="data_type",
                                    message="構成員の種別（人物⇔ペット）は変更できません。削除して作り直してください",
                                    record_id=mid,
                                )
                            )

                mem_data["member_id"] = mid
                mem_data["group_id"] = group_id

                m_ctx = ValidationContext(
                    known_group_ids={group_id},
                    seen_ids=seen_member_ids,
                )
                m_rep = validate("member", mem_data, m_ctx, mode="strict")
                if not m_rep.ok:
                    all_errors.extend(m_rep.errors)
                normalized_members.append(m_rep.normalized)

            # 人物・ペット数の自動計算とグループ検証 (VA-24, VA-25)
            grp_data["member_count"] = sum(
                1 for m in normalized_members if m.get("data_type") == "人物"
            )
            grp_data["pet_count"] = sum(
                1 for m in normalized_members if m.get("data_type") == "ペット"
            )

            g_ctx = ValidationContext(group_members=normalized_members)
            g_rep = validate("group", grp_data, g_ctx, mode="strict")
            if not g_rep.ok:
                all_errors.extend(g_rep.errors)

            if all_errors:
                raise ValidationError(all_errors)

            now = _now_iso()
            if is_new_group:
                self.conn.execute(
                    "INSERT INTO evacuee_groups(group_id, data, created_at, updated_at) VALUES(?, ?, ?, ?)",
                    (group_id, json.dumps(g_rep.normalized, ensure_ascii=False), now, now),
                )
            else:
                self.conn.execute(
                    "UPDATE evacuee_groups SET data = ?, updated_at = ? WHERE group_id = ?",
                    (json.dumps(g_rep.normalized, ensure_ascii=False), now, group_id),
                )

            # 削除された構成員を DB から削除
            keep_ids = {m["member_id"] for m in normalized_members}
            for old_mid in existing_members_map:
                if old_mid not in keep_ids:
                    self.conn.execute(
                        "DELETE FROM group_members WHERE member_id = ?", (old_mid,)
                    )

            # 構成員の追加・更新
            for norm_m in normalized_members:
                mid = norm_m["member_id"]
                if mid in existing_members_map:
                    self.conn.execute(
                        "UPDATE group_members SET group_id = ?, data = ?, updated_at = ? WHERE member_id = ?",
                        (group_id, json.dumps(norm_m, ensure_ascii=False), now, mid),
                    )
                else:
                    self.conn.execute(
                        "INSERT INTO group_members(member_id, group_id, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
                        (mid, group_id, json.dumps(norm_m, ensure_ascii=False), now, now),
                    )

            return {"group": g_rep.normalized, "members": normalized_members}

    def delete_household(self, group_id: str) -> None:
        with transaction(self.conn):
            existing = self.get_group(group_id)
            if existing is None:
                raise NotFoundError(f"グループ '{group_id}' が見つかりません", record_id=group_id)
            self.conn.execute("DELETE FROM evacuee_groups WHERE group_id = ?", (group_id,))

    def delete_member(self, member_id: str) -> dict[str, Any]:
        """構成員を1人だけ削除し、世帯の人数を再計算する（最後の人物なら ConflictError）."""
        with transaction(self.conn):
            mem = self.get_member(member_id)
            if mem is None:
                raise NotFoundError(f"構成員 '{member_id}' が見つかりません", record_id=member_id)

            group_id = mem["group_id"]
            grp = self.get_group(group_id)
            if grp is None:
                raise NotFoundError(f"所属グループ '{group_id}' が見つかりません", record_id=group_id)

            members = self.list_members(group_id)
            remaining = [m for m in members if m["member_id"] != member_id]
            remaining_persons = sum(1 for m in remaining if m.get("data_type") == "人物")

            if remaining_persons == 0:
                raise ConflictError(
                    "世帯には人物が1名以上必要なため、最後の人物は削除できません",
                    errors=[
                        Issue(
                            field="member_id",
                            message="世帯には人物が1名以上必要です",
                            record_id=member_id,
                        )
                    ],
                )

            now = _now_iso()
            self.conn.execute("DELETE FROM group_members WHERE member_id = ?", (member_id,))

            grp["member_count"] = remaining_persons
            grp["pet_count"] = sum(1 for m in remaining if m.get("data_type") == "ペット")
            ordered_grp = order_record_keys("group", grp)
            self.conn.execute(
                "UPDATE evacuee_groups SET data = ?, updated_at = ? WHERE group_id = ?",
                (json.dumps(ordered_grp, ensure_ascii=False), now, group_id),
            )
            return {"group": ordered_grp, "members": remaining}

    # ------------------------------------------------------------------
    # 全件削除 (clear_all)
    # ------------------------------------------------------------------

    def clear_all(self, include_saved: bool = False) -> None:
        """カードデータを全件削除する。バージョンとID採番カウンタは保持する."""
        with transaction(self.conn):
            self.conn.execute("DELETE FROM group_members")
            self.conn.execute("DELETE FROM evacuee_groups")
            self.conn.execute("DELETE FROM cards_event")
            if include_saved:
                self.conn.execute("DELETE FROM saved_searches")
                self.conn.execute("DELETE FROM saved_decks")

    # ------------------------------------------------------------------
    # 保存済み検索 (saved_searches)
    # ------------------------------------------------------------------

    def create_saved_search(
        self,
        name: str,
        filters: dict[str, Any],
        result_ids: list[str],
    ) -> dict[str, Any]:
        if not name or not name.strip():
            raise ValidationError([Issue(field="name", message="検索結果の保存名は必須です")])
        now = _now_iso()
        with transaction(self.conn):
            cur = self.conn.execute(
                "INSERT INTO saved_searches(name, filters, result_ids, created_at) VALUES(?, ?, ?, ?)",
                (
                    name.strip(),
                    json.dumps(filters, ensure_ascii=False),
                    json.dumps(result_ids, ensure_ascii=False),
                    now,
                ),
            )
            row_id = cur.lastrowid
        return self.get_saved_search(int(row_id))  # type: ignore[return-value]

    def list_saved_searches(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id, name, filters, result_ids, created_at FROM saved_searches ORDER BY id DESC"
        ).fetchall()
        return [self._format_saved_search_row(r) for r in rows]

    def get_saved_search(self, search_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT id, name, filters, result_ids, created_at FROM saved_searches WHERE id = ?",
            (search_id,),
        ).fetchone()
        if not row:
            return None
        return self._format_saved_search_row(row)

    def _format_saved_search_row(self, row: sqlite3.Row) -> dict[str, Any]:
        result_ids: list[str] = json.loads(row["result_ids"])
        existing_ids = (
            {e["card_id"] for e in self.list_events()}
            | {g["group_id"] for g in self.list_groups()}
            | {m["member_id"] for m in self.list_members()}
        )
        missing_ids = [rid for rid in result_ids if rid not in existing_ids]
        return {
            "id": row["id"],
            "name": row["name"],
            "filters": json.loads(row["filters"]),
            "result_ids": result_ids,
            "missing_ids": missing_ids,
            "created_at": row["created_at"],
        }

    def delete_saved_search(self, search_id: int) -> None:
        with transaction(self.conn):
            existing = self.get_saved_search(search_id)
            if existing is None:
                raise NotFoundError(f"保存済み検索 '{search_id}' が見つかりません", record_id=str(search_id))
            self.conn.execute("DELETE FROM saved_searches WHERE id = ?", (search_id,))

    # ------------------------------------------------------------------
    # 保存済みデッキ条件 (saved_decks)
    # ------------------------------------------------------------------

    def create_saved_deck(
        self,
        name: str,
        conditions: dict[str, Any],
        manual_order: list[str] | None = None,
        resolutions: dict[str, str] | None = None,
        content_hash: str | None = None,
    ) -> dict[str, Any]:
        if not name or not name.strip():
            raise ValidationError([Issue(field="name", message="デッキ保存名は必須です")])
        now = _now_iso()
        with transaction(self.conn):
            cur = self.conn.execute(
                "INSERT INTO saved_decks(name, conditions, manual_order, resolutions, content_hash, created_at, updated_at) "
                "VALUES(?, ?, ?, ?, ?, ?, ?)",
                (
                    name.strip(),
                    json.dumps(conditions, ensure_ascii=False),
                    json.dumps(manual_order, ensure_ascii=False) if manual_order is not None else None,
                    json.dumps(resolutions, ensure_ascii=False) if resolutions is not None else None,
                    content_hash,
                    now,
                    now,
                ),
            )
            row_id = cur.lastrowid
        return self.get_saved_deck(int(row_id))  # type: ignore[return-value]

    def list_saved_decks(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id, name, conditions, manual_order, resolutions, content_hash, created_at, updated_at "
            "FROM saved_decks ORDER BY id DESC"
        ).fetchall()
        return [self._format_saved_deck_row(r) for r in rows]

    def get_saved_deck(self, deck_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT id, name, conditions, manual_order, resolutions, content_hash, created_at, updated_at "
            "FROM saved_decks WHERE id = ?",
            (deck_id,),
        ).fetchone()
        if not row:
            return None
        return self._format_saved_deck_row(row)

    def _format_saved_deck_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "conditions": json.loads(row["conditions"]),
            "manual_order": json.loads(row["manual_order"]) if row["manual_order"] else None,
            "resolutions": json.loads(row["resolutions"]) if row["resolutions"] else {},
            "content_hash": row["content_hash"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def update_saved_deck(
        self,
        deck_id: int,
        *,
        name: str | None = None,
        conditions: dict[str, Any] | None = None,
        manual_order: list[str] | None = None,
        resolutions: dict[str, str] | None = None,
        content_hash: str | None = None,
    ) -> dict[str, Any]:
        with transaction(self.conn):
            current = self.get_saved_deck(deck_id)
            if current is None:
                raise NotFoundError(f"保存済みデッキ '{deck_id}' が見つかりません", record_id=str(deck_id))

            new_name = name.strip() if name is not None else current["name"]
            if not new_name:
                raise ValidationError([Issue(field="name", message="デッキ保存名は必須です")])
            new_cond = conditions if conditions is not None else current["conditions"]
            new_order = manual_order if manual_order is not None else current["manual_order"]
            new_res = resolutions if resolutions is not None else current["resolutions"]
            new_hash = content_hash if content_hash is not None else current["content_hash"]

            now = _now_iso()
            self.conn.execute(
                "UPDATE saved_decks SET name = ?, conditions = ?, manual_order = ?, "
                "resolutions = ?, content_hash = ?, updated_at = ? WHERE id = ?",
                (
                    new_name,
                    json.dumps(new_cond, ensure_ascii=False),
                    json.dumps(new_order, ensure_ascii=False) if new_order is not None else None,
                    json.dumps(new_res, ensure_ascii=False) if new_res is not None else None,
                    new_hash,
                    now,
                    deck_id,
                ),
            )
        return self.get_saved_deck(deck_id)  # type: ignore[return-value]

    def delete_saved_deck(self, deck_id: int) -> None:
        with transaction(self.conn):
            existing = self.get_saved_deck(deck_id)
            if existing is None:
                raise NotFoundError(f"保存済みデッキ '{deck_id}' が見つかりません", record_id=str(deck_id))
            self.conn.execute("DELETE FROM saved_decks WHERE id = ?", (deck_id,))
