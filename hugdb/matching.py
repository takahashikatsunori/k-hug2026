"""カード抽出条件（match_* / exclude_* および日付範囲）の適合判定モジュール."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
import re
from typing import Any
import unicodedata

from hugdb.holidays import holiday_types, parse_date

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

_SINGLE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})$")
_RANGE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})\s*-\s*(\d{1,2})/(\d{1,2})$")


@dataclass
class MatchResult:
    """1次元の条件判定結果."""

    matched: bool
    reason: str | None = None
    warnings: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.matched


@dataclass
class TrainingConditions:
    """訓練条件パラメータ."""

    shelter: str | set[str] | list[str] | None = None
    date: date | str | None = None
    holiday_type: set[str] | list[str] | str | None = None
    time_slot: str | set[str] | list[str] | None = None
    disaster_type: str | set[str] | list[str] | None = None
    infrastructure: set[str] | list[str] | str | None = None
    weather: set[str] | list[str] | str | None = None
    disaster_phase: set[str] | list[str] | str | None = None
    max_events: int | None = None
    max_households: int | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | TrainingConditions | None) -> TrainingConditions:
        if data is None:
            return cls()
        if isinstance(data, TrainingConditions):
            return data
        return cls(
            shelter=data.get("shelter") or data.get("shelters"),
            date=data.get("date") or data.get("dates"),
            holiday_type=data.get("holiday_type") or data.get("holiday_types"),
            time_slot=data.get("time_slot") or data.get("time_slots"),
            disaster_type=data.get("disaster_type") or data.get("disaster_types"),
            infrastructure=data.get("infrastructure"),
            weather=data.get("weather"),
            disaster_phase=data.get("disaster_phase"),
            max_events=data.get("max_events"),
            max_households=data.get("max_households"),
        )


def _to_value_set(values: Any) -> set[str]:
    if values is None:
        return set()
    if isinstance(values, str):
        s = values.strip()
        return {s} if s else set()
    if isinstance(values, Iterable):
        return {str(v).strip() for v in values if v is not None and str(v).strip()}
    return {str(values).strip()}


def matches_dimension(
    match_list: Iterable[str] | None,
    exclude_list: Iterable[str] | None,
    values: Iterable[str] | str | None,
    dimension_label: str = "条件",
) -> MatchResult:
    """1つの検索次元に対して (match, exclude) と訓練条件値集合を照合する.

    - 訓練条件値集合が空なら絞り込みを行わず適合 (MA-10)
    - 排除条件に1つでも含まれれば無条件で不適合（排除を優先）(MA-05, MA-06, MA-08)
    - 合致条件が空、または訓練条件値のいずれか1つが含まれれば適合 (MA-01, MA-03, MA-07)
    """
    val_set = _to_value_set(values)
    if not val_set:
        return MatchResult(True)

    m_set = _to_value_set(match_list)
    e_set = _to_value_set(exclude_list)

    excluded_hits = sorted(val_set & e_set)
    if excluded_hits:
        return MatchResult(
            False,
            reason=f"排除: {dimension_label}={','.join(excluded_hits)}",
        )

    if m_set and not (val_set & m_set):
        return MatchResult(
            False,
            reason=f"合致条件外: {dimension_label}",
        )

    return MatchResult(True)


def _valid_md(m: int, d: int) -> bool:
    return 1 <= m <= 12 and 1 <= d <= _DAYS_IN_MONTH[m]


def parse_date_ranges(
    spec: str | list[str] | None,
) -> tuple[list[tuple[tuple[int, int], tuple[int, int]]], list[str]]:
    """日付指定文字列またはリストを ((m1, d1), (m2, d2)) のリストと警告リストに変換する."""
    if spec is None:
        return [], []
    if isinstance(spec, list):
        if not spec:
            return [], []
        raw_str = ", ".join(str(x) for x in spec if x is not None and str(x).strip())
    elif isinstance(spec, str):
        raw_str = spec
    else:
        return [], [f"不正な日付指定: {spec!r}"]

    s = unicodedata.normalize("NFKC", raw_str).strip()
    if not s:
        return [], []

    for dash in ("〜", "～", "−", "ー", "―", "–", "—", "ｰ"):
        s = s.replace(dash, "-")
    s = s.replace("、", ",")

    tokens = [t.strip() for t in s.split(",") if t.strip()]
    ranges: list[tuple[tuple[int, int], tuple[int, int]]] = []
    warnings: list[str] = []

    for token in tokens:
        m_single = _SINGLE_RE.match(token)
        if m_single:
            m1, d1 = int(m_single.group(1)), int(m_single.group(2))
            if _valid_md(m1, d1):
                ranges.append(((m1, d1), (m1, d1)))
            else:
                warnings.append(f"不正な日付指定 '{token}' を無視しました")
            continue

        m_range = _RANGE_RE.match(token)
        if m_range:
            m1, d1, m2, d2 = (
                int(m_range.group(1)),
                int(m_range.group(2)),
                int(m_range.group(3)),
                int(m_range.group(4)),
            )
            if _valid_md(m1, d1) and _valid_md(m2, d2):
                ranges.append(((m1, d1), (m2, d2)))
            else:
                warnings.append(f"不正な日付範囲 '{token}' を無視しました")
            continue

        warnings.append(f"不正な日付書式 '{token}' を無視しました")

    return ranges, warnings


def matches_date_dimension(
    match_dates: str | list[str] | None,
    exclude_dates: str | list[str] | None,
    target_date: date | str | None,
) -> MatchResult:
    """日付次元 (match_dates / exclude_dates) と訓練日を照合する."""
    if target_date is None or (isinstance(target_date, str) and not target_date.strip()):
        return MatchResult(True)

    dt = parse_date(target_date)
    md = (dt.month, dt.day)

    e_ranges, e_warns = parse_date_ranges(exclude_dates)
    m_ranges, m_warns = parse_date_ranges(match_dates)
    warnings = e_warns + m_warns

    def _hit(ranges: list[tuple[tuple[int, int], tuple[int, int]]]) -> bool:
        for start, end in ranges:
            if start <= end:
                if start <= md <= end:
                    return True
            else:
                if md >= start or md <= end:
                    return True
        return False

    if e_ranges and _hit(e_ranges):
        return MatchResult(
            False,
            reason=f"排除: 日付={dt.month:02d}/{dt.day:02d}",
            warnings=warnings,
        )

    if m_ranges and not _hit(m_ranges):
        return MatchResult(
            False,
            reason="合致条件外: 日付",
            warnings=warnings,
        )

    return MatchResult(True, warnings=warnings)


def is_eligible(
    card: dict[str, Any],
    cond: TrainingConditions | dict[str, Any] | None,
) -> tuple[bool, list[str]]:
    """カード（イベントまたはグループ）が訓練条件に適合するか判定し、(適合フラグ, 不採用理由一覧) を返す."""
    tc = TrainingConditions.from_dict(cond)
    reasons: list[str] = []

    # 休日種別の解決（手動指定があれば優先、なければ日付から自動計算）
    resolved_holidays = _to_value_set(tc.holiday_type)
    if not resolved_holidays and tc.date is not None and str(tc.date).strip():
        try:
            resolved_holidays = holiday_types(tc.date)
        except ValueError:
            resolved_holidays = set()

    checks = [
        matches_dimension(
            card.get("match_shelters"),
            card.get("exclude_shelters"),
            tc.shelter,
            "避難所",
        ),
        matches_date_dimension(
            card.get("match_dates"),
            card.get("exclude_dates"),
            tc.date,
        ),
        matches_dimension(
            card.get("match_holiday_type"),
            card.get("exclude_holiday_type"),
            resolved_holidays,
            "休日種別",
        ),
        matches_dimension(
            card.get("match_time_slots"),
            card.get("exclude_time_slots"),
            tc.time_slot,
            "時間帯",
        ),
        matches_dimension(
            card.get("match_disaster_types"),
            card.get("exclude_disaster_types"),
            tc.disaster_type,
            "災害種類",
        ),
        matches_dimension(
            card.get("match_infrastructure"),
            card.get("exclude_infrastructure"),
            tc.infrastructure,
            "インフラ状況",
        ),
        matches_dimension(
            card.get("match_weather"),
            card.get("exclude_weather"),
            tc.weather,
            "天候",
        ),
    ]

    for res in checks:
        if not res.matched and res.reason:
            reasons.append(res.reason)

    # 進行度の絞り込み（指定時のみ。カードの進行度が空なら適合とみなす: DE-07）
    phase_filter = _to_value_set(tc.disaster_phase)
    if phase_filter:
        card_phases = _to_value_set(card.get("disaster_phase"))
        if card_phases and not (card_phases & phase_filter):
            reasons.append("合致条件外: 災害進行度")

    return len(reasons) == 0, reasons
