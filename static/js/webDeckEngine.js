/**
 * Web版 HUGカードデッキ構築エンジン (完全クライアントサイド実行)
 * - 祝日・休日種別判定 (日本の国民の祝日・振替休日・国民の休日・大型連休・年末年始)
 * - 訓練条件適合判定 (hugdb/matching.py 準拠)
 * - 順序計算・進行度矛盾検出・トポロジカルソート (hugdb/ordering.py 準拠)
 * - デッキ初期提案構築・カード抜き差し・並べ替え・連番化 (hugdb/deck.py 準拠)
 * - カード台帳 (11列CSV / JSON) のエクスポートおよび再インポート復元 (hugdb/io_csv.py 準拠)
 */

export const RELATIVE_TIMING_LIST = [
  "先頭（開所・初期）",
  "序盤",
  "中盤",
  "終盤",
  "最後（振り返り・収束）",
];

export const DISASTER_PHASE_LIST = [
  "発災直後",
  "初日",
  "2日目",
  "3日目",
  "4日目",
  "5日目以降",
];

export const CARD_CSV_HEADERS = [
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
];

const DAYS_IN_MONTH = {
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
};

// ============================================================================
// 1. 日本の祝日・休日種別判定 (hugdb/holidays.py 準拠)
// ============================================================================

function getNthMonday(year, month, n) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const firstMonday = 1 + ((8 - firstDay) % 7);
  return firstMonday + (n - 1) * 7;
}

function getVernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function getAutumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function isBaseJapaneseHoliday(year, month, day) {
  // 固定祝日およびハッピーマンデー (2020年以降の現行法準拠)
  if (month === 1 && day === 1) return true; // 元日
  if (month === 1 && day === getNthMonday(year, 1, 2)) return true; // 成人の日
  if (month === 2 && day === 11) return true; // 建国記念の日
  if (month === 2 && day === 23 && year >= 2020) return true; // 天皇誕生日
  if (month === 3 && day === getVernalEquinoxDay(year)) return true; // 春分の日
  if (month === 4 && day === 29) return true; // 昭和の日
  if (month === 5 && (day === 3 || day === 4 || day === 5)) return true; // 憲法記念日・みどりの日・こどもの日
  if (month === 7 && day === getNthMonday(year, 7, 3)) return true; // 海の日
  if (month === 8 && day === 11) return true; // 山の日
  if (month === 9 && day === getNthMonday(year, 9, 3)) return true; // 敬老の日
  if (month === 9 && day === getAutumnalEquinoxDay(year)) return true; // 秋分の日
  if (month === 10 && day === getNthMonday(year, 10, 2)) return true; // スポーツの日
  if (month === 11 && (day === 3 || day === 23)) return true; // 文化の日・勤労感謝の日
  return false;
}

export function isJapaneseHoliday(year, month, day) {
  if (isBaseJapaneseHoliday(year, month, day)) return true;

  const dt = new Date(year, month - 1, day);
  const dow = dt.getDay();

  // 振替休日: 日曜が祝日の場合、以降の最初の非祝日平日
  if (dow !== 0) {
    let check = new Date(year, month - 1, day);
    while (true) {
      check.setDate(check.getDate() - 1);
      const cy = check.getFullYear();
      const cm = check.getMonth() + 1;
      const cd = check.getDate();
      if (!isBaseJapaneseHoliday(cy, cm, cd)) {
        break;
      }
      if (check.getDay() === 0) {
        return true;
      }
    }
  }

  // 国民の休日: 前日と翌日がともに祝日の平日 (主に9月の敬老の日と秋分の日の間)
  if (dow !== 0) {
    const prev = new Date(year, month - 1, day - 1);
    const next = new Date(year, month - 1, day + 1);
    if (
      isBaseJapaneseHoliday(prev.getFullYear(), prev.getMonth() + 1, prev.getDate()) &&
      isBaseJapaneseHoliday(next.getFullYear(), next.getMonth() + 1, next.getDate())
    ) {
      return true;
    }
  }

  return false;
}

function inMmDdPeriods(month, day, periods) {
  const md = month * 100 + day;
  for (const [start, end] of periods) {
    const s = start[0] * 100 + start[1];
    const e = end[0] * 100 + end[1];
    if (s <= e) {
      if (md >= s && md <= e) return true;
    } else {
      if (md >= s || md <= e) return true;
    }
  }
  return false;
}

const LONG_HOLIDAY_PERIODS = [
  [[4, 29], [5, 6]],
  [[8, 13], [8, 16]],
];

const YEAR_END_PERIODS = [
  [[12, 29], [1, 3]],
];

/**
 * 日付文字列 ('YYYY-MM-DD') から休日種別配列を返す.
 * @param {string} dateStr
 * @returns {string[]}
 */
export function detectHolidayTypes(dateStr) {
  if (!dateStr || !String(dateStr).trim()) return [];
  const s = String(dateStr).trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return [];

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() + 1 !== month ||
    dt.getDate() !== day
  ) {
    return [];
  }

  const set = new Set();
  const dow = dt.getDay();
  if (dow === 0 || dow === 6) {
    set.add("土日");
  }
  if (isJapaneseHoliday(year, month, day)) {
    set.add("祝日");
  }
  if (inMmDdPeriods(month, day, YEAR_END_PERIODS)) {
    set.add("年末年始");
  }
  if (inMmDdPeriods(month, day, LONG_HOLIDAY_PERIODS)) {
    set.add("大型連休");
  }
  if (set.size === 0) {
    set.add("平日");
  }

  const order = ["平日", "土日", "祝日", "大型連休", "年末年始"];
  return order.filter((h) => set.has(h));
}

// ============================================================================
// 2. 訓練条件適合判定 (hugdb/matching.py 準拠)
// ============================================================================

function toValueSet(values) {
  if (values === null || values === undefined) return new Set();
  if (typeof values === "string") {
    const s = values.trim();
    return s ? new Set([s]) : new Set();
  }
  if (Array.isArray(values) || values instanceof Set) {
    const out = new Set();
    for (const v of values) {
      if (v !== null && v !== undefined && String(v).trim()) {
        out.add(String(v).trim());
      }
    }
    return out;
  }
  const s = String(values).trim();
  return s ? new Set([s]) : new Set();
}

export function matchesDimension(matchList, excludeList, values, dimensionLabel = "条件") {
  const valSet = toValueSet(values);
  if (valSet.size === 0) {
    return { matched: true, reason: null };
  }
  const mSet = toValueSet(matchList);
  const eSet = toValueSet(excludeList);

  const excludedHits = [...valSet].filter((v) => eSet.has(v)).sort();
  if (excludedHits.length > 0) {
    return {
      matched: false,
      reason: `排除: ${dimensionLabel}=${excludedHits.join(",")}`,
    };
  }

  if (mSet.size > 0) {
    const hasMatch = [...valSet].some((v) => mSet.has(v));
    if (!hasMatch) {
      return {
        matched: false,
        reason: `合致条件外: ${dimensionLabel}`,
      };
    }
  }

  return { matched: true, reason: null };
}

function validMd(m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= (DAYS_IN_MONTH[m] || 31);
}

export function parseDateRanges(spec) {
  if (!spec) return [];
  let rawStr = "";
  if (Array.isArray(spec)) {
    rawStr = spec
      .filter((x) => x !== null && x !== undefined && String(x).trim())
      .join(", ");
  } else if (typeof spec === "string") {
    rawStr = spec;
  } else {
    return [];
  }

  let s = rawStr.normalize("NFKC").trim();
  if (!s) return [];
  for (const dash of ["〜", "～", "−", "ー", "―", "–", "—", "ｰ"]) {
    s = s.split(dash).join("-");
  }
  s = s.split("、").join(",");

  const tokens = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const ranges = [];

  for (const token of tokens) {
    const mSingle = /^(\d{1,2})\/(\d{1,2})$/.exec(token);
    if (mSingle) {
      const m1 = Number(mSingle[1]);
      const d1 = Number(mSingle[2]);
      if (validMd(m1, d1)) {
        ranges.push([[m1, d1], [m1, d1]]);
      }
      continue;
    }
    const mRange = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/.exec(token);
    if (mRange) {
      const m1 = Number(mRange[1]);
      const d1 = Number(mRange[2]);
      const m2 = Number(mRange[3]);
      const d2 = Number(mRange[4]);
      if (validMd(m1, d1) && validMd(m2, d2)) {
        ranges.push([[m1, d1], [m2, d2]]);
      }
    }
  }
  return ranges;
}

export function matchesDateDimension(matchDates, excludeDates, targetDate) {
  if (!targetDate || !String(targetDate).trim()) {
    return { matched: true, reason: null };
  }
  const s = String(targetDate).trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return { matched: true, reason: null };

  const month = Number(m[2]);
  const day = Number(m[3]);
  const md = month * 100 + day;

  const eRanges = parseDateRanges(excludeDates);
  const mRanges = parseDateRanges(matchDates);

  const hit = (ranges) => {
    for (const [start, end] of ranges) {
      const sVal = start[0] * 100 + start[1];
      const eVal = end[0] * 100 + end[1];
      if (sVal <= eVal) {
        if (md >= sVal && md <= eVal) return true;
      } else {
        if (md >= sVal || md <= eVal) return true;
      }
    }
    return false;
  };

  if (eRanges.length > 0 && hit(eRanges)) {
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return { matched: false, reason: `排除: 日付=${mm}/${dd}` };
  }

  if (mRanges.length > 0 && !hit(mRanges)) {
    return { matched: false, reason: "合致条件外: 日付" };
  }

  return { matched: true, reason: null };
}

/**
 * カード（イベントまたは世帯グループ）が訓練条件に適合するか判定する.
 * @param {Record<string, any>} card
 * @param {Record<string, any>} cond
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function isEligible(card, cond = {}) {
  const reasons = [];
  let resolvedHolidays = toValueSet(cond.holiday_type);
  if (resolvedHolidays.size === 0 && cond.date && String(cond.date).trim()) {
    resolvedHolidays = new Set(detectHolidayTypes(cond.date));
  }

  const checks = [
    matchesDimension(card.match_shelters, card.exclude_shelters, cond.shelter, "避難所"),
    matchesDateDimension(card.match_dates, card.exclude_dates, cond.date),
    matchesDimension(card.match_holiday_type, card.exclude_holiday_type, resolvedHolidays, "休日種別"),
    matchesDimension(card.match_time_slots, card.exclude_time_slots, cond.time_slot, "時間帯"),
    matchesDimension(card.match_disaster_types, card.exclude_disaster_types, cond.disaster_type, "災害種類"),
    matchesDimension(card.match_infrastructure, card.exclude_infrastructure, cond.infrastructure, "インフラ状況"),
    matchesDimension(card.match_weather, card.exclude_weather, cond.weather, "天候"),
  ];

  for (const res of checks) {
    if (!res.matched && res.reason) {
      reasons.push(res.reason);
    }
  }

  const phaseFilter = toValueSet(cond.disaster_phase);
  if (phaseFilter.size > 0) {
    const cardPhases = toValueSet(card.disaster_phase);
    if (cardPhases.size > 0) {
      const hasPhase = [...cardPhases].some((p) => phaseFilter.has(p));
      if (!hasPhase) {
        reasons.push("合致条件外: 災害進行度");
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

// ============================================================================
// 3. 並べ順計算・進行度矛盾検出・前提カード順序 (hugdb/ordering.py 準拠)
// ============================================================================

export function parseIdNum(rawId) {
  const s = String(rawId || "").trim();
  const m = /^(?:EV|GRP|M)-(\d+)$/i.exec(s);
  if (m) return Number(m[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return 999999;
}

function compareIdSortKey(aId, bId) {
  const na = parseIdNum(aId);
  const nb = parseIdNum(bId);
  if (na !== nb) return na - nb;
  return String(aId || "").localeCompare(String(bId || ""));
}

export function extractTimingIndex(record) {
  let raw = (record && record.relative_timing) || [];
  if (typeof raw === "string") raw = [raw];
  const indices = [];
  for (const item of raw) {
    const idx = RELATIVE_TIMING_LIST.indexOf(item);
    if (idx !== -1) indices.push(idx);
  }
  if (indices.length === 0) return 2; // 中盤
  return Math.min(...indices);
}

export function extractPhaseIndex(record) {
  let raw = (record && record.disaster_phase) || [];
  if (typeof raw === "string") raw = [raw];
  const indices = [];
  for (const item of raw) {
    const idx = DISASTER_PHASE_LIST.indexOf(item);
    if (idx !== -1) indices.push(idx);
  }
  if (indices.length === 0) return null;
  return Math.min(...indices);
}

export function makeUnitFromEvent(event) {
  const tIdx = extractTimingIndex(event);
  const pIdx = extractPhaseIndex(event);
  const pr =
    typeof event.priority === "number" && !Number.isNaN(event.priority)
      ? event.priority
      : 5;
  const prereq =
    event.prerequisite_card_id && String(event.prerequisite_card_id).trim()
      ? String(event.prerequisite_card_id).trim()
      : null;
  return {
    id: String(event.card_id),
    kind: "event",
    record: event,
    timing_index: tIdx,
    phase_index: pIdx,
    timing_label: RELATIVE_TIMING_LIST[tIdx] || "中盤",
    phase_label: pIdx !== null ? DISASTER_PHASE_LIST[pIdx] : null,
    priority: pr,
    urgency_rank: 1,
    prerequisite_card_id: prereq,
  };
}

export function makeUnitFromGroup(group) {
  const tIdx = extractTimingIndex(group);
  const pIdx = extractPhaseIndex(group);
  const urg = group.urgency_level === "要即時対応" ? 0 : 1;
  return {
    id: String(group.group_id),
    kind: "household",
    record: group,
    timing_index: tIdx,
    phase_index: pIdx,
    timing_label: RELATIVE_TIMING_LIST[tIdx] || "中盤",
    phase_label: pIdx !== null ? DISASTER_PHASE_LIST[pIdx] : null,
    priority: 5,
    urgency_rank: urg,
    prerequisite_card_id: null,
  };
}

export function topologicalSortUnits(seq) {
  if (seq.length <= 1) return [...seq];
  const pos = new Map();
  seq.forEach((u, i) => pos.set(u.id, i));
  const ids = new Set(pos.keys());
  const indeg = new Map();
  const children = new Map();
  for (const u of seq) {
    indeg.set(u.id, 0);
    children.set(u.id, []);
  }
  for (const u of seq) {
    const pre = u.prerequisite_card_id;
    if (pre && ids.has(pre) && pre !== u.id) {
      indeg.set(u.id, (indeg.get(u.id) || 0) + 1);
      children.get(pre).push(u.id);
    }
  }

  const byId = new Map(seq.map((u) => [u.id, u]));
  const ready = [];
  for (const [uid, deg] of indeg.entries()) {
    if (deg === 0) {
      ready.push({ pos: pos.get(uid), uid });
    }
  }
  ready.sort((a, b) => a.pos - b.pos);

  const result = [];
  while (ready.length > 0) {
    const { uid } = ready.shift();
    result.push(byId.get(uid));
    for (const childId of children.get(uid) || []) {
      indeg.set(childId, indeg.get(childId) - 1);
      if (indeg.get(childId) === 0) {
        ready.push({ pos: pos.get(childId), uid: childId });
        ready.sort((a, b) => a.pos - b.pos);
      }
    }
  }

  if (result.length < seq.length) {
    const placed = new Set(result.map((u) => u.id));
    for (const u of seq) {
      if (!placed.has(u.id)) result.push(u);
    }
  }
  return result;
}

export function computeOrderUnits(units, { phaseFirst = false } = {}) {
  if (!units || units.length === 0) return [];

  const bucketMap = new Map();
  for (const u of units) {
    const pk = u.phase_index !== null && u.phase_index !== undefined ? u.phase_index : 99;
    const k1 = phaseFirst ? pk : u.timing_index;
    const k2 = phaseFirst ? u.timing_index : pk;
    const keyStr = `${String(k1).padStart(3, "0")}_${String(k2).padStart(3, "0")}`;
    if (!bucketMap.has(keyStr)) bucketMap.set(keyStr, []);
    bucketMap.get(keyStr).push(u);
  }

  const sortedKeys = [...bucketMap.keys()].sort();
  const out = [];

  for (const k of sortedKeys) {
    const b = bucketMap.get(k);
    const zero = b
      .filter((u) => u.kind === "event" && u.priority === 0)
      .sort((a, bUnit) => compareIdSortKey(a.id, bUnit.id));
    const events = b
      .filter((u) => u.kind === "event" && u.priority !== 0)
      .sort((a, bUnit) => {
        if (a.priority !== bUnit.priority) return a.priority - bUnit.priority;
        return compareIdSortKey(a.id, bUnit.id);
      });
    const households = b
      .filter((u) => u.kind === "household")
      .sort((a, bUnit) => {
        if (a.urgency_rank !== bUnit.urgency_rank) return a.urgency_rank - bUnit.urgency_rank;
        return compareIdSortKey(a.id, bUnit.id);
      });

    const merged = [
      ...events.map((u, i) => ({ ratio: (i + 0.5) / events.length, kindOrder: 0, u })),
      ...households.map((u, j) => ({ ratio: (j + 0.5) / households.length, kindOrder: 1, u })),
    ].sort((a, bItem) => {
      if (a.ratio !== bItem.ratio) return a.ratio - bItem.ratio;
      return a.kindOrder - bItem.kindOrder;
    });

    out.push(...zero);
    for (const m of merged) {
      out.push(m.u);
    }
  }

  return topologicalSortUnits(out);
}

export function applyResolutionsToUnits(units, resolutions) {
  const seq = [...units];
  if (!resolutions || seq.length <= 1) return seq;
  const moveIds = seq
    .filter((u) => resolutions[u.id] === "move" && u.phase_index !== null)
    .map((u) => u.id);
  if (moveIds.length === 0) return seq;

  for (const cid of moveIds) {
    const idx = seq.findIndex((u) => u.id === cid);
    if (idx === -1) continue;
    const culprit = seq[idx];
    if (culprit.phase_index === null) continue;
    let lastEarlierIdx = null;
    for (let j = idx + 1; j < seq.length; j++) {
      const other = seq[j];
      if (other.phase_index !== null && other.phase_index < culprit.phase_index) {
        lastEarlierIdx = j;
      }
    }
    if (lastEarlierIdx !== null) {
      seq.splice(idx, 1);
      seq.splice(lastEarlierIdx, 0, culprit);
    }
  }
  return topologicalSortUnits(seq);
}

export function applyManualOrderToUnits(computed, manualIds) {
  const seq = [...computed];
  if (!Array.isArray(manualIds) || manualIds.length === 0 || seq.length <= 1) {
    return seq;
  }
  const byId = new Map(seq.map((u) => [u.id, u]));
  const seen = new Set();
  const validManualIds = [];
  for (const mid of manualIds) {
    if (byId.has(mid) && !seen.has(mid)) {
      seen.add(mid);
      validManualIds.push(mid);
    }
  }
  if (validManualIds.length === 0) return seq;

  let mIdx = 0;
  return seq.map((u) => {
    if (seen.has(u.id)) {
      return byId.get(validManualIds[mIdx++]);
    }
    return u;
  });
}

// ============================================================================
// 4. 条件設定に基づく初期デッキ提案 (hugdb/deck.py 準拠)
// ============================================================================

function applyEventLimit(eligibleEvents, maxEvents) {
  const warnings = [];
  const zeroEvents = eligibleEvents
    .filter((e) => e.priority === 0)
    .sort((a, b) => compareIdSortKey(a.card_id, b.card_id));

  if (zeroEvents.length > maxEvents) {
    warnings.push(
      `priority=0 の確定イベント（${zeroEvents.length}件）が最大イベント数（${maxEvents}件）を超えているため、priority=0 の全件を採用しました`
    );
    const selectedIds = new Set(zeroEvents.map((e) => e.card_id));
    const dropped = eligibleEvents.filter((e) => !selectedIds.has(e.card_id));
    return { selected: [...zeroEvents], dropped, warnings };
  }

  const selected = [...zeroEvents];
  const selectedIds = new Set(selected.map((e) => e.card_id));
  const byId = new Map(eligibleEvents.map((e) => [e.card_id, e]));

  for (const ze of [...selected]) {
    let currPre = ze.prerequisite_card_id;
    while (currPre && byId.has(currPre) && !selectedIds.has(currPre)) {
      const preEv = byId.get(currPre);
      selected.push(preEv);
      selectedIds.add(currPre);
      currPre = preEv.prerequisite_card_id;
    }
  }

  const candidates = eligibleEvents
    .filter((e) => !selectedIds.has(e.card_id))
    .sort((a, b) => {
      const pa = typeof a.priority === "number" ? a.priority : 5;
      const pb = typeof b.priority === "number" ? b.priority : 5;
      if (pa !== pb) return pa - pb;
      const ta = extractTimingIndex(a);
      const tb = extractTimingIndex(b);
      if (ta !== tb) return ta - tb;
      const pha = extractPhaseIndex(a) ?? 99;
      const phb = extractPhaseIndex(b) ?? 99;
      if (pha !== phb) return pha - phb;
      return compareIdSortKey(a.card_id, b.card_id);
    });

  while (selected.length < maxEvents && candidates.length > 0) {
    let progressed = false;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const pre = cand.prerequisite_card_id;
      if (!pre || selectedIds.has(pre)) {
        selected.push(cand);
        selectedIds.add(cand.card_id);
        candidates.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }

  const dropped = eligibleEvents.filter((e) => !selectedIds.has(e.card_id));
  return { selected, dropped, warnings };
}

function applyHouseholdLimit(eligibleGroups, maxHouseholds) {
  const sorted = [...eligibleGroups].sort((a, b) => {
    const ua = a.urgency_level === "要即時対応" ? 0 : 1;
    const ub = b.urgency_level === "要即時対応" ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const ta = extractTimingIndex(a);
    const tb = extractTimingIndex(b);
    if (ta !== tb) return ta - tb;
    const pha = extractPhaseIndex(a) ?? 99;
    const phb = extractPhaseIndex(b) ?? 99;
    if (pha !== phb) return pha - phb;
    return compareIdSortKey(a.group_id, b.group_id);
  });
  return {
    selected: sorted.slice(0, maxHouseholds),
    dropped: sorted.slice(maxHouseholds),
  };
}

/**
 * データベースと訓練条件から初期提案デッキを構築する.
 * @param {Record<string, any>} db - cards_db.json のデータ
 * @param {Record<string, any>} conditions - 訓練条件
 * @param {{ phaseFirst?: boolean, resolutions?: Record<string, string>, manualOrder?: string[], excludedIds?: string[] }} [options]
 */
export function buildInitialDeck(db, conditions = {}, options = {}) {
  const events = db.cards_event || [];
  const groups = db.evacuee_groups || [];
  const members = db.group_members || [];
  const phaseFirst = Boolean(options.phaseFirst);
  const resolutions = options.resolutions || {};
  const manualOrder = options.manualOrder || null;

  const manualExcludedSet = new Set();
  for (const src of [conditions.excluded_ids, options.excludedIds]) {
    if (Array.isArray(src)) {
      src.forEach((x) => {
        if (x && String(x).trim()) manualExcludedSet.add(String(x).trim());
      });
    }
  }
  for (const m of members) {
    if (m.member_id && m.group_id && manualExcludedSet.has(m.member_id)) {
      manualExcludedSet.add(m.group_id);
    }
  }

  let eligibleEvents = [];
  const exclusionReasonsMap = new Map(); // id -> { reasons: string[], manual: boolean, kind: string }

  for (const ev of events) {
    const cid = ev.card_id;
    if (manualExcludedSet.has(cid)) {
      exclusionReasonsMap.set(cid, {
        reasons: ["手動除外"],
        manual: true,
        category: "manual",
      });
      continue;
    }
    const { ok, reasons } = isEligible(ev, conditions);
    if (ok) {
      eligibleEvents.push(ev);
    } else {
      exclusionReasonsMap.set(cid, {
        reasons,
        manual: false,
        category: "condition",
      });
    }
  }

  let eligibleGroups = [];
  for (const grp of groups) {
    const gid = grp.group_id;
    if (manualExcludedSet.has(gid)) {
      exclusionReasonsMap.set(gid, {
        reasons: ["手動除外"],
        manual: true,
        category: "manual",
      });
      continue;
    }
    const { ok, reasons } = isEligible(grp, conditions);
    if (ok) {
      eligibleGroups.push(grp);
    } else {
      exclusionReasonsMap.set(gid, {
        reasons,
        manual: false,
        category: "condition",
      });
    }
  }

  // 前提カード連鎖除外
  let changedPrereq = true;
  while (changedPrereq) {
    changedPrereq = false;
    const currentEvIds = new Set(eligibleEvents.map((e) => e.card_id));
    const stillEligible = [];
    for (const ev of eligibleEvents) {
      const pre = ev.prerequisite_card_id && String(ev.prerequisite_card_id).trim();
      if (pre && !currentEvIds.has(pre)) {
        exclusionReasonsMap.set(ev.card_id, {
          reasons: [`前提カード ${pre} がデッキにない`],
          manual: false,
          category: "prereq",
        });
        changedPrereq = true;
      } else {
        stillEligible.push(ev);
      }
    }
    eligibleEvents = stillEligible;
  }

  const warnings = [];
  if (
    conditions.max_events !== null &&
    conditions.max_events !== undefined &&
    String(conditions.max_events).trim() !== ""
  ) {
    const maxEv = Number(conditions.max_events);
    if (!Number.isNaN(maxEv) && maxEv >= 0) {
      const res = applyEventLimit(eligibleEvents, maxEv);
      eligibleEvents = res.selected;
      warnings.push(...res.warnings);
      for (const dev of res.dropped) {
        exclusionReasonsMap.set(dev.card_id, {
          reasons: ["条件合致（イベント上限数により選外）"],
          manual: false,
          category: "limit",
        });
      }
    }
  }

  if (
    conditions.max_households !== null &&
    conditions.max_households !== undefined &&
    String(conditions.max_households).trim() !== ""
  ) {
    const maxHh = Number(conditions.max_households);
    if (!Number.isNaN(maxHh) && maxHh >= 0) {
      const res = applyHouseholdLimit(eligibleGroups, maxHh);
      eligibleGroups = res.selected;
      for (const dgrp of res.dropped) {
        exclusionReasonsMap.set(dgrp.group_id, {
          reasons: ["条件合致（世帯上限数により選外）"],
          manual: false,
          category: "limit",
        });
      }
    }
  }

  // 単位構築と順序計算
  const rawUnits = [
    ...eligibleEvents.map((e) => makeUnitFromEvent(e)),
    ...eligibleGroups.map((g) => makeUnitFromGroup(g)),
  ];
  let orderedUnits = computeOrderUnits(rawUnits, { phaseFirst });
  if (!phaseFirst && resolutions && Object.keys(resolutions).length > 0) {
    orderedUnits = applyResolutionsToUnits(orderedUnits, resolutions);
  }
  if (manualOrder && manualOrder.length > 0) {
    orderedUnits = applyManualOrderToUnits(orderedUnits, manualOrder);
  }

  // メンバーをグループごとに整理（人物 → ペット）
  const membersByGroup = new Map();
  for (const g of groups) {
    membersByGroup.set(g.group_id, []);
  }
  for (const m of members) {
    if (membersByGroup.has(m.group_id)) {
      membersByGroup.get(m.group_id).push(m);
    }
  }
  for (const mList of membersByGroup.values()) {
    mList.sort((a, b) => {
      const ka = a.data_type === "人物" ? 0 : 1;
      const kb = b.data_type === "人物" ? 0 : 1;
      return ka - kb;
    });
  }

  // カード配列へ展開
  const rawCardEntries = [];
  for (const u of orderedUnits) {
    if (u.kind === "event") {
      rawCardEntries.push({
        original_id: u.id,
        kind: "event",
        unit_id: u.id,
        data: structuredClone(u.record),
        group: null,
      });
    } else {
      const mList = membersByGroup.get(u.id) || [];
      for (const m of mList) {
        rawCardEntries.push({
          original_id: m.member_id,
          kind: m.data_type === "ペット" ? "pet" : "person",
          unit_id: u.id,
          group_id: u.id,
          group_name: u.record.group_name || u.id,
          data: structuredClone(m),
          group: structuredClone(u.record),
        });
      }
    }
  }

  return {
    cardEntries: renumberDeckCards(rawCardEntries, db),
    exclusionReasonsMap,
    warnings,
  };
}

/**
 * 任意のカード配列に対して 1 からの連番 (card_number) と世帯連番 (new_group_id) を付与する.
 * @param {Array<Record<string, any>>} entries
 * @param {Record<string, any>} db
 * @returns {Array<Record<string, any>>}
 */
export function renumberDeckCards(entries, db) {
  const groupCounterMap = new Map();
  let grpSeq = 0;

  return (entries || []).map((entry, idx) => {
    const seqNum = idx + 1;
    const isEvent = entry.kind === "event";
    let newGroupId = null;
    const gid = entry.group_id || (entry.group && entry.group.group_id) || null;
    if (!isEvent && gid) {
      if (!groupCounterMap.has(gid)) {
        grpSeq += 1;
        groupCounterMap.set(gid, `GRP-${String(grpSeq).padStart(3, "0")}`);
      }
      newGroupId = groupCounterMap.get(gid);
    }

    const rec = entry.data || {};
    const grp = entry.group || null;
    const timingIdx = extractTimingIndex(isEvent ? rec : grp || rec);
    const phaseIdx = extractPhaseIndex(isEvent ? rec : grp || rec);

    return {
      card_number: seqNum,
      kind: entry.kind,
      unit_id: isEvent ? entry.original_id : gid || entry.original_id,
      original_id: String(entry.original_id),
      new_id: String(seqNum),
      title: isEvent
        ? String(rec.event_name || entry.original_id)
        : String(rec.name || entry.original_id),
      data: rec,
      group_id: gid,
      new_group_id: newGroupId,
      group_name: grp ? String(grp.group_name || gid || "") : null,
      group: grp,
      timing_index: timingIdx,
      phase_index: phaseIdx,
      timing_label: RELATIVE_TIMING_LIST[timingIdx] || "中盤",
      phase_label: phaseIdx !== null ? DISASTER_PHASE_LIST[phaseIdx] : null,
    };
  });
}

/**
 * 現在のデッキカード配列から統計・前提カード違反・進行度逆転を検査する.
 * @param {Array<Record<string, any>>} deckCards
 */
export function analyzeDeckState(deckCards) {
  const cards = deckCards || [];
  let events = 0;
  let persons = 0;
  let pets = 0;
  const householdIds = new Set();

  const cardPosByOrigId = new Map();
  cards.forEach((c, idx) => {
    cardPosByOrigId.set(c.original_id, idx);
    if (c.kind === "event") {
      events++;
    } else if (c.kind === "pet") {
      pets++;
      if (c.group_id) householdIds.add(c.group_id);
    } else {
      persons++;
      if (c.group_id) householdIds.add(c.group_id);
    }
  });

  // 前提カード制約の検査
  const prereqIssues = new Map(); // original_id -> { prereqId, type: 'missing' | 'order', message }
  cards.forEach((c, idx) => {
    if (c.kind === "event" && c.data && c.data.prerequisite_card_id) {
      const preId = String(c.data.prerequisite_card_id).trim();
      if (!preId) return;
      if (!cardPosByOrigId.has(preId)) {
        prereqIssues.set(c.original_id, {
          prereqId: preId,
          type: "missing",
          message: `前提カード ${preId} がデッキに含まれていません`,
        });
      } else if (cardPosByOrigId.get(preId) > idx) {
        const preCard = cards[cardPosByOrigId.get(preId)];
        prereqIssues.set(c.original_id, {
          prereqId: preId,
          type: "order",
          message: `前提カード ${preId} (No.${preCard.card_number}) より前に配置されています`,
        });
      }
    }
  });

  // 進行度逆転（後ろに自分より進行度が早いカードがある）の検出
  const phaseConflicts = new Map(); // original_id -> affected card_numbers
  for (let i = 0; i < cards.length; i++) {
    const ca = cards[i];
    if (ca.phase_index === null || ca.phase_index === undefined) continue;
    const affected = [];
    for (let j = i + 1; j < cards.length; j++) {
      const cb = cards[j];
      if (
        cb.phase_index !== null &&
        cb.phase_index !== undefined &&
        ca.phase_index > cb.phase_index
      ) {
        affected.push(`No.${cb.card_number}(${cb.phase_label})`);
      }
    }
    if (affected.length > 0) {
      phaseConflicts.set(ca.original_id, affected);
    }
  }

  return {
    stats: {
      total_cards: cards.length,
      events,
      households: householdIds.size,
      persons,
      pets,
    },
    prereqIssues,
    phaseConflicts,
  };
}

/**
 * データベースの全カードをフラットなカードエントリ配列として取得する.
 * @param {Record<string, any>} db
 */
export function buildAllDatabaseCardEntries(db) {
  const events = db.cards_event || [];
  const groups = db.evacuee_groups || [];
  const members = db.group_members || [];
  const groupById = new Map(groups.map((g) => [g.group_id, g]));

  // グループごとのメンバー数
  const groupMemberCounts = new Map();
  for (const m of members) {
    groupMemberCounts.set(m.group_id, (groupMemberCounts.get(m.group_id) || 0) + 1);
  }

  const out = [];
  for (const ev of events) {
    const tIdx = extractTimingIndex(ev);
    const pIdx = extractPhaseIndex(ev);
    out.push({
      original_id: String(ev.card_id),
      kind: "event",
      unit_id: String(ev.card_id),
      group_id: null,
      group_name: null,
      group_total_cards: 1,
      title: String(ev.event_name || ev.card_id),
      data: ev,
      group: null,
      timing_index: tIdx,
      phase_index: pIdx,
      timing_label: RELATIVE_TIMING_LIST[tIdx] || "中盤",
      phase_label: pIdx !== null ? DISASTER_PHASE_LIST[pIdx] : null,
    });
  }

  for (const m of members) {
    const grp = groupById.get(m.group_id) || {};
    const tIdx = extractTimingIndex(grp);
    const pIdx = extractPhaseIndex(grp);
    out.push({
      original_id: String(m.member_id),
      kind: m.data_type === "ペット" ? "pet" : "person",
      unit_id: String(m.group_id),
      group_id: String(m.group_id),
      group_name: String(grp.group_name || m.group_id),
      group_total_cards: groupMemberCounts.get(m.group_id) || 1,
      title: String(m.name || m.member_id),
      data: m,
      group: grp,
      timing_index: tIdx,
      phase_index: pIdx,
      timing_label: RELATIVE_TIMING_LIST[tIdx] || "中盤",
      phase_label: pIdx !== null ? DISASTER_PHASE_LIST[pIdx] : null,
    });
  }

  return out;
}

// ============================================================================
// 5. カード台帳 (11列 CSV / JSON) エクスポート & インポート復元
// ============================================================================

export function deckCardToCsvRow(deckCard) {
  const numStr = String(deckCard.card_number);
  const rec = deckCard.data || {};
  const grp = deckCard.group || {};

  if (deckCard.kind === "event") {
    const categories = Array.isArray(rec.category)
      ? rec.category.filter(Boolean).map(String)
      : [];
    return [
      numStr,
      "イベント",
      String(rec.event_name || ""),
      "-",
      "-",
      "-",
      String(rec.source || ""),
      categories.join(" "),
      String(rec.scene_description || ""),
      String(rec.content || ""),
      String(rec.training_point || ""),
    ];
  }

  const isPet = deckCard.kind === "pet" || rec.data_type === "ペット";
  const origin = String(grp.evacuation_origin || rec.evacuation_origin || "");
  const ageStr =
    rec.age === null || rec.age === undefined || rec.age === ""
      ? ""
      : String(rec.age);
  const gender = String(rec.gender || "");
  const appearance = String(rec.appearance || "");
  const trainingPoint = String(rec.training_point || "");

  if (isPet) {
    const rel = String(rec.relationship || "ペット");
    const pVulns = (rec.pet_vulnerabilities || []).filter(Boolean).map(String);
    const pHealth = (rec.pet_health_condition || [])
      .filter((x) => x && String(x) !== "良好")
      .map(String);
    const pSkills = (rec.pet_skills || []).filter(Boolean).map(String);
    const flags = [...pVulns, ...pHealth, ...pSkills].join(" ");
    return [
      numStr,
      "ペット",
      String(rec.name || ""),
      origin,
      ageStr,
      gender,
      rel,
      flags,
      appearance,
      appearance,
      trainingPoint,
    ];
  }

  const rel = String(rec.relationship || "");
  const vulns = (rec.vulnerabilities || []).filter(Boolean).map(String);
  const health = (rec.health_condition || [])
    .filter((x) => x && String(x) !== "良好")
    .map(String);
  const skills = (rec.skills || []).filter(Boolean).map(String);
  const flags = [...vulns, ...health, ...skills].join(" ");
  const statement = String(rec.statement || "");

  return [
    numStr,
    "避難者",
    String(rec.name || ""),
    origin,
    ageStr,
    gender,
    rel,
    flags,
    appearance,
    statement,
    trainingPoint,
  ];
}

function escapeCsvCell(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 現在のデッキを 11列 カード台帳 CSV Blob (UTF-8 BOM + CRLF) に変換する.
 * @param {Array<Record<string, any>>} deckCards
 * @returns {Blob}
 */
export function exportDeckToCardCsvBlob(deckCards) {
  const lines = [CARD_CSV_HEADERS.map(escapeCsvCell).join(",")];
  for (const dc of deckCards || []) {
    const row = deckCardToCsvRow(dc);
    lines.push(row.map(escapeCsvCell).join(","));
  }
  const csvContent = "\ufeff" + lines.join("\r\n") + "\r\n";
  return new Blob([csvContent], { type: "text/csv;charset=utf-8" });
}

/**
 * 現在のデッキを JSON Blob に変換する (ローカル管理ツール互換 + Webデッキ状態メタ情報付き).
 * @param {Array<Record<string, any>>} deckCards
 * @param {Record<string, any>} conditions
 * @returns {Blob}
 */
export function exportDeckToJsonBlob(deckCards, conditions = {}) {
  const exportEvents = [];
  const exportGroups = [];
  const exportMembers = [];
  const seenGroups = new Map();
  const eventIdMap = new Map();

  for (const dc of deckCards || []) {
    if (dc.kind === "event") {
      eventIdMap.set(dc.original_id, String(dc.card_number));
    }
  }

  for (const dc of deckCards || []) {
    if (dc.kind === "event") {
      const evCopy = structuredClone(dc.data || {});
      evCopy.card_id = String(dc.card_number);
      const oldPre = evCopy.prerequisite_card_id;
      evCopy.prerequisite_card_id =
        oldPre && eventIdMap.has(String(oldPre))
          ? eventIdMap.get(String(oldPre))
          : null;
      exportEvents.push(evCopy);
    } else {
      const gid = dc.group_id || "GRP-CUSTOM";
      const newGid = dc.new_group_id || "GRP-001";
      if (!seenGroups.has(gid) && dc.group) {
        const grpCopy = structuredClone(dc.group);
        grpCopy.group_id = newGid;
        seenGroups.set(gid, grpCopy);
        exportGroups.push(grpCopy);
      }
      const memCopy = structuredClone(dc.data || {});
      memCopy.member_id = String(dc.card_number);
      memCopy.group_id = newGid;
      exportMembers.push(memCopy);
    }
  }

  // グループ内の人数・ペット数を再集計
  for (const grp of exportGroups) {
    const gMems = exportMembers.filter((m) => m.group_id === grp.group_id);
    grp.member_count = gMems.filter((m) => m.data_type === "人物").length;
    grp.pet_count = gMems.filter((m) => m.data_type === "ペット").length;
  }

  const originOverrides = {};
  for (const dc of deckCards || []) {
    if (dc.group_id && dc.group && dc.group.evacuation_origin) {
      originOverrides[dc.group_id] = dc.group.evacuation_origin;
    }
  }

  const exportConditions = structuredClone(conditions || {});
  if (Object.keys(originOverrides).length > 0) {
    exportConditions.origin_overrides = originOverrides;
  }

  const payload = {
    cards_event: exportEvents,
    evacuee_groups: exportGroups,
    group_members: exportMembers,
    _web_deck_meta: {
      version: "6.2",
      exported_at: new Date().toISOString(),
      conditions: exportConditions,
      origin_overrides: originOverrides,
      card_sequence: (deckCards || []).map((dc) => ({
        card_number: dc.card_number,
        original_id: dc.original_id,
        kind: dc.kind,
        group_id: dc.group_id || null,
        evacuation_origin:
          (dc.group && dc.group.evacuation_origin) ||
          (dc.data && dc.data.evacuation_origin) ||
          null,
      })),
    },
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  return new Blob([jsonStr], { type: "application/json;charset=utf-8" });
}

/**
 * RFC-4180 準拠の CSV パーサ（BOM・改行を含むクォートセル・CRLF/LF 対応）.
 * @param {string} rawText
 * @returns {string[][]}
 */
export function parseCsvText(rawText) {
  const text = String(rawText || "").replace(/^\ufeff/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\r" && next === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function normStr(s) {
  return String(s || "").trim().replace(/\r\n/g, "\n");
}

/**
 * カード台帳 CSV または デッキ JSON テキストからデッキのカード配列を復元する.
 * データベース (db) のカードと照合し、original_id・世帯情報・イラスト画像を紐付ける.
 * @param {string} fileText
 * @param {string} filename
 * @param {Record<string, any>} db
 * @returns {{ deckCards: Array<Record<string, any>>, matchedCount: number, customCount: number, restoredConditions?: Record<string, any> | null }}
 */
export function importDeckFromLedgerFile(fileText, filename, db) {
  const trimmed = String(fileText || "").replace(/^\ufeff/, "").trim();
  if (!trimmed) {
    throw new Error("インポートするファイルが空です");
  }

  if (filename.toLowerCase().endsWith(".json") || trimmed.startsWith("{")) {
    return importDeckFromJsonText(trimmed, db);
  }
  return importDeckFromCsvText(trimmed, db);
}

export function importDeckFromCsvText(csvText, db) {
  const rows = parseCsvText(csvText);
  if (rows.length === 0) {
    throw new Error("CSVファイルにデータがありません");
  }

  // 1行目がヘッダーかどうかを判定
  const firstRow = rows[0].map((c) => c.trim());
  const hasHeader =
    firstRow.includes("カード番号") ||
    firstRow.includes("種別") ||
    firstRow.includes("氏名/イベント名") ||
    firstRow[0] === "No." ||
    firstRow[0] === "No";

  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (dataRows.length === 0) {
    throw new Error("CSVファイルにカード行が含まれていません");
  }

  const allDbEntries = buildAllDatabaseCardEntries(db);
  const dbByOrigId = new Map(allDbEntries.map((e) => [e.original_id, e]));

  // DB全カードの標準CSV行を生成して高速逆引きインデックスを作る
  const dbEventEntries = allDbEntries.filter((e) => e.kind === "event");
  const dbMemberEntries = allDbEntries.filter((e) => e.kind !== "event");

  const usedOrigIds = new Set();
  const entries = [];
  let matchedCount = 0;
  let customCount = 0;

  dataRows.forEach((cols, idx) => {
    if (cols.every((c) => !String(c).trim())) return;

    const colType = normStr(cols[1]);
    const colName = normStr(cols[2]);
    const colOrigin = normStr(cols[3]);
    const colAge = normStr(cols[4]);
    const colGender = normStr(cols[5]);
    const colAttr = normStr(cols[6]);
    const colFlags = normStr(cols[7]);
    const colAppearance = normStr(cols[8]);
    const colDialogue = normStr(cols[9]);
    const colPoints = normStr(cols[10]);
    const colExplicitId = cols[11] ? normStr(cols[11]) : "";

    let matchedEntry = null;

    // 1. 明示的ID列があれば最優先で照合
    if (colExplicitId && dbByOrigId.has(colExplicitId)) {
      matchedEntry = dbByOrigId.get(colExplicitId);
    }

    // 2. イベントカードの照合
    if (!matchedEntry && colType === "イベント") {
      // 完全一致 (イベント名 + セリフ/状況 + 容姿/描写)
      matchedEntry =
        dbEventEntries.find(
          (e) =>
            !usedOrigIds.has(e.original_id) &&
            normStr(e.data.event_name) === colName &&
            normStr(e.data.content) === colDialogue &&
            normStr(e.data.scene_description) === colAppearance
        ) ||
        // イベント名 + セリフ/状況
        dbEventEntries.find(
          (e) =>
            !usedOrigIds.has(e.original_id) &&
            normStr(e.data.event_name) === colName &&
            normStr(e.data.content) === colDialogue
        ) ||
        // イベント名のみ一致
        dbEventEntries.find(
          (e) =>
            !usedOrigIds.has(e.original_id) &&
            normStr(e.data.event_name) === colName
        ) ||
        // 重複許可フォールバック
        dbEventEntries.find(
          (e) =>
            normStr(e.data.event_name) === colName &&
            normStr(e.data.content) === colDialogue
        );
    }

    // 3. 避難者・ペットカードの照合
    if (!matchedEntry && colType !== "イベント") {
      const targetIsPet = colType === "ペット";
      const candidates = dbMemberEntries.filter(
        (e) => (e.kind === "pet") === targetIsPet
      );

      matchedEntry =
        // 完全一致 (容姿 + セリフ + 判定ポイント + 避難元)
        candidates.find((e) => {
          if (usedOrigIds.has(e.original_id)) return false;
          const row = deckCardToCsvRow({ ...e, card_number: 1 });
          return (
            normStr(row[3]) === colOrigin &&
            normStr(row[4]) === colAge &&
            normStr(row[5]) === colGender &&
            normStr(row[8]) === colAppearance &&
            normStr(row[9]) === colDialogue
          );
        }) ||
        // 容姿 + セリフの一致
        candidates.find((e) => {
          if (usedOrigIds.has(e.original_id)) return false;
          const row = deckCardToCsvRow({ ...e, card_number: 1 });
          return (
            normStr(row[8]) === colAppearance && normStr(row[9]) === colDialogue
          );
        }) ||
        // 氏名 + 避難元 + 年齢の一致
        candidates.find((e) => {
          if (usedOrigIds.has(e.original_id)) return false;
          const row = deckCardToCsvRow({ ...e, card_number: 1 });
          return (
            normStr(row[2]) === colName &&
            normStr(row[3]) === colOrigin &&
            normStr(row[4]) === colAge
          );
        });
    }

    if (matchedEntry) {
      usedOrigIds.add(matchedEntry.original_id);
      matchedCount++;
      const clonedData = structuredClone(matchedEntry.data);
      const clonedGroup = matchedEntry.group
        ? structuredClone(matchedEntry.group)
        : null;

      // CSV側でテキストが微調整されていた場合は反映する
      if (matchedEntry.kind === "event") {
        if (colName) clonedData.event_name = colName;
        if (colAttr && colAttr !== "-") clonedData.source = colAttr;
        if (colAppearance && colAppearance !== "-")
          clonedData.scene_description = colAppearance;
        if (colDialogue) clonedData.content = colDialogue;
        if (colPoints) clonedData.training_point = colPoints;
      } else {
        if (colName) clonedData.name = colName;
        if (colAge && colAge !== "-") {
          const nAge = Number(colAge);
          clonedData.age = Number.isNaN(nAge) ? colAge : nAge;
        }
        if (colGender && colGender !== "-") clonedData.gender = colGender;
        if (colAttr && colAttr !== "-") clonedData.relationship = colAttr;
        if (colAppearance) clonedData.appearance = colAppearance;
        if (matchedEntry.kind !== "pet" && colDialogue) {
          clonedData.statement = colDialogue;
        }
        if (colPoints) clonedData.training_point = colPoints;
        if (colOrigin && colOrigin !== "-") {
          if (clonedGroup) clonedGroup.evacuation_origin = colOrigin;
          clonedData.evacuation_origin = colOrigin;
        }
      }

      entries.push({
        original_id: matchedEntry.original_id,
        kind: matchedEntry.kind,
        unit_id: matchedEntry.unit_id,
        group_id: matchedEntry.group_id,
        group_name: matchedEntry.group_name,
        data: clonedData,
        group: clonedGroup,
      });
    } else {
      // DBに存在しない新規カスタム行も欠落させず復元
      customCount++;
      const isEv = colType === "イベント";
      const isPet = colType === "ペット";
      const customId = isEv ? `EV-CSV-${idx + 1}` : `M-CSV-${idx + 1}`;
      const flagArr = colFlags ? colFlags.split(/\s+/).filter(Boolean) : [];

      if (isEv) {
        entries.push({
          original_id: customId,
          kind: "event",
          unit_id: customId,
          group_id: null,
          group_name: null,
          data: {
            card_id: customId,
            event_name: colName || `カスタムイベント ${idx + 1}`,
            category: flagArr,
            source: colAttr === "-" ? "" : colAttr,
            scene_description: colAppearance === "-" ? "" : colAppearance,
            content: colDialogue,
            training_point: colPoints,
            priority: 5,
            relative_timing: ["中盤"],
            disaster_phase: [],
          },
          group: null,
        });
      } else {
        const customGrpId = `GRP-CSV-${idx + 1}`;
        const grpObj = {
          group_id: customGrpId,
          group_name: colName ? `${colName.split(/\s+/)[0]}世帯` : customGrpId,
          evacuation_origin: colOrigin === "-" ? "" : colOrigin,
          urgency_level: "通常",
          relative_timing: ["中盤"],
          disaster_phase: [],
        };
        entries.push({
          original_id: customId,
          kind: isPet ? "pet" : "person",
          unit_id: customGrpId,
          group_id: customGrpId,
          group_name: grpObj.group_name,
          data: {
            member_id: customId,
            group_id: customGrpId,
            data_type: isPet ? "ペット" : "人物",
            name: colName,
            age: colAge && colAge !== "-" ? Number(colAge) || colAge : null,
            gender: colGender === "-" ? "" : colGender,
            relationship: colAttr === "-" ? (isPet ? "ペット" : "") : colAttr,
            vulnerabilities: isPet ? [] : flagArr,
            pet_vulnerabilities: isPet ? flagArr : [],
            appearance: colAppearance,
            statement: isPet ? "" : colDialogue,
            training_point: colPoints,
          },
          group: grpObj,
        });
      }
    }
  });

  if (entries.length === 0) {
    throw new Error("有効なカード行を読み込めませんでした");
  }

  return {
    deckCards: renumberDeckCards(entries, db),
    matchedCount,
    customCount,
    restoredConditions: null,
  };
}

export function importDeckFromJsonText(jsonText, db) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`JSONの解析に失敗しました: ${err.message}`);
  }

  const allDbEntries = buildAllDatabaseCardEntries(db);
  const dbByOrigId = new Map(allDbEntries.map((e) => [e.original_id, e]));

  // 避難元オーバーライドの抽出
  const originOverrides =
    parsed._web_deck_meta?.origin_overrides ||
    parsed._web_deck_meta?.conditions?.origin_overrides ||
    parsed._web_deck_meta?.conditions?.originOverrides ||
    {};
  if (Object.keys(originOverrides).length === 0 && Array.isArray(parsed.evacuee_groups)) {
    for (const g of parsed.evacuee_groups) {
      if (g.group_id && g.evacuation_origin) {
        originOverrides[String(g.group_id)] = g.evacuation_origin;
      }
    }
  }

  // 1. _web_deck_meta.card_sequence がある場合は完全復元
  if (
    parsed._web_deck_meta &&
    Array.isArray(parsed._web_deck_meta.card_sequence) &&
    parsed._web_deck_meta.card_sequence.length > 0
  ) {
    const entries = [];
    let matchedCount = 0;
    let customCount = 0;
    for (const item of parsed._web_deck_meta.card_sequence) {
      const dbEntry = dbByOrigId.get(String(item.original_id));
      if (dbEntry) {
        matchedCount++;
        const grp = dbEntry.group ? structuredClone(dbEntry.group) : null;
        const d = structuredClone(dbEntry.data);
        const overrideOrigin =
          item.evacuation_origin ||
          (dbEntry.group_id && originOverrides[String(dbEntry.group_id)]);
        if (overrideOrigin) {
          if (grp) grp.evacuation_origin = overrideOrigin;
          if (d) d.evacuation_origin = overrideOrigin;
        }
        entries.push({
          original_id: dbEntry.original_id,
          kind: dbEntry.kind,
          unit_id: dbEntry.unit_id,
          group_id: dbEntry.group_id,
          group_name: dbEntry.group_name,
          data: d,
          group: grp,
        });
      }
    }
    if (entries.length > 0) {
      const restoredConds = structuredClone(parsed._web_deck_meta.conditions || {});
      restoredConds.origin_overrides = originOverrides;
      return {
        deckCards: renumberDeckCards(entries, db),
        matchedCount,
        customCount,
        restoredConditions: restoredConds,
      };
    }
  }

  // 2. 標準の cards_event / evacuee_groups / group_members からの復元
  const rawEvents = Array.isArray(parsed.cards_event) ? parsed.cards_event : [];
  const rawGroups = Array.isArray(parsed.evacuee_groups) ? parsed.evacuee_groups : [];
  const rawMembers = Array.isArray(parsed.group_members) ? parsed.group_members : [];

  if (rawEvents.length === 0 && rawMembers.length === 0) {
    throw new Error("JSON内にカードデータ (cards_event / group_members) が含まれていません");
  }

  const grpById = new Map(rawGroups.map((g) => [String(g.group_id), g]));
  const combined = [];

  for (const ev of rawEvents) {
    const seqNum = parseIdNum(ev.card_id);
    combined.push({ seqNum, type: "event", item: ev });
  }
  for (const mem of rawMembers) {
    const seqNum = parseIdNum(mem.member_id);
    combined.push({
      seqNum,
      type: "member",
      item: mem,
      group: grpById.get(String(mem.group_id)) || null,
    });
  }

  combined.sort((a, b) => a.seqNum - b.seqNum);

  // CSV経由と同様にDBカードと照合してoriginal_idを復元
  const csvRows = [CARD_CSV_HEADERS];
  combined.forEach((entry, idx) => {
    const num = idx + 1;
    if (entry.type === "event") {
      csvRows.push(
        deckCardToCsvRow({
          card_number: num,
          kind: "event",
          data: entry.item,
        })
      );
    } else {
      csvRows.push(
        deckCardToCsvRow({
          card_number: num,
          kind: entry.item.data_type === "ペット" ? "pet" : "person",
          data: entry.item,
          group: entry.group || {},
        })
      );
    }
  });

  const csvString = csvRows.map((r) => r.map(escapeCsvCell).join(",")).join("\r\n");
  const res = importDeckFromCsvText(csvString, db);
  res.restoredConditions =
    (parsed._web_deck_meta && parsed._web_deck_meta.conditions) || null;
  return res;
}
