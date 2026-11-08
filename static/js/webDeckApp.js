/**
 * Web版 HUGカードデッキ構築・出力ツール メインアプリケーション
 * GitHub Pages (静的ホスティング) および ローカルサーバー 両対応・PC/スマホ最適化UI
 */
import { escapeHtml, triggerBlobDownload } from "./util.js";
import { store } from "./store.js";
import { showToast } from "./components/toast.js";
import { renderMultiSelectChips } from "./components/chips.js";
import { openTrainingView } from "./views/trainingView.js";
import {
  PRINT_SIZES,
  toCardRenderModel,
  bindCardCanvasImage,
  generateCardImageCanvas,
  renderCardPreviewElement,
  renderMasterListElement,
  printMasterLedger,
  exportCardsAsPdf,
  exportCardsAsZip,
} from "./cardCanvas.js";
import {
  RELATIVE_TIMING_LIST,
  DISASTER_PHASE_LIST,
  detectHolidayTypes,
  isEligible,
  extractTimingIndex,
  extractPhaseIndex,
  buildInitialDeck,
  renumberDeckCards,
  analyzeDeckState,
  buildAllDatabaseCardEntries,
  exportDeckToCardCsvBlob,
  exportDeckToJsonBlob,
  importDeckFromLedgerFile,
} from "./webDeckEngine.js";

const STORAGE_KEY = "hug_web_deck_state_v1";
const MAX_UNDO_HISTORY = 25;

const state = {
  db: null,
  allDbCards: [], // buildAllDatabaseCardEntries(db)
  dbCardByOrigId: new Map(),
  dbCardsByGroupId: new Map(),

  // ワークスペース表示モード: 'conditions' | 'workspace' | 'export'
  // スマホ時は 'conditions' | 'deck' | 'db' | 'export'
  activeSection: "workspace",
  pcSplitMode: "split", // 'split' | 'deck' | 'db'
  cardSize: "md", // 'sm' | 'md' | 'lg'
  householdLinkMode: true, // true: 世帯まとめて追加・移動・除外 / false: 1枚ずつ
  showInlinePoints: false, // カード下に訓練ポイントを表示

  // ① 訓練条件
  conditions: {
    disaster_type: "",
    shelter: "",
    date: "",
    holiday_type: [],
    time_slot: "",
    infrastructure: [],
    weather: [],
    disaster_phase: [],
    max_events: "20",
    max_households: "15",
    excluded_ids: [],
  },
  phaseFirst: false,

  // ② デッキカード配列 (renumberDeckCards 済み)
  deckCards: [],
  undoStack: [],

  // 挿入先ターゲット: 'auto' (時期順) | 'end' (末尾) | 'start' (先頭) | 'after:12' (No.12の直後)
  insertTarget: "auto",

  // タップ移動モード (スマホ＆PC共通): 移動元の単位キー ('E:EV-001' / 'G:GRP-001')
  movingUnitKey: null,
  expandedUnitKey: null,
  expandedDbKey: null,
  flashUnitKey: null,

  // DBペインの検索・フィルタ状態
  dbFilter: {
    query: "",
    status: "unadopted", // 'unadopted' | 'eligible' | 'manual' | 'ineligible' | 'all'
    kind: "all", // 'all' | 'event' | 'person' | 'pet'
    timing: "",
    phase: "",
  },
  manuallyRemovedIds: new Set(),

  // ④ 出力画面のサブタブ: 'ledger' | 'images'
  exportSubView: "ledger",
  showLedgerPoints: true,
  selectedPrintSize: "business",
  activeExportSignal: null,
};

/**
 * 状態変更前に Undo スタックへ現在のデッキ順序を保存する.
 */
function pushUndoSnapshot() {
  const snapshot = state.deckCards.map((c) => ({
    original_id: c.original_id,
    kind: c.kind,
    unit_id: c.unit_id,
    group_id: c.group_id,
    group_name: c.group_name,
    data: structuredClone(c.data),
    group: c.group ? structuredClone(c.group) : null,
  }));
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_UNDO_HISTORY) {
    state.undoStack.shift();
  }
}

function performUndo() {
  if (state.undoStack.length === 0) {
    showToast("これ以上元に戻せません", "info");
    return;
  }
  const prev = state.undoStack.pop();
  state.deckCards = normalizeAndRenumber(prev);
  state.movingUnitKey = null;
  saveStateToLocalStorage();
  renderAll();
  showToast("直前の操作を元に戻しました", "info");
}

function saveStateToLocalStorage() {
  try {
    const minimal = {
      conditions: state.conditions,
      phaseFirst: state.phaseFirst,
      householdLinkMode: state.householdLinkMode,
      showInlinePoints: state.showInlinePoints,
      cardSize: state.cardSize,
      manuallyRemovedIds: [...state.manuallyRemovedIds],
      cardOrigIds: state.deckCards.map((c) => c.original_id),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
  } catch {
    // ignore storage quota errors
  }
}

function restoreStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.cardOrigIds) || saved.cardOrigIds.length === 0) {
      return false;
    }
    if (saved.conditions) {
      state.conditions = { ...state.conditions, ...saved.conditions };
    }
    if (typeof saved.phaseFirst === "boolean") state.phaseFirst = saved.phaseFirst;
    if (typeof saved.householdLinkMode === "boolean") {
      state.householdLinkMode = saved.householdLinkMode;
    }
    if (typeof saved.showInlinePoints === "boolean") {
      state.showInlinePoints = saved.showInlinePoints;
    }
    if (saved.cardSize) state.cardSize = saved.cardSize;
    if (Array.isArray(saved.manuallyRemovedIds)) {
      state.manuallyRemovedIds = new Set(saved.manuallyRemovedIds);
    }

    const restoredEntries = [];
    for (const oid of saved.cardOrigIds) {
      const dbEntry = state.dbCardByOrigId.get(String(oid));
      if (dbEntry) {
        restoredEntries.push({
          original_id: dbEntry.original_id,
          kind: dbEntry.kind,
          unit_id: dbEntry.unit_id,
          group_id: dbEntry.group_id,
          group_name: dbEntry.group_name,
          data: structuredClone(dbEntry.data),
          group: dbEntry.group ? structuredClone(dbEntry.group) : null,
        });
      }
    }
    if (restoredEntries.length > 0) {
      state.deckCards = normalizeAndRenumber(restoredEntries);
      return true;
    }
  } catch {
    // ignore parse errors
  }
  return false;
}

/**
 * データベース (./data/cards_db.json) をロードして初期化する.
 */
async function loadStaticDatabase() {
  const candidates = ["./data/cards_db.json", "/data/cards_db.json"];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("カードデータベース (data/cards_db.json) の読み込みに失敗しました");
}

function indexDatabase(db) {
  state.db = db;
  store.schema = db.schema || {};
  store.imageIds = new Set(db.image_ids || []);
  const imageMeta = db.image_meta || {};
  const cacheBust = {};
  for (const [tid, meta] of Object.entries(imageMeta)) {
    cacheBust[tid] = meta.sha256 || meta.updated_at || "";
  }
  store.imageCacheBust = cacheBust;

  // GitHub Pages / ローカル両対応の相対画像パス解決関数
  store.resolveImageUrl = (origId, ver = "") => {
    const meta = imageMeta[origId];
    const ext = (meta && meta.ext) || ".png";
    const q = ver ? `?v=${encodeURIComponent(ver)}` : "";
    return `./data/images/${encodeURIComponent(origId)}${ext}${q}`;
  };

  state.allDbCards = buildAllDatabaseCardEntries(db);
  state.dbCardByOrigId = new Map();
  state.dbCardsByGroupId = new Map();

  for (const entry of state.allDbCards) {
    state.dbCardByOrigId.set(entry.original_id, entry);
    if (entry.group_id) {
      if (!state.dbCardsByGroupId.has(entry.group_id)) {
        state.dbCardsByGroupId.set(entry.group_id, []);
      }
      state.dbCardsByGroupId.get(entry.group_id).push(entry);
    }
  }
}

// ============================================================================
// デッキ操作ロジック (追加・除外・移動・自動整列・初期提案)
// ============================================================================

/**
 * ① 条件設定から初期デッキを提案・構築する.
 */
function proposeDeckFromConditions({ notify = true, switchView = false } = {}) {
  if (state.deckCards.length > 0) {
    pushUndoSnapshot();
  }
  state.manuallyRemovedIds.clear();
  const res = buildInitialDeck(state.db, state.conditions, {
    phaseFirst: state.phaseFirst,
  });
  state.deckCards = res.cardEntries;
  state.movingUnitKey = null;
  saveStateToLocalStorage();

  if (switchView) {
    state.activeSection = isMobileViewport() ? "deck" : "workspace";
  }
  renderAll();

  if (notify) {
    const { stats } = analyzeDeckState(state.deckCards);
    showToast(
      `初期デッキを提案しました（全${stats.total_cards}枚: イベント${stats.events}件 / 世帯${stats.households}組）`,
      "success"
    );
  }
}

/**
 * DB内の保存済みデッキ (saved_decks) を読み込む.
 */
function loadSavedDeckPreset(savedDeck) {
  if (!savedDeck) return;
  if (state.deckCards.length > 0) {
    pushUndoSnapshot();
  }
  const cond = savedDeck.conditions || {};
  state.conditions = {
    disaster_type: cond.disaster_type || "",
    shelter: cond.shelter || "",
    date: cond.date || "",
    holiday_type: Array.isArray(cond.holiday_type) ? [...cond.holiday_type] : [],
    time_slot: cond.time_slot || "",
    infrastructure: Array.isArray(cond.infrastructure) ? [...cond.infrastructure] : [],
    weather: Array.isArray(cond.weather) ? [...cond.weather] : [],
    disaster_phase: Array.isArray(cond.disaster_phase) ? [...cond.disaster_phase] : [],
    max_events:
      cond.max_events !== null && cond.max_events !== undefined
        ? String(cond.max_events)
        : "",
    max_households:
      cond.max_households !== null && cond.max_households !== undefined
        ? String(cond.max_households)
        : "",
    excluded_ids: Array.isArray(cond.excluded_ids) ? [...cond.excluded_ids] : [],
  };

  state.manuallyRemovedIds = new Set(state.conditions.excluded_ids);

  const res = buildInitialDeck(state.db, state.conditions, {
    phaseFirst: false,
    resolutions: savedDeck.resolutions || {},
    manualOrder: savedDeck.manual_order || null,
    excludedIds: state.conditions.excluded_ids,
  });
  state.deckCards = res.cardEntries;
  state.movingUnitKey = null;
  saveStateToLocalStorage();
  state.activeSection = isMobileViewport() ? "deck" : "workspace";
  renderAll();
  showToast(
    `保存済みデッキ「${savedDeck.name}」を読み込みました（${state.deckCards.length}枚）`,
    "success"
  );
}

// ============================================================================
// 単位（ユニット）モデル: イベントは1枚＝1単位、世帯はメンバー全員で1単位
// デッキの並べ替え・抜き差しは常にこの単位で行う
// ============================================================================

function isHouseholdCard(c) {
  return Boolean(c && c.kind !== "event" && c.group_id);
}

function unitKeyOfCard(c) {
  return isHouseholdCard(c) ? `G:${c.group_id}` : `E:${c.original_id}`;
}

/**
 * 世帯メンバーが必ず連続するよう正規化してから連番を振り直す.
 * （世帯は最初に現れた位置にまとめる）
 */
function normalizeAndRenumber(cards) {
  const byGroup = new Map();
  for (const c of cards) {
    if (isHouseholdCard(c)) {
      if (!byGroup.has(c.group_id)) byGroup.set(c.group_id, []);
      byGroup.get(c.group_id).push(c);
    }
  }
  const placed = new Set();
  const out = [];
  for (const c of cards) {
    if (isHouseholdCard(c)) {
      if (placed.has(c.group_id)) continue;
      placed.add(c.group_id);
      out.push(...byGroup.get(c.group_id));
    } else {
      out.push(c);
    }
  }
  return renumberDeckCards(out, state.db);
}

/**
 * 現在のデッキを単位の配列に変換する.
 */
function getDeckUnits(cards = state.deckCards) {
  const units = [];
  for (const c of cards) {
    const last = units[units.length - 1];
    const key = unitKeyOfCard(c);
    if (last && last.key === key) {
      last.cards.push(c);
    } else {
      units.push({
        key,
        kind: isHouseholdCard(c) ? "household" : "event",
        group_id: isHouseholdCard(c) ? c.group_id : null,
        cards: [c],
      });
    }
  }
  units.forEach((u, i) => {
    u.index = i;
    u.startNo = u.cards[0].card_number;
    u.endNo = u.cards[u.cards.length - 1].card_number;
  });
  return units;
}

function findDeckUnit(unitKey) {
  return getDeckUnits().find((u) => u.key === unitKey) || null;
}

function unitLabel(unit) {
  if (!unit) return "";
  const first = unit.cards[0];
  if (unit.kind === "household") {
    return `世帯 ${first.group_id} ${first.group_name || ""}（${unit.cards.length}枚）`;
  }
  return `${first.original_id} ${first.title || ""}`;
}

function toDeckEntry(e) {
  return {
    original_id: e.original_id,
    kind: e.kind,
    unit_id: e.unit_id,
    group_id: e.group_id,
    group_name: e.group_name,
    data: structuredClone(e.data),
    group: e.group ? structuredClone(e.group) : null,
    timing_index: e.timing_index,
    phase_index: e.phase_index,
  };
}

function commitDeck(cards, { flashKey = null } = {}) {
  state.deckCards = normalizeAndRenumber(cards);
  state.movingUnitKey = null;
  if (flashKey) state.flashUnitKey = flashKey;
  saveStateToLocalStorage();
  renderAll();
}

/**
 * 単位を「units 配列上の挿入位置（移動前のインデックス基準, 0〜units.length）」へ移動する.
 */
function moveDeckUnitTo(unitKey, insertBeforeIdx) {
  const units = getDeckUnits();
  const fromIdx = units.findIndex((u) => u.key === unitKey);
  if (fromIdx < 0) return;
  let to = Math.max(0, Math.min(units.length, Number(insertBeforeIdx)));
  if (to === fromIdx || to === fromIdx + 1) {
    state.movingUnitKey = null;
    renderAll();
    return;
  }
  pushUndoSnapshot();
  const [moving] = units.splice(fromIdx, 1);
  if (to > fromIdx) to -= 1;
  units.splice(to, 0, moving);
  commitDeck(
    units.flatMap((u) => u.cards),
    { flashKey: moving.key }
  );
  const moved = findDeckUnit(moving.key);
  if (moved) {
    showToast(
      `${unitLabel(moved)} を No.${moved.startNo}${moved.endNo !== moved.startNo ? `〜${moved.endNo}` : ""} へ移動しました`,
      "success"
    );
  }
}

/**
 * 指定したカード番号の位置へ単位を移動する（一気に何十枚分も前後へ移動できる）.
 */
function moveDeckUnitToCardNo(unitKey, targetNo) {
  const units = getDeckUnits();
  const fromIdx = units.findIndex((u) => u.key === unitKey);
  if (fromIdx < 0) return;
  const no = Number(targetNo);
  if (!Number.isFinite(no)) return;
  if (no <= 1) {
    moveDeckUnitTo(unitKey, 0);
    return;
  }
  const tIdx = units.findIndex((u) => no >= u.startNo && no <= u.endNo);
  if (tIdx < 0) {
    moveDeckUnitTo(unitKey, units.length);
    return;
  }
  moveDeckUnitTo(unitKey, tIdx > fromIdx ? tIdx + 1 : tIdx);
}

function stepMoveDeckUnit(unitKey, delta) {
  const units = getDeckUnits();
  const fromIdx = units.findIndex((u) => u.key === unitKey);
  if (fromIdx < 0) return;
  const target = delta < 0 ? fromIdx + delta : fromIdx + delta + 1;
  moveDeckUnitTo(unitKey, Math.max(0, Math.min(units.length, target)));
}

/**
 * デッキからカードを外す. 通常は所属する単位（世帯ごと）、forceSingle 時はそのカード1枚のみ.
 */
function removeCardFromDeck(origId, { forceSingle = false } = {}) {
  const card = state.deckCards.find((c) => c.original_id === origId);
  if (!card) return;
  const key = unitKeyOfCard(card);
  const targetIds = new Set(
    forceSingle
      ? [origId]
      : state.deckCards.filter((c) => unitKeyOfCard(c) === key).map((c) => c.original_id)
  );
  pushUndoSnapshot();
  for (const tid of targetIds) state.manuallyRemovedIds.add(tid);
  if (isHouseholdCard(card) && !forceSingle) state.manuallyRemovedIds.add(card.group_id);
  if (state.movingUnitKey === key) state.movingUnitKey = null;
  commitDeck(state.deckCards.filter((c) => !targetIds.has(c.original_id)));
  const label =
    targetIds.size > 1
      ? `世帯 ${card.group_id} ${card.group_name || ""}（${targetIds.size}枚）`
      : `${origId} ${card.title || ""}`;
  showToast(`${label} をデッキから外しました（↩ 元に戻す可）`, "info");
}

/**
 * 挿入位置（カード配列のインデックス）を単位境界にそろえて決める.
 */
function resolveInsertCardIndex(newEntries, insertAtUnitIndex) {
  const units = getDeckUnits();
  const total = state.deckCards.length;
  const unitStartIdx = (uIdx) =>
    uIdx >= units.length ? total : units[uIdx].startNo - 1;

  if (insertAtUnitIndex !== null && insertAtUnitIndex !== undefined) {
    return unitStartIdx(Math.max(0, Math.min(units.length, insertAtUnitIndex)));
  }
  const tgt = state.insertTarget || "auto";
  if (tgt === "start") return 0;
  if (tgt === "end") return total;
  if (tgt.startsWith("after:")) {
    const no = Number(tgt.slice(6));
    const u = units.find((x) => no >= x.startNo && no <= x.endNo);
    return u ? u.endNo : total;
  }
  // auto: 時期・進行度順の自然な位置（単位の先頭で判定）
  const sample = newEntries[0];
  const keyOf = (t, p) =>
    state.phaseFirst ? (p ?? 99) * 100 + (t ?? 2) : (t ?? 2) * 100 + (p ?? 99);
  const keyNew = keyOf(sample.timing_index, sample.phase_index);
  for (const u of units) {
    const c = u.cards[0];
    if (keyOf(c.timing_index, c.phase_index) > keyNew) return u.startNo - 1;
  }
  return total;
}

/**
 * データベースのカードをデッキへ追加する. 世帯は（未採用の）メンバー全員をまとめて追加.
 * @param {string} origId
 * @param {{ forceSingle?: boolean, insertAtUnitIndex?: number | null }} [options]
 */
function addCardFromDbToDeck(origId, { forceSingle = false, insertAtUnitIndex = null } = {}) {
  const dbEntry = state.dbCardByOrigId.get(origId);
  if (!dbEntry) return;
  const inDeck = new Set(state.deckCards.map((c) => c.original_id));

  let entries;
  if (!forceSingle && dbEntry.kind !== "event" && dbEntry.group_id) {
    entries = (state.dbCardsByGroupId.get(dbEntry.group_id) || [dbEntry]).filter(
      (e) => !inDeck.has(e.original_id)
    );
  } else {
    entries = inDeck.has(dbEntry.original_id) ? [] : [dbEntry];
  }
  if (entries.length === 0) {
    showToast("このカードはすでにデッキに含まれています", "warning");
    return;
  }

  pushUndoSnapshot();
  for (const e of entries) {
    state.manuallyRemovedIds.delete(e.original_id);
    if (e.group_id) state.manuallyRemovedIds.delete(e.group_id);
  }
  const formatted = entries.map(toDeckEntry);
  const next = [...state.deckCards];

  // 世帯の一部がすでにデッキにある場合は、その世帯の後ろにまとめる（正規化で自動的に連続化）
  const alreadyHasGroup =
    dbEntry.group_id && next.some((c) => c.group_id === dbEntry.group_id);
  let insertIdx;
  if (alreadyHasGroup) {
    insertIdx = next.length;
  } else {
    insertIdx = resolveInsertCardIndex(formatted, insertAtUnitIndex);
  }
  next.splice(insertIdx, 0, ...formatted);

  const key = unitKeyOfCard(formatted[0]);
  commitDeck(next, { flashKey: key });

  const added = findDeckUnit(key);
  if (added && state.insertTarget.startsWith("after:") && insertAtUnitIndex === null) {
    state.insertTarget = `after:${added.endNo}`;
    renderAll();
  }
  const posLabel = added
    ? `No.${added.startNo}${added.endNo !== added.startNo ? `〜${added.endNo}` : ""}`
    : "";
  const itemLabel =
    formatted.length > 1 || (dbEntry.group_id && !forceSingle)
      ? `世帯 ${dbEntry.group_id} ${dbEntry.group_name || ""}（${formatted.length}枚）`
      : `${dbEntry.original_id} ${dbEntry.title || ""}`;
  showToast(`${itemLabel} をデッキの ${posLabel} に追加しました`, "success");
}

/**
 * 現在のデッキ構成カードを時期・進行度・前提カードルールで自動整列する.
 */
function autoSortCurrentDeck({ phaseFirst = state.phaseFirst } = {}) {
  if (state.deckCards.length <= 1) return;
  pushUndoSnapshot();

  // 現在デッキに入っているイベントと世帯を単位化して computeOrderUnits にかける
  const evList = [];
  const grpMap = new Map();
  const membersByGrp = new Map();

  for (const c of state.deckCards) {
    if (c.kind === "event") {
      evList.push(c.data);
    } else {
      const gid = c.group_id || c.original_id;
      if (!grpMap.has(gid)) {
        grpMap.set(gid, c.group || { group_id: gid, group_name: c.group_name || gid });
        membersByGrp.set(gid, []);
      }
      membersByGrp.get(gid).push(c);
    }
  }

  const res = buildInitialDeck(
    {
      cards_event: evList,
      evacuee_groups: [...grpMap.values()],
      group_members: state.deckCards
        .filter((c) => c.kind !== "event")
        .map((c) => c.data),
    },
    {},
    { phaseFirst }
  );

  state.phaseFirst = phaseFirst;
  state.deckCards = res.cardEntries;
  state.movingUnitKey = null;
  saveStateToLocalStorage();
  renderAll();
  showToast(
    phaseFirst
      ? "災害進行度を優先してデッキの並び順を自動整列しました"
      : "発生時期・進行度・前提カードに沿ってデッキを自動整列しました",
    "success"
  );
}

/**
 * 前提カード不足・順序違反をワンクリックで自動修正する.
 */
function autoFixPrerequisiteIssues() {
  const { prereqIssues } = analyzeDeckState(state.deckCards);
  if (prereqIssues.size === 0) return;

  pushUndoSnapshot();
  const nextCards = [...state.deckCards];
  const presentIds = new Set(nextCards.map((c) => c.original_id));

  // 不足している前提カードをDBから追加
  for (const issue of prereqIssues.values()) {
    if (issue.type === "missing") {
      let currPre = issue.prereqId;
      while (currPre && !presentIds.has(currPre) && state.dbCardByOrigId.has(currPre)) {
        const preEntry = state.dbCardByOrigId.get(currPre);
        nextCards.unshift({
          original_id: preEntry.original_id,
          kind: preEntry.kind,
          unit_id: preEntry.unit_id,
          group_id: null,
          group_name: null,
          data: structuredClone(preEntry.data),
          group: null,
        });
        presentIds.add(currPre);
        currPre = preEntry.data && preEntry.data.prerequisite_card_id;
      }
    }
  }

  // 前提カードが依存カードより前に来るよう補正
  let changed = true;
  let guard = 0;
  while (changed && guard < 50) {
    changed = false;
    guard++;
    for (let i = 0; i < nextCards.length; i++) {
      const c = nextCards[i];
      const pre = c.kind === "event" && c.data && c.data.prerequisite_card_id;
      if (pre) {
        const preIdx = nextCards.findIndex((x) => x.original_id === pre);
        if (preIdx > i) {
          const [preCard] = nextCards.splice(preIdx, 1);
          nextCards.splice(i, 0, preCard);
          changed = true;
          break;
        }
      }
    }
  }

  state.deckCards = normalizeAndRenumber(nextCards);
  saveStateToLocalStorage();
  renderAll();
  showToast("前提カードの追加と順序補正を完了しました", "success");
}

function isMobileViewport() {
  return window.innerWidth <= 768;
}

// ============================================================================
// UI レンダリング
// ============================================================================

function renderAll() {
  renderHeaderAndNav();
  renderMainContent();
  renderFloatingMoveBanner();
}

function renderHeaderAndNav() {
  const { stats } = analyzeDeckState(state.deckCards);
  const adoptedIds = new Set(state.deckCards.map((c) => c.original_id));
  const unadoptedCount = state.allDbCards.filter(
    (c) => !adoptedIds.has(c.original_id)
  ).length;

  // Header stats
  const totalEl = document.getElementById("wd-hdr-total");
  const evEl = document.getElementById("wd-hdr-events");
  const hhEl = document.getElementById("wd-hdr-households");
  const pEl = document.getElementById("wd-hdr-persons");
  const petEl = document.getElementById("wd-hdr-pets");
  const dbEl = document.getElementById("wd-hdr-db-remaining");

  if (totalEl) totalEl.textContent = `${stats.total_cards}枚`;
  if (evEl) evEl.textContent = String(stats.events);
  if (hhEl) hhEl.textContent = `${stats.households}組`;
  if (pEl) pEl.textContent = `${stats.persons}名`;
  if (petEl) petEl.textContent = `${stats.pets}匹`;
  if (dbEl) dbEl.textContent = `${unadoptedCount}枚`;

  // PC Step tabs
  document.querySelectorAll(".wd-step-tab").forEach((btn) => {
    const sec = btn.dataset.section;
    if (!sec) return;
    const isAct =
      sec === state.activeSection ||
      (sec === "workspace" &&
        (state.activeSection === "deck" || state.activeSection === "db"));
    btn.classList.toggle("active", isAct);
  });

  const tabDeckBadge = document.getElementById("wd-tab-deck-badge");
  if (tabDeckBadge) tabDeckBadge.textContent = `${stats.total_cards}枚`;

  // Mobile bottom nav
  document.querySelectorAll(".wd-mob-nav-btn").forEach((btn) => {
    const sec = btn.dataset.mobSection;
    const isAct =
      sec === state.activeSection ||
      (sec === "deck" && state.activeSection === "workspace");
    btn.classList.toggle("active", isAct);
  });

  const mobDeckBadge = document.getElementById("wd-mob-deck-badge");
  if (mobDeckBadge) mobDeckBadge.textContent = String(stats.total_cards);
  const mobDbBadge = document.getElementById("wd-mob-db-badge");
  if (mobDbBadge) mobDbBadge.textContent = String(unadoptedCount);
}

function renderMainContent() {
  const main = document.getElementById("wd-main");
  if (!main) return;
  const keepScroll = {};
  for (const id of ["wd-deck-scroll", "wd-db-scroll"]) {
    const el = document.getElementById(id);
    if (el) keepScroll[id] = el.scrollTop;
  }
  renderMainContentInner(main);
  for (const [id, top] of Object.entries(keepScroll)) {
    const el = document.getElementById(id);
    if (el) el.scrollTop = top;
  }
}

function renderMainContentInner(main) {

  const isMob = isMobileViewport();
  let sec = state.activeSection;
  if (!isMob && (sec === "deck" || sec === "db")) {
    sec = "workspace";
  }
  if (isMob && sec === "workspace") {
    sec = "deck";
  }

  if (sec === "conditions") {
    renderConditionsSection(main);
  } else if (sec === "export") {
    renderExportAndLedgerSection(main);
  } else {
    renderWorkspaceSection(main, sec);
  }
}

// ----------------------------------------------------------------------------
// Section 1: ① 条件設定によるデッキの初期提案 + ⑤ 台帳インポート
// ----------------------------------------------------------------------------
function renderConditionsSection(container) {
  const opts = (state.db && state.db.schema && state.db.schema.options) || {};
  const savedDecks = (state.db && state.db.saved_decks) || [];
  const cond = state.conditions;

  const makeSelectOptions = (list, currentVal) =>
    `<option value="">(指定なし・すべて対象)</option>` +
    (list || [])
      .map(
        (o) =>
          `<option value="${escapeHtml(o)}" ${currentVal === o ? "selected" : ""}>${escapeHtml(o)}</option>`
      )
      .join("");

  const savedDecksHtml =
    savedDecks.length > 0
      ? `
        <div class="wd-presets-bar" data-testid="wd-saved-decks-bar">
          <div class="wd-presets-left">
            <strong>📌 DB保存済みデッキを読み込む:</strong>
            ${savedDecks
              .map(
                (sd) => `
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary wd-load-saved-deck-btn"
                    data-saved-id="${escapeHtml(sd.id)}"
                    data-testid="wd-load-saved-${escapeHtml(sd.id)}"
                  >
                    📂 ${escapeHtml(sd.name)}
                  </button>
                `
              )
              .join("")}
          </div>
          <button
            type="button"
            class="btn btn-sm"
            id="wd-cond-import-btn"
            data-testid="wd-cond-import-btn"
          >
            📥 カード台帳(CSV/JSON)をインポートして再開
          </button>
        </div>
      `
      : `
        <div class="wd-presets-bar">
          <span>💡 以前にエクスポートしたカード台帳（CSV / JSON）がある場合は、インポートして続きから編集できます。</span>
          <button
            type="button"
            class="btn btn-sm btn-secondary"
            id="wd-cond-import-btn"
            data-testid="wd-cond-import-btn"
          >
            📥 カード台帳(CSV/JSON)をインポートして再開
          </button>
        </div>
      `;

  container.innerHTML = `
    <div class="wd-conditions-panel" data-testid="wd-conditions-panel">
      <div class="wd-conditions-header">
        <h2>⚙️ ① 訓練条件の設定と初期デッキ提案</h2>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm" id="wd-reset-cond-btn" data-testid="wd-reset-cond-btn">
            条件をクリア
          </button>
          <button type="button" class="btn btn-primary" id="wd-propose-top-btn" data-testid="wd-propose-top-btn">
            ✨ この条件で初期デッキを提案してカード編集へ進む →
          </button>
        </div>
      </div>

      ${savedDecksHtml}

      <div class="wd-conditions-grid">
        <div class="wd-cond-box">
          <label class="form-label" for="wd-disaster-select">想定災害 (disaster_type)</label>
          <select id="wd-disaster-select" class="form-select" data-testid="wd-disaster-select">
            ${makeSelectOptions(opts.disaster_types, cond.disaster_type)}
          </select>
        </div>

        <div class="wd-cond-box">
          <label class="form-label" for="wd-shelter-select">避難所 (shelter)</label>
          <select id="wd-shelter-select" class="form-select" data-testid="wd-shelter-select">
            ${makeSelectOptions(opts.shelters, cond.shelter)}
          </select>
        </div>

        <div class="wd-cond-box">
          <label class="form-label" for="wd-date-input">訓練想定日 (date → 休日種別を自動判定)</label>
          <input
            type="date"
            id="wd-date-input"
            class="form-input"
            data-testid="wd-date-input"
            value="${escapeHtml(cond.date || "")}"
          />
        </div>

        <div class="wd-cond-box">
          <label class="form-label" for="wd-timeslot-select">時間帯 (time_slot)</label>
          <select id="wd-timeslot-select" class="form-select" data-testid="wd-timeslot-select">
            ${makeSelectOptions(opts.time_slots, cond.time_slot)}
          </select>
        </div>

        <div class="wd-cond-box">
          <label class="form-label" for="wd-max-events">イベントカード上限数 (空欄=制限なし)</label>
          <input
            type="number"
            min="0"
            id="wd-max-events"
            class="form-input"
            data-testid="wd-max-events"
            placeholder="例: 20 (空欄で全件)"
            value="${escapeHtml(cond.max_events ?? "")}"
          />
        </div>

        <div class="wd-cond-box">
          <label class="form-label" for="wd-max-households">避難者世帯の上限数 (空欄=制限なし)</label>
          <input
            type="number"
            min="0"
            id="wd-max-households"
            class="form-input"
            data-testid="wd-max-households"
            placeholder="例: 15 (空欄で全件)"
            value="${escapeHtml(cond.max_households ?? "")}"
          />
        </div>
      </div>

      <div class="wd-conditions-chips-grid">
        <div class="wd-cond-box">
          <label class="form-label">休日種別（日付から自動判定・手動切替可）</label>
          <div id="wd-holiday-chips" class="chips-wrap" data-testid="wd-holiday-chips"></div>
        </div>

        <div class="wd-cond-box">
          <label class="form-label">インフラ状況 (infrastructure)</label>
          <div id="wd-infra-chips" class="chips-wrap" data-testid="wd-infra-chips"></div>
        </div>

        <div class="wd-cond-box">
          <label class="form-label">天候 (weather)</label>
          <div id="wd-weather-chips" class="chips-wrap" data-testid="wd-weather-chips"></div>
        </div>

        <div class="wd-cond-box">
          <label class="form-label">対象とする災害進行度 (未選択時は全進行度)</label>
          <div id="wd-phase-chips" class="chips-wrap" data-testid="wd-phase-chips"></div>
        </div>
      </div>

      <div class="wd-conditions-footer">
        <label class="wd-toggle-pill ${state.phaseFirst ? "active" : ""}">
          <input type="checkbox" id="wd-phase-first-chk" ${state.phaseFirst ? "checked" : ""} />
          災害進行度の順序を最優先して並べる
        </label>
        <button
          type="button"
          class="btn btn-lg btn-primary"
          id="wd-propose-bottom-btn"
          data-testid="wd-propose-bottom-btn"
        >
          ✨ この条件で初期デッキを提案・再構築する
        </button>
      </div>
    </div>
  `;

  const renderHolidayChips = () => {
    renderMultiSelectChips(
      container.querySelector("#wd-holiday-chips"),
      opts.holiday_type || ["平日", "土日", "祝日", "大型連休", "年末年始"],
      state.conditions.holiday_type || [],
      (vals) => {
        state.conditions.holiday_type = vals;
      },
      "wd-holiday"
    );
  };
  renderHolidayChips();

  renderMultiSelectChips(
    container.querySelector("#wd-infra-chips"),
    opts.infrastructure || [],
    state.conditions.infrastructure || [],
    (vals) => {
      state.conditions.infrastructure = vals;
    },
    "wd-infra"
  );

  renderMultiSelectChips(
    container.querySelector("#wd-weather-chips"),
    opts.weather || [],
    state.conditions.weather || [],
    (vals) => {
      state.conditions.weather = vals;
    },
    "wd-weather"
  );

  renderMultiSelectChips(
    container.querySelector("#wd-phase-chips"),
    opts.disaster_phase || DISASTER_PHASE_LIST,
    state.conditions.disaster_phase || [],
    (vals) => {
      state.conditions.disaster_phase = vals;
    },
    "wd-phase"
  );

  container.querySelector("#wd-disaster-select").addEventListener("change", (e) => {
    state.conditions.disaster_type = e.target.value;
  });
  container.querySelector("#wd-shelter-select").addEventListener("change", (e) => {
    state.conditions.shelter = e.target.value;
  });
  container.querySelector("#wd-timeslot-select").addEventListener("change", (e) => {
    state.conditions.time_slot = e.target.value;
  });
  container.querySelector("#wd-max-events").addEventListener("input", (e) => {
    state.conditions.max_events = e.target.value;
  });
  container.querySelector("#wd-max-households").addEventListener("input", (e) => {
    state.conditions.max_households = e.target.value;
  });
  container.querySelector("#wd-date-input").addEventListener("change", (e) => {
    const val = e.target.value;
    state.conditions.date = val;
    state.conditions.holiday_type = val ? detectHolidayTypes(val) : [];
    renderHolidayChips();
  });

  const phaseFirstChk = container.querySelector("#wd-phase-first-chk");
  if (phaseFirstChk) {
    phaseFirstChk.addEventListener("change", (e) => {
      state.phaseFirst = Boolean(e.target.checked);
      phaseFirstChk.closest(".wd-toggle-pill").classList.toggle("active", state.phaseFirst);
    });
  }

  container.querySelector("#wd-reset-cond-btn").addEventListener("click", () => {
    state.conditions = {
      disaster_type: "",
      shelter: "",
      date: "",
      holiday_type: [],
      time_slot: "",
      infrastructure: [],
      weather: [],
      disaster_phase: [],
      max_events: "",
      max_households: "",
      excluded_ids: [],
    };
    renderConditionsSection(container);
    showToast("訓練条件をクリアしました", "info");
  });

  const handlePropose = () => {
    proposeDeckFromConditions({ notify: true, switchView: true });
  };
  container.querySelector("#wd-propose-top-btn").addEventListener("click", handlePropose);
  container.querySelector("#wd-propose-bottom-btn").addEventListener("click", handlePropose);

  container.querySelectorAll(".wd-load-saved-deck-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sid = Number(btn.dataset.savedId);
      const found = savedDecks.find((d) => Number(d.id) === sid);
      if (found) loadSavedDeckPreset(found);
    });
  });

  const impBtn = container.querySelector("#wd-cond-import-btn");
  if (impBtn) {
    impBtn.addEventListener("click", () => openImportLedgerModal());
  }
}

// ----------------------------------------------------------------------------
// Section 2: ② デッキ＆データベース編集ワークスペース
//   - 1行＝1単位（イベント1枚 / 世帯まるごと）のコンパクトなリスト表示
//   - 世帯はカードを重ねたサムネイル＋枚数バッジで表示し、世帯単位でのみ移動・抜き差し
//   - サムネイルをクリックで拡大、行をクリックで詳細を展開
//   - ドラッグ＆ドロップ（PC: 行のどこでも / スマホ: ⠿ハンドル）＋自動スクロールで一気に移動
//   - 「No.指定」入力で何十枚分も一気に前後へ移動
// ----------------------------------------------------------------------------

const THUMB_WIDTH = { sm: 40, md: 58, lg: 88 };

function getUnitTitle(unit) {
  const first = unit.cards[0];
  if (unit.kind === "household") {
    const grp = first.group || {};
    return String(first.group_name || grp.group_name || first.group_id || "");
  }
  return String((first.data && first.data.event_name) || first.title || first.original_id);
}

function getHouseholdSummary(unit, dbMembers) {
  const first = unit.cards[0];
  const grp = first.group || {};
  const persons = unit.cards.filter((c) => c.kind !== "pet").length;
  const pets = unit.cards.filter((c) => c.kind === "pet").length;
  const equip = Array.isArray(grp.personal_equipment) ? grp.personal_equipment : [];
  const totalInDb = dbMembers ? dbMembers.length : unit.cards.length;
  return { grp, persons, pets, equip, totalInDb };
}

function memberChipsHtml(cards) {
  return cards
    .map((c) => {
      const d = c.data || {};
      const isPet = c.kind === "pet";
      const parts = [];
      if (d.relationship) parts.push(d.relationship);
      if (d.age !== null && d.age !== undefined && d.age !== "") parts.push(`${d.age}${isPet ? "歳" : "歳"}`);
      const tips = [
        ...(Array.isArray(d.vulnerabilities) ? d.vulnerabilities : []),
        ...(Array.isArray(d.health_condition) ? d.health_condition : []),
      ].filter(Boolean);
      const tipText = tips.length ? ` / ${tips.join("・")}` : "";
      return `<span class="wd-mchip ${isPet ? "is-pet" : ""}" title="${escapeHtml(`${c.original_id} ${d.name || ""}${tipText}`)}">${isPet ? "🐾" : "👤"} ${escapeHtml(d.name || c.original_id)}${parts.length ? `<small>（${escapeHtml(parts.join("・"))}）</small>` : ""}${tips.length ? `<em>${escapeHtml(tips[0])}</em>` : ""}</span>`;
    })
    .join("");
}

function thumbHtml(unit) {
  const n = unit.cards.length;
  const layers = Math.min(n, 4) - 1;
  const layerHtml = Array.from(
    { length: layers },
    (_, i) => `<span class="wd-thumb-layer" style="--layer:${layers - i};"></span>`
  ).join("");
  return `
    <div class="wd-unit-thumb ${n > 1 ? "is-stack" : ""}" data-action="zoom" title="クリックで拡大">
      ${layerHtml}
      <img class="wd-thumb-img" alt="" draggable="false" />
      ${n > 1 ? `<span class="wd-stack-count">${n}枚</span>` : ""}
    </div>
  `;
}

function bindUnitThumb(rowEl, unit, showNumber) {
  const img = rowEl.querySelector(".wd-thumb-img");
  const first = unit.cards[0];
  const model = toCardRenderModel(first, first.group, {
    cardNumber: showNumber ? first.card_number : null,
    originalId: first.original_id,
  });
  if (img && model) bindCardCanvasImage(img, model, { showNumber });
}

function expandedHtml(unit, mode) {
  const isHH = unit.kind === "household";
  const first = unit.cards[0];
  const d = first.data || {};
  const cardsHtml = unit.cards
    .map((c) => {
      const cd = c.data || {};
      const singleBtn =
        isHH && unit.cards.length > 1 && mode === "deck"
          ? `<button type="button" class="wd-act-btn" data-single-remove="${escapeHtml(c.original_id)}">このメンバーだけ外す</button>`
          : isHH && mode === "db" && !c.__inDeck
            ? `<button type="button" class="wd-act-btn" data-single-add="${escapeHtml(c.original_id)}">このメンバーだけ追加</button>`
            : "";
      return `
        <figure class="wd-expand-card">
          <img class="wd-expand-img" data-zoom-orig="${escapeHtml(c.original_id)}" alt="" draggable="false" title="クリックで拡大" />
          <figcaption>
            ${mode === "deck" ? `<strong>No.${c.card_number}</strong> ` : ""}${escapeHtml(c.original_id)} ${escapeHtml(cd.name || cd.event_name || "")}
            ${cd.relationship ? `<small>（${escapeHtml(cd.relationship)}）</small>` : ""}
          </figcaption>
          <div class="wd-expand-point">💡 ${escapeHtml(cd.training_point || "（訓練ポイント記載なし）")}</div>
          ${singleBtn}
        </figure>
      `;
    })
    .join("");
  const textHtml = !isHH
    ? `
      <div class="wd-expand-text">
        ${d.scene_description ? `<p><strong>状況描写:</strong> ${escapeHtml(d.scene_description)}</p>` : ""}
        ${d.content ? `<p><strong>イベント内容:</strong> ${escapeHtml(d.content)}</p>` : ""}
        ${d.prerequisite_card_id ? `<p><strong>前提カード:</strong> ${escapeHtml(d.prerequisite_card_id)}</p>` : ""}
      </div>
    `
    : "";
  return `<div class="wd-unit-expand" data-testid="wd-unit-expand">${textHtml}<div class="wd-expand-cards">${cardsHtml}</div></div>`;
}

function bindExpandedImages(rowEl, unit, mode) {
  rowEl.querySelectorAll(".wd-expand-img").forEach((img) => {
    const c = unit.cards.find((x) => x.original_id === img.dataset.zoomOrig);
    if (!c) return;
    const model = toCardRenderModel(c, c.group, {
      cardNumber: mode === "deck" ? c.card_number : null,
      originalId: c.original_id,
    });
    if (model) bindCardCanvasImage(img, model, { showNumber: mode === "deck" });
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openCardDetailModal(c.original_id, mode === "deck");
    });
  });
  rowEl.querySelectorAll("[data-single-remove]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      removeCardFromDeck(b.dataset.singleRemove, { forceSingle: true });
    })
  );
  rowEl.querySelectorAll("[data-single-add]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      addCardFromDbToDeck(b.dataset.singleAdd, { forceSingle: true });
    })
  );
}

/**
 * 1単位分の行（デッキ / DB 共通の表示部分）を生成する.
 */
function unitBodyHtml(unit, { mode, issuesText = "", dbMembers = null }) {
  const isHH = unit.kind === "household";
  const first = unit.cards[0];
  const d = first.data || {};
  const title = getUnitTitle(unit);
  const idBadge = isHH ? first.group_id : first.original_id;

  let infoHtml = "";
  if (isHH) {
    const s = getHouseholdSummary(unit, dbMembers);
    infoHtml = `
      <div class="wd-hh-summary">
        <span class="wd-hh-comp">👤${s.persons}名${s.pets ? ` 🐾${s.pets}匹` : ""}${s.totalInDb > unit.cards.length ? `<small>（全${s.totalInDb}枚中）</small>` : ""}</span>
        ${s.grp.evacuation_origin ? `<span>避難元: ${escapeHtml(s.grp.evacuation_origin)}</span>` : ""}
        ${s.grp.urgency_level ? `<span class="${s.grp.urgency_level !== "通常" ? "wd-urgent" : ""}">緊急度: ${escapeHtml(s.grp.urgency_level)}</span>` : ""}
        ${s.equip.length ? `<span>持参: ${escapeHtml(s.equip.join("・"))}</span>` : ""}
      </div>
      <div class="wd-hh-members">${memberChipsHtml(unit.cards)}</div>
    `;
  } else {
    const cats = Array.isArray(d.category) ? d.category.join("・") : "";
    infoHtml = `
      <div class="wd-ev-desc">${cats ? `<span class="wd-ev-cat">${escapeHtml(cats)}</span>` : ""}${escapeHtml(d.content || d.scene_description || "")}</div>
    `;
  }

  const pointsHtml = state.showInlinePoints
    ? `<div class="wd-unit-points">${unit.cards
        .map((c) =>
          c.data && c.data.training_point
            ? `<div>💡 ${isHH ? `<strong>${escapeHtml(c.data.name || c.original_id)}:</strong> ` : ""}${escapeHtml(c.data.training_point)}</div>`
            : ""
        )
        .join("")}</div>`
    : "";

  return `
    <div class="wd-unit-title">
      <span class="wd-kind-icon">${isHH ? "🏠" : "⚡"}</span>
      <span class="wd-unit-title-text">${escapeHtml(title)}</span>
      <span class="wd-card-orig-badge">${escapeHtml(idBadge)}</span>
    </div>
    <div class="wd-unit-badges">
      <span class="wd-mini-badge badge-timing">${escapeHtml(first.timing_label || "中盤")}</span>
      ${first.phase_label ? `<span class="wd-mini-badge badge-phase">${escapeHtml(first.phase_label)}</span>` : ""}
      ${!isHH && d.priority === 0 ? `<span class="wd-mini-badge badge-eligible">P:0(必須)</span>` : ""}
      ${!isHH && d.prerequisite_card_id && !issuesText ? `<span class="wd-mini-badge">前提:${escapeHtml(d.prerequisite_card_id)}</span>` : ""}
      ${issuesText ? `<span class="wd-mini-badge badge-warn" title="${escapeHtml(issuesText)}">🔗 ${escapeHtml(issuesText)}</span>` : ""}
    </div>
    ${infoHtml}
    ${pointsHtml}
  `;
}

function renderWorkspaceSection(container, activeSubSection = "workspace") {
  const isMob = isMobileViewport();
  const showDeckPane = !isMob
    ? state.pcSplitMode !== "db"
    : activeSubSection === "deck" || activeSubSection === "workspace";
  const showDbPane = !isMob ? state.pcSplitMode !== "deck" : activeSubSection === "db";

  const dualLayoutClass = !isMob
    ? state.pcSplitMode === "deck"
      ? "layout-deck-only"
      : state.pcSplitMode === "db"
        ? "layout-db-only"
        : ""
    : "layout-deck-only";

  const units = getDeckUnits();
  const insertOptionsHtml = [
    `<option value="auto" ${state.insertTarget === "auto" ? "selected" : ""}>自動（時期・進行度順の位置）</option>`,
    `<option value="end" ${state.insertTarget === "end" ? "selected" : ""}>デッキ末尾 (No.${state.deckCards.length + 1}〜)</option>`,
    `<option value="start" ${state.insertTarget === "start" ? "selected" : ""}>デッキ先頭 (No.1〜)</option>`,
    ...units.map((u) => {
      const v = `after:${u.endNo}`;
      const noLabel = u.startNo === u.endNo ? `No.${u.startNo}` : `No.${u.startNo}〜${u.endNo}`;
      return `<option value="${v}" ${state.insertTarget === v ? "selected" : ""}>${noLabel} ${escapeHtml(getUnitTitle(u).slice(0, 18))} の後</option>`;
    }),
  ].join("");

  container.innerHTML = `
    <div class="wd-workspace-toolbar" data-testid="wd-workspace-toolbar">
      <div class="wd-toolbar-group">
        ${
          !isMob
            ? `
              <div class="wd-filter-pill-group" role="group" aria-label="画面分割切替">
                <button type="button" class="wd-filter-pill ${state.pcSplitMode === "split" ? "active" : ""}" data-split="split" data-testid="wd-split-both">◫ デッキ＋DB</button>
                <button type="button" class="wd-filter-pill ${state.pcSplitMode === "deck" ? "active" : ""}" data-split="deck" data-testid="wd-split-deck">🎴 デッキのみ</button>
                <button type="button" class="wd-filter-pill ${state.pcSplitMode === "db" ? "active" : ""}" data-split="db" data-testid="wd-split-db">📚 DBのみ</button>
              </div>
            `
            : ""
        }
        <label class="wd-toggle-pill ${state.showInlinePoints ? "active" : ""}" title="各行に訓練ポイント（判定ポイント）を表示します">
          <input type="checkbox" id="wd-inline-points-chk" data-testid="wd-inline-points-chk" ${state.showInlinePoints ? "checked" : ""} />
          💡 訓練ポイント
        </label>
        <div class="wd-insert-target-bar" title="データベースから「＋追加」した際のデッキ挿入位置">
          <span>🎯 追加位置:</span>
          <select id="wd-insert-target-select" data-testid="wd-insert-target-select">${insertOptionsHtml}</select>
        </div>
      </div>
      <div class="wd-toolbar-group">
        <div class="wd-filter-pill-group" role="group" aria-label="サムネイルサイズ">
          <button type="button" class="wd-filter-pill ${state.cardSize === "sm" ? "active" : ""}" data-card-size="sm" data-testid="wd-size-sm">画像小</button>
          <button type="button" class="wd-filter-pill ${state.cardSize === "md" ? "active" : ""}" data-card-size="md" data-testid="wd-size-md">中</button>
          <button type="button" class="wd-filter-pill ${state.cardSize === "lg" ? "active" : ""}" data-card-size="lg" data-testid="wd-size-lg">大</button>
        </div>
        <button type="button" class="btn btn-xs btn-secondary" id="wd-autosort-btn" data-testid="wd-autosort-btn" title="時期・進行度・前提カード順に自動で並べ直します">📊 自動整列</button>
        <button type="button" class="btn btn-xs" id="wd-undo-btn" data-testid="wd-undo-btn" ${state.undoStack.length === 0 ? "disabled" : ""} title="直前の操作を元に戻します">↩ 元に戻す (${state.undoStack.length})</button>
      </div>
    </div>

    <div class="wd-dual-panes ${dualLayoutClass}">
      <section class="wd-pane wd-pane-deck" id="wd-pane-deck" data-testid="wd-pane-deck" style="${showDeckPane ? "" : "display:none;"}"></section>
      <section class="wd-pane wd-pane-db" id="wd-pane-db" data-testid="wd-pane-db" style="${showDbPane ? "" : "display:none;"}"></section>
    </div>
  `;

  container.querySelectorAll("[data-split]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pcSplitMode = btn.dataset.split;
      renderMainContent();
    });
  });
  container.querySelectorAll("[data-card-size]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cardSize = btn.dataset.cardSize;
      saveStateToLocalStorage();
      renderMainContent();
    });
  });
  const ptChk = container.querySelector("#wd-inline-points-chk");
  if (ptChk) {
    ptChk.addEventListener("change", (e) => {
      state.showInlinePoints = Boolean(e.target.checked);
      saveStateToLocalStorage();
      renderMainContent();
    });
  }
  const insSelect = container.querySelector("#wd-insert-target-select");
  if (insSelect) {
    insSelect.addEventListener("change", (e) => {
      state.insertTarget = e.target.value;
      renderMainContent();
    });
  }
  container.querySelector("#wd-autosort-btn").addEventListener("click", () => {
    autoSortCurrentDeck({ phaseFirst: state.phaseFirst });
  });
  container.querySelector("#wd-undo-btn").addEventListener("click", () => performUndo());

  if (showDeckPane) renderDeckPane(container.querySelector("#wd-pane-deck"));
  if (showDbPane) renderDatabasePane(container.querySelector("#wd-pane-db"));
}

// ----------------------------------------------------------------------------
// Left Pane: 現在のデッキ（単位リスト）
// ----------------------------------------------------------------------------
function renderDeckPane(deckPane) {
  if (!deckPane) return;
  const { stats, prereqIssues } = analyzeDeckState(state.deckCards);
  const units = getDeckUnits();
  const isMob = isMobileViewport();

  let issuesHtml = "";
  if (prereqIssues.size > 0) {
    issuesHtml = `
      <div class="wd-issues-banner" data-testid="wd-issues-banner">
        <div><strong>⚠️ ストーリー順序の確認:</strong> 先行イベント（前提カード）の未採用または順序逆転が ${prereqIssues.size}件 あります</div>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
          <button type="button" class="btn btn-xs btn-primary" id="wd-fix-prereq-btn" data-testid="wd-fix-prereq-btn">🔧 前提カードを追加・順序補正</button>
        </div>
      </div>
    `;
  }

  deckPane.innerHTML = `
    <div class="wd-pane-header">
      <h3 class="wd-pane-title">
        🎴 デッキ (${stats.total_cards}枚 / ${units.length}単位)
        <span style="font-size:0.76rem;font-weight:600;color:#475569;">
          ⚡${stats.events} ・ 🏠${stats.households}世帯（👤${stats.persons} 🐾${stats.pets}）
        </span>
      </h3>
      <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
        ${isMob ? `<button type="button" class="btn btn-xs btn-primary" id="wd-deck-goto-db-btn" data-testid="wd-deck-goto-db-btn">＋ DBから追加</button>` : ""}
        ${state.deckCards.length > 0 ? `<button type="button" class="btn btn-xs btn-danger" id="wd-clear-deck-btn" data-testid="wd-clear-deck-btn" title="デッキを空にします">🗑 全解除</button>` : ""}
      </div>
    </div>
    <div class="wd-list-hint">
      ${isMob ? "⠿ を押したまま上下にドラッグで移動" : "行をドラッグして移動（端に近づけると自動スクロール）"} ・ 「No.」に番号を入れると一気に移動 ・ 行をタップで詳細／画像をタップで拡大
    </div>
    <div class="wd-pane-scroll" id="wd-deck-scroll">
      ${issuesHtml}
      <ol class="wd-unit-list size-${escapeHtml(state.cardSize)}" id="wd-deck-unit-list" data-testid="wd-deck-unit-list"></ol>
    </div>
  `;

  const clearDeckBtn = deckPane.querySelector("#wd-clear-deck-btn");
  if (clearDeckBtn) {
    clearDeckBtn.addEventListener("click", () => {
      if (state.deckCards.length === 0) return;
      pushUndoSnapshot();
      for (const dc of state.deckCards) state.manuallyRemovedIds.add(dc.original_id);
      commitDeck([]);
      showToast("デッキのカードをすべて外しました（「元に戻す」で復元可能）", "info");
    });
  }
  const fixPreBtn = deckPane.querySelector("#wd-fix-prereq-btn");
  if (fixPreBtn) fixPreBtn.addEventListener("click", () => autoFixPrerequisiteIssues());

  const gotoDbBtn = deckPane.querySelector("#wd-deck-goto-db-btn");
  if (gotoDbBtn) {
    gotoDbBtn.addEventListener("click", () => {
      state.activeSection = "db";
      renderAll();
    });
  }

  const list = deckPane.querySelector("#wd-deck-unit-list");
  if (units.length === 0) {
    list.outerHTML = `
      <div class="empty-banner wd-deck-empty-drop" data-testid="wd-deck-empty">
        <p>デッキにカードがありません。「① 条件設定」から初期提案を行うか、データベースから追加（またはここへドラッグ）してください。</p>
      </div>
    `;
    return;
  }

  list.style.setProperty("--thumb-w", `${THUMB_WIDTH[state.cardSize] || THUMB_WIDTH.md}px`);
  const moving = state.movingUnitKey;

  for (const unit of units) {
    const first = unit.cards[0];
    const isMovingThis = moving === unit.key;
    const isExpanded = state.expandedUnitKey === unit.key;
    const isInsertAfter = state.insertTarget === `after:${unit.endNo}`;
    const issue = unit.cards.map((c) => prereqIssues.get(c.original_id)).find(Boolean);
    const noLabel =
      unit.startNo === unit.endNo
        ? `<b>${unit.startNo}</b>`
        : `<b>${unit.startNo}</b><small>〜${unit.endNo}</small>`;

    const li = document.createElement("li");
    li.className = [
      "wd-unit-row",
      `kind-${unit.kind}`,
      isMovingThis ? "is-moving-source" : "",
      isExpanded ? "is-expanded" : "",
      isInsertAfter ? "is-insert-target" : "",
      state.flashUnitKey === unit.key ? "is-flash" : "",
    ]
      .filter(Boolean)
      .join(" ");
    li.dataset.unitKey = unit.key;
    li.dataset.unitIndex = String(unit.index);
    li.dataset.startNo = String(unit.startNo);
    li.dataset.origIds = unit.cards.map((c) => c.original_id).join(",");
    li.setAttribute("data-testid", `wd-deck-unit-${unit.key}`);

    const actionsHtml =
      moving && !isMovingThis
        ? `
          <button type="button" class="wd-act-btn btn-place-here" data-action="place-before" data-testid="wd-place-before-${escapeHtml(unit.key)}">
            ⤵ ここ (No.${unit.startNo}) へ
          </button>
        `
        : `
          <button type="button" class="wd-act-btn wd-icon-btn" data-action="step-up" ${unit.index === 0 ? "disabled" : ""} title="1つ前へ">▲</button>
          <button type="button" class="wd-act-btn wd-icon-btn" data-action="step-down" ${unit.index === units.length - 1 ? "disabled" : ""} title="1つ後ろへ">▼</button>
          <span class="wd-jump" title="番号を入れて Enter（または→）で一気に移動">
            <input type="number" inputmode="numeric" min="1" max="${state.deckCards.length}" class="wd-jump-input" placeholder="No." data-testid="wd-jump-input-${escapeHtml(unit.key)}" />
            <button type="button" class="wd-act-btn wd-icon-btn" data-action="jump" data-testid="wd-jump-btn-${escapeHtml(unit.key)}">→</button>
          </span>
          <button type="button" class="wd-act-btn btn-move ${isMovingThis ? "active" : ""}" data-action="toggle-move" data-testid="wd-move-${escapeHtml(unit.key)}" title="移動元に選び、移動先の「ここへ」をタップ">
            ${isMovingThis ? "✕ 解除" : "⇅"}
          </button>
          <button type="button" class="wd-act-btn ${isInsertAfter ? "active" : ""}" data-action="set-insert-after" title="DBから追加する位置をこの後ろに設定">🎯</button>
          <button type="button" class="wd-act-btn btn-remove-deck" data-action="remove" data-testid="wd-remove-${escapeHtml(unit.key)}" title="${unit.kind === "household" ? "世帯ごとデッキから外す" : "デッキから外す"}">✕</button>
        `;

    li.innerHTML = `
      <div class="wd-unit-main">
        <button type="button" class="wd-drag-handle" data-drag-handle aria-label="ドラッグで移動" title="ドラッグで移動">⠿</button>
        <div class="wd-unit-no">No.${noLabel}</div>
        ${thumbHtml(unit)}
        <div class="wd-unit-body" data-action="toggle-expand">
          ${unitBodyHtml(unit, {
            mode: "deck",
            issuesText: issue ? issue.message : "",
            dbMembers: first.group_id ? state.dbCardsByGroupId.get(first.group_id) : null,
          })}
        </div>
        <div class="wd-unit-actions">${actionsHtml}</div>
      </div>
      ${isExpanded ? expandedHtml(unit, "deck") : ""}
    `;

    bindUnitThumb(li, unit, true);
    if (isExpanded) bindExpandedImages(li, unit, "deck");

    const jumpInput = li.querySelector(".wd-jump-input");
    const doJump = () => {
      if (!jumpInput || jumpInput.value === "") return;
      moveDeckUnitToCardNo(unit.key, Number(jumpInput.value));
    };
    if (jumpInput) {
      jumpInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doJump();
        }
      });
      jumpInput.addEventListener("click", (e) => e.stopPropagation());
    }

    li.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = el.dataset.action;
        if (act === "remove") removeCardFromDeck(first.original_id);
        else if (act === "zoom") openUnitZoom(unit, "deck");
        else if (act === "toggle-expand") {
          state.expandedUnitKey = isExpanded ? null : unit.key;
          renderDeckPaneKeepScroll();
        } else if (act === "step-up") stepMoveDeckUnit(unit.key, -1);
        else if (act === "step-down") stepMoveDeckUnit(unit.key, 1);
        else if (act === "jump") doJump();
        else if (act === "toggle-move") {
          state.movingUnitKey = isMovingThis ? null : unit.key;
          renderAll();
        } else if (act === "place-before") {
          if (state.movingUnitKey) moveDeckUnitTo(state.movingUnitKey, unit.index);
        } else if (act === "set-insert-after") {
          const v = `after:${unit.endNo}`;
          state.insertTarget = state.insertTarget === v ? "auto" : v;
          if (isMobileViewport() && state.insertTarget === v) {
            state.activeSection = "db";
            showToast(`追加位置を No.${unit.endNo} の後ろに設定しました。追加するカードを選んでください`, "info");
          }
          renderAll();
        }
      });
    });

    attachUnitDrag(li, { from: "deck", unitKey: unit.key, origId: first.original_id });
    list.appendChild(li);
  }

  // 移動直後の単位をハイライトして見える位置へ
  if (state.flashUnitKey) {
    const flashed = list.querySelector(".is-flash");
    if (flashed) {
      flashed.scrollIntoView({ block: "nearest" });
      setTimeout(() => flashed.classList.remove("is-flash"), 1600);
    }
    state.flashUnitKey = null;
  }
}

function renderDeckPaneKeepScroll() {
  const deckPane = document.getElementById("wd-pane-deck");
  if (!deckPane) return;
  const sc = document.getElementById("wd-deck-scroll");
  const top = sc ? sc.scrollTop : 0;
  renderDeckPane(deckPane);
  const sc2 = document.getElementById("wd-deck-scroll");
  if (sc2) sc2.scrollTop = top;
}

// ----------------------------------------------------------------------------
// Right Pane: データベース（単位リスト）
// ----------------------------------------------------------------------------
function buildDbUnits() {
  const inDeck = new Set(state.deckCards.map((c) => c.original_id));
  const deckNoById = new Map(state.deckCards.map((c) => [c.original_id, c.card_number]));
  const units = [];
  const seen = new Set();
  for (const e of state.allDbCards) {
    if (e.kind === "event") {
      units.push({ key: `E:${e.original_id}`, kind: "event", group_id: null, cards: [e] });
    } else if (e.group_id && !seen.has(e.group_id)) {
      seen.add(e.group_id);
      units.push({
        key: `G:${e.group_id}`,
        kind: "household",
        group_id: e.group_id,
        cards: state.dbCardsByGroupId.get(e.group_id) || [e],
      });
    }
  }
  for (const u of units) {
    const first = u.cards[0];
    u.cards.forEach((c) => {
      c.__inDeck = inDeck.has(c.original_id);
    });
    u.adoptedCount = u.cards.filter((c) => c.__inDeck).length;
    u.isAdopted = u.adoptedCount === u.cards.length;
    u.isPartial = u.adoptedCount > 0 && !u.isAdopted;
    u.deckNo = u.cards.map((c) => deckNoById.get(c.original_id)).find((n) => n);
    u.isManualRemoved =
      u.cards.some((c) => state.manuallyRemovedIds.has(c.original_id)) ||
      Boolean(u.group_id && state.manuallyRemovedIds.has(u.group_id));
    const target = u.kind === "event" ? first.data : first.group || first.data;
    const el = isEligible(target, state.conditions);
    u.isEligible = el.ok;
    u.reasons = el.reasons;
    u.hasPet = u.cards.some((c) => c.kind === "pet");
    u.hay = u.cards
      .flatMap((c) => [
        c.original_id,
        c.group_id || "",
        c.group_name || "",
        c.title || "",
        c.data.event_name || "",
        c.data.name || "",
        c.data.content || "",
        c.data.statement || "",
        c.data.appearance || "",
        c.data.scene_description || "",
        c.data.training_point || "",
        ...(c.data.category || []),
        ...(c.data.vulnerabilities || []),
        ...(c.data.health_condition || []),
        ...(c.data.skills || []),
      ])
      .join(" ")
      .toLowerCase();
  }
  return units;
}

function filterDbUnits(units) {
  const f = state.dbFilter;
  const q = f.query.trim().toLowerCase();
  return units.filter((u) => {
    if (f.status === "unadopted" && u.isAdopted) return false;
    if (f.status === "eligible" && (u.isAdopted || !u.isEligible)) return false;
    if (f.status === "manual" && (u.isAdopted || !u.isManualRemoved)) return false;
    if (f.status === "ineligible" && (u.isAdopted || u.isEligible)) return false;
    if (f.kind === "event" && u.kind !== "event") return false;
    if (f.kind === "household" && u.kind !== "household") return false;
    if (f.kind === "pet" && !u.hasPet) return false;
    const first = u.cards[0];
    if (f.timing && first.timing_label !== f.timing) return false;
    if (f.phase && first.phase_label !== f.phase) return false;
    if (q && !u.hay.includes(q)) return false;
    return true;
  });
}

function renderDatabasePane(dbPane) {
  if (!dbPane) return;
  const allUnits = buildDbUnits();
  const unadopted = allUnits.filter((u) => !u.isAdopted);
  const counts = {
    unadopted: unadopted.length,
    eligible: unadopted.filter((u) => u.isEligible).length,
    manual: unadopted.filter((u) => u.isManualRemoved).length,
    ineligible: unadopted.filter((u) => !u.isEligible).length,
    all: allUnits.length,
  };
  const f = state.dbFilter;
  if (!["all", "event", "household", "pet"].includes(f.kind)) f.kind = "all";

  const timingOptionsHtml =
    `<option value="">時期: すべて</option>` +
    RELATIVE_TIMING_LIST.map(
      (t) => `<option value="${escapeHtml(t)}" ${f.timing === t ? "selected" : ""}>${escapeHtml(t)}</option>`
    ).join("");
  const phaseOptionsHtml =
    `<option value="">進行度: すべて</option>` +
    DISASTER_PHASE_LIST.map(
      (p) => `<option value="${escapeHtml(p)}" ${f.phase === p ? "selected" : ""}>${escapeHtml(p)}</option>`
    ).join("");

  dbPane.innerHTML = `
    <div class="wd-pane-header">
      <h3 class="wd-pane-title" id="wd-db-title">📚 データベース</h3>
      ${
        isMobileViewport()
          ? `<button type="button" class="btn btn-xs btn-secondary" id="wd-db-back-deck-btn" data-testid="wd-db-back-deck-btn">← デッキ(${state.deckCards.length}枚)へ</button>`
          : `<span style="font-size:0.74rem;color:#64748b;">「＋追加」または左のデッキへドラッグ</span>`
      }
    </div>
    <div class="wd-db-filters">
      <div class="wd-db-filter-row">
        <input type="search" id="wd-db-search-input" class="wd-db-search-input" data-testid="wd-db-search-input"
          placeholder="🔍 名前・セリフ・訓練ポイント・ID・車椅子・ペット 等で検索..." value="${escapeHtml(f.query)}" />
        <select id="wd-db-timing-select" class="form-select form-input-sm" style="width:auto;" data-testid="wd-db-timing-select">${timingOptionsHtml}</select>
        <select id="wd-db-phase-select" class="form-select form-input-sm" style="width:auto;" data-testid="wd-db-phase-select">${phaseOptionsHtml}</select>
      </div>
      <div class="wd-db-filter-row" style="justify-content:space-between;">
        <div class="wd-filter-pill-group" role="group" aria-label="DB状態フィルタ">
          <button type="button" class="wd-filter-pill ${f.status === "unadopted" ? "active" : ""}" data-db-status="unadopted" data-testid="wd-db-status-unadopted">未採用 (${counts.unadopted})</button>
          <button type="button" class="wd-filter-pill ${f.status === "eligible" ? "active" : ""}" data-db-status="eligible" data-testid="wd-db-status-eligible">✅ 条件合致 (${counts.eligible})</button>
          <button type="button" class="wd-filter-pill ${f.status === "manual" ? "active" : ""}" data-db-status="manual" data-testid="wd-db-status-manual">✋ 手動除外 (${counts.manual})</button>
          <button type="button" class="wd-filter-pill ${f.status === "ineligible" ? "active" : ""}" data-db-status="ineligible" data-testid="wd-db-status-ineligible">⚠️ 条件外 (${counts.ineligible})</button>
          <button type="button" class="wd-filter-pill ${f.status === "all" ? "active" : ""}" data-db-status="all" data-testid="wd-db-status-all">全DB (${counts.all})</button>
        </div>
        <div class="wd-filter-pill-group" role="group" aria-label="DB種別フィルタ">
          <button type="button" class="wd-filter-pill ${f.kind === "all" ? "active" : ""}" data-db-kind="all" data-testid="wd-db-kind-all">すべて</button>
          <button type="button" class="wd-filter-pill ${f.kind === "event" ? "active" : ""}" data-db-kind="event" data-testid="wd-db-kind-event">⚡イベント</button>
          <button type="button" class="wd-filter-pill ${f.kind === "household" ? "active" : ""}" data-db-kind="household" data-testid="wd-db-kind-household">🏠世帯</button>
          <button type="button" class="wd-filter-pill ${f.kind === "pet" ? "active" : ""}" data-db-kind="pet" data-testid="wd-db-kind-pet">🐾ペット同行</button>
        </div>
      </div>
    </div>
    <div class="wd-pane-scroll" id="wd-db-scroll">
      <ol class="wd-unit-list size-${escapeHtml(state.cardSize)}" id="wd-db-unit-list" data-testid="wd-db-unit-list"></ol>
    </div>
  `;

  const listEl = dbPane.querySelector("#wd-db-unit-list");
  listEl.style.setProperty("--thumb-w", `${THUMB_WIDTH[state.cardSize] || THUMB_WIDTH.md}px`);
  const titleEl = dbPane.querySelector("#wd-db-title");

  const renderList = () => {
    const filtered = filterDbUnits(allUnits);
    titleEl.textContent = `📚 データベース (${filtered.length}件表示 / 未採用${counts.unadopted}件)`;
    renderDbUnitRows(listEl, filtered);
  };
  renderList();

  const backDeckBtn = dbPane.querySelector("#wd-db-back-deck-btn");
  if (backDeckBtn) {
    backDeckBtn.addEventListener("click", () => {
      state.activeSection = "deck";
      renderAll();
    });
  }
  dbPane.querySelector("#wd-db-search-input").addEventListener("input", (e) => {
    state.dbFilter.query = e.target.value;
    renderList();
  });
  dbPane.querySelector("#wd-db-timing-select").addEventListener("change", (e) => {
    state.dbFilter.timing = e.target.value;
    renderList();
  });
  dbPane.querySelector("#wd-db-phase-select").addEventListener("change", (e) => {
    state.dbFilter.phase = e.target.value;
    renderList();
  });
  dbPane.querySelectorAll("[data-db-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dbFilter.status = btn.dataset.dbStatus;
      renderDatabasePane(dbPane);
    });
  });
  dbPane.querySelectorAll("[data-db-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dbFilter.kind = btn.dataset.dbKind;
      renderDatabasePane(dbPane);
    });
  });
}

function renderDbUnitRows(listEl, units) {
  listEl.innerHTML = "";
  if (units.length === 0) {
    listEl.innerHTML = `<li class="empty-banner"><p>該当するカードがありません（検索条件・フィルタを変更してください）</p></li>`;
    return;
  }
  const isMob = isMobileViewport();
  for (const unit of units) {
    const first = unit.cards[0];
    const isExpanded = state.expandedDbKey === unit.key;
    const remaining = unit.cards.length - unit.adoptedCount;

    const li = document.createElement("li");
    li.className = [
      "wd-unit-row",
      "is-db",
      `kind-${unit.kind}`,
      unit.isAdopted ? "is-adopted" : "",
      isExpanded ? "is-expanded" : "",
    ]
      .filter(Boolean)
      .join(" ");
    li.dataset.unitKey = unit.key;
    li.dataset.origIds = unit.cards.map((c) => c.original_id).join(",");
    li.setAttribute("data-testid", `wd-db-unit-${unit.key}`);

    const statusBadge = unit.isAdopted
      ? `<span class="wd-mini-badge badge-eligible">採用中 No.${unit.deckNo}</span>`
      : unit.isPartial
        ? `<span class="wd-mini-badge badge-phase">一部採用 ${unit.adoptedCount}/${unit.cards.length}</span>`
        : unit.isManualRemoved
          ? `<span class="wd-mini-badge badge-phase">手動除外</span>`
          : unit.isEligible
            ? `<span class="wd-mini-badge badge-eligible">条件合致</span>`
            : `<span class="wd-mini-badge badge-reason" title="${escapeHtml(unit.reasons.join(", "))}">条件外: ${escapeHtml(unit.reasons[0] || "")}</span>`;

    const actionHtml = unit.isAdopted
      ? `<button type="button" class="wd-act-btn btn-remove-deck" data-action="remove" title="デッキから外す">✕ 外す</button>`
      : `<button type="button" class="wd-act-btn btn-add-deck" data-action="add" data-testid="wd-db-add-${escapeHtml(unit.key)}">
          ＋${unit.kind === "household" ? (unit.isPartial ? `残り${remaining}枚` : `世帯${unit.cards.length}枚`) : "追加"}
        </button>`;

    li.innerHTML = `
      <div class="wd-unit-main">
        ${!isMob && !unit.isAdopted ? `<button type="button" class="wd-drag-handle" data-drag-handle aria-label="ドラッグでデッキへ" title="ドラッグでデッキへ">⠿</button>` : `<span class="wd-drag-spacer"></span>`}
        ${thumbHtml(unit)}
        <div class="wd-unit-body" data-action="toggle-expand">
          <div class="wd-db-status-line">${statusBadge}</div>
          ${unitBodyHtml(unit, { mode: "db" })}
        </div>
        <div class="wd-unit-actions">${actionHtml}</div>
      </div>
      ${isExpanded ? expandedHtml(unit, "db") : ""}
    `;

    bindUnitThumb(li, unit, false);
    if (isExpanded) bindExpandedImages(li, unit, "db");

    li.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = el.dataset.action;
        if (act === "add") addCardFromDbToDeck(first.original_id);
        else if (act === "remove") {
          const inDeckCard = unit.cards.find((c) => c.__inDeck);
          if (inDeckCard) removeCardFromDeck(inDeckCard.original_id);
        } else if (act === "zoom") openUnitZoom(unit, "db");
        else if (act === "toggle-expand") {
          state.expandedDbKey = isExpanded ? null : unit.key;
          const sc = document.getElementById("wd-db-scroll");
          const top = sc ? sc.scrollTop : 0;
          renderDatabasePane(document.getElementById("wd-pane-db"));
          const sc2 = document.getElementById("wd-db-scroll");
          if (sc2) sc2.scrollTop = top;
        }
      });
    });

    if (!unit.isAdopted) {
      const addId = (unit.cards.find((c) => !c.__inDeck) || first).original_id;
      attachUnitDrag(li, { from: "db", unitKey: unit.key, origId: addId });
    }
    listEl.appendChild(li);
  }
}

// ----------------------------------------------------------------------------
// 拡大表示（イベント: 詳細モーダル / 世帯: メンバー全員のカードを並べて拡大）
// ----------------------------------------------------------------------------
function openUnitZoom(unit, mode) {
  if (unit.kind !== "household") {
    openCardDetailModal(unit.cards[0].original_id, mode === "deck");
    return;
  }
  closeModalIfPresent();
  const first = unit.cards[0];
  const dbMembers = state.dbCardsByGroupId.get(first.group_id) || unit.cards;
  const s = getHouseholdSummary(unit, dbMembers);
  const inDeckIds = new Set(state.deckCards.map((c) => c.original_id));
  const deckCardById = new Map(state.deckCards.map((c) => [c.original_id, c]));
  const cards = dbMembers.map((m) => deckCardById.get(m.original_id) || m);

  const backdrop = document.createElement("div");
  backdrop.id = "wd-modal-backdrop";
  backdrop.className = "wd-modal-backdrop";
  backdrop.setAttribute("data-testid", "wd-household-zoom-modal");
  backdrop.innerHTML = `
    <div class="wd-modal-dialog wd-hh-zoom-dialog">
      <div class="wd-modal-header">
        <div style="display:flex;flex-direction:column;gap:0.25rem;min-width:0;">
          <strong style="font-size:1.05rem;">🏠 ${escapeHtml(getUnitTitle(unit))} <span class="wd-card-orig-badge">${escapeHtml(first.group_id)}</span></strong>
          <div class="wd-hh-summary">
            <span class="wd-hh-comp">👤${dbMembers.filter((c) => c.kind !== "pet").length}名 🐾${dbMembers.filter((c) => c.kind === "pet").length}匹</span>
            ${s.grp.evacuation_origin ? `<span>避難元: ${escapeHtml(s.grp.evacuation_origin)}</span>` : ""}
            ${s.grp.urgency_level ? `<span>緊急度: ${escapeHtml(s.grp.urgency_level)}</span>` : ""}
            ${s.equip.length ? `<span>持参: ${escapeHtml(s.equip.join("・"))}</span>` : ""}
          </div>
        </div>
        <button type="button" class="btn btn-xs" data-close>✕ 閉じる</button>
      </div>
      <div class="wd-hh-zoom-grid">
        ${cards
          .map((c) => {
            const d = c.data || {};
            const inDeck = inDeckIds.has(c.original_id);
            return `
              <figure class="wd-hh-zoom-card ${inDeck ? "" : "is-out"}">
                <img data-orig="${escapeHtml(c.original_id)}" alt="" draggable="false" />
                <figcaption>
                  ${inDeck && c.card_number ? `<strong>No.${c.card_number}</strong> ` : `<span class="wd-mini-badge">デッキ外</span> `}
                  ${escapeHtml(d.name || c.original_id)} ${d.relationship ? `<small>（${escapeHtml(d.relationship)}）</small>` : ""}
                </figcaption>
                <div class="wd-expand-point">💡 ${escapeHtml(d.training_point || "（訓練ポイント記載なし）")}</div>
                ${
                  inDeck
                    ? `<button type="button" class="wd-act-btn" data-zoom-remove="${escapeHtml(c.original_id)}">このメンバーだけ外す</button>`
                    : `<button type="button" class="wd-act-btn btn-add-deck" data-zoom-add="${escapeHtml(c.original_id)}">このメンバーを追加</button>`
                }
              </figure>
            `;
          })
          .join("")}
      </div>
      <div class="wd-modal-footer">
        ${
          cards.some((c) => inDeckIds.has(c.original_id))
            ? `<button type="button" class="btn btn-sm btn-danger" data-zoom-remove-all>✕ 世帯ごとデッキから外す</button>`
            : ""
        }
        ${
          cards.some((c) => !inDeckIds.has(c.original_id))
            ? `<button type="button" class="btn btn-sm btn-primary" data-zoom-add-all>＋ 世帯（未採用分）をデッキに追加</button>`
            : ""
        }
        <button type="button" class="btn btn-sm" data-close>閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelectorAll("img[data-orig]").forEach((img) => {
    const c = cards.find((x) => x.original_id === img.dataset.orig);
    const inDeck = inDeckIds.has(c.original_id);
    const model = toCardRenderModel(c, c.group, {
      cardNumber: inDeck ? c.card_number : null,
      originalId: c.original_id,
    });
    if (model) bindCardCanvasImage(img, model, { showNumber: inDeck });
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModalIfPresent();
  });
  backdrop.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModalIfPresent));
  backdrop.querySelectorAll("[data-zoom-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      closeModalIfPresent();
      removeCardFromDeck(b.dataset.zoomRemove, { forceSingle: true });
    })
  );
  backdrop.querySelectorAll("[data-zoom-add]").forEach((b) =>
    b.addEventListener("click", () => {
      closeModalIfPresent();
      addCardFromDbToDeck(b.dataset.zoomAdd, { forceSingle: true });
    })
  );
  const remAll = backdrop.querySelector("[data-zoom-remove-all]");
  if (remAll) {
    remAll.addEventListener("click", () => {
      closeModalIfPresent();
      const c = cards.find((x) => inDeckIds.has(x.original_id));
      if (c) removeCardFromDeck(c.original_id);
    });
  }
  const addAll = backdrop.querySelector("[data-zoom-add-all]");
  if (addAll) {
    addAll.addEventListener("click", () => {
      closeModalIfPresent();
      addCardFromDbToDeck(first.original_id);
    });
  }
}

// ----------------------------------------------------------------------------
// ドラッグ＆ドロップ（Pointer Events: マウス・タッチ共通、自動スクロール付き）
// ----------------------------------------------------------------------------
const dragState = {
  pending: null,
  active: false,
  source: null,
  target: null,
  ghost: null,
  line: null,
  rowEl: null,
  x: 0,
  y: 0,
  rafId: 0,
};
let suppressClickUntil = 0;

document.addEventListener(
  "click",
  (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true
);

function attachUnitDrag(rowEl, source) {
  rowEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || dragState.active) return;
    const onHandle = e.target.closest("[data-drag-handle]");
    const interactive = e.target.closest("button, input, select, textarea, a, label");
    // タッチ・ペンはスクロールと競合しないよう ⠿ ハンドルからのみドラッグ開始
    if (e.pointerType !== "mouse" && !onHandle) return;
    if (!onHandle && interactive) return;
    if (onHandle) e.preventDefault();
    dragState.pending = { x: e.clientX, y: e.clientY, rowEl, source };
    window.addEventListener("pointermove", onUnitDragMove, { passive: false });
    window.addEventListener("pointerup", onUnitDragEnd);
    window.addEventListener("pointercancel", onUnitDragCancel);
  });
}

function beginUnitDrag() {
  const { rowEl, source } = dragState.pending;
  dragState.active = true;
  dragState.source = source;
  dragState.rowEl = rowEl;
  rowEl.classList.add("is-drag-source");
  document.body.classList.add("wd-dragging");

  const ghost = document.createElement("div");
  ghost.className = "wd-drag-ghost";
  const thumb = rowEl.querySelector(".wd-unit-thumb");
  const title = rowEl.querySelector(".wd-unit-title");
  ghost.innerHTML = `${thumb ? thumb.outerHTML : ""}<div class="wd-drag-ghost-title">${title ? title.innerHTML : ""}</div>`;
  const srcImg = rowEl.querySelector(".wd-thumb-img");
  const gImg = ghost.querySelector(".wd-thumb-img");
  if (srcImg && gImg) gImg.src = srcImg.src;
  document.body.appendChild(ghost);
  dragState.ghost = ghost;

  const line = document.createElement("div");
  line.className = "wd-drop-line";
  line.style.display = "none";
  document.body.appendChild(line);
  dragState.line = line;

  dragState.rafId = requestAnimationFrame(autoScrollTick);
}

function onUnitDragMove(e) {
  if (!dragState.pending && !dragState.active) return;
  dragState.x = e.clientX;
  dragState.y = e.clientY;
  if (!dragState.active) {
    const p = dragState.pending;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    beginUnitDrag();
  }
  e.preventDefault();
  if (dragState.ghost) {
    dragState.ghost.style.left = `${e.clientX + 14}px`;
    dragState.ghost.style.top = `${e.clientY - 18}px`;
  }
  updateUnitDropTarget();
}

function isPointInEl(el, x, y) {
  if (!el || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function updateUnitDropTarget() {
  const { x, y, source, line } = dragState;
  const deckPane = document.getElementById("wd-pane-deck");
  const dbPane = document.getElementById("wd-pane-db");
  dragState.target = null;
  if (line) line.style.display = "none";
  if (dbPane) dbPane.classList.remove("drag-over-pane");
  if (deckPane) deckPane.classList.remove("drag-over-pane");

  if (isPointInEl(deckPane, x, y)) {
    const list = document.getElementById("wd-deck-unit-list");
    const rows = list ? [...list.querySelectorAll(":scope > .wd-unit-row")] : [];
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    dragState.target = { type: "deck", index: idx };
    if (!list || rows.length === 0) {
      deckPane.classList.add("drag-over-pane");
      return;
    }
    const lr = list.getBoundingClientRect();
    const lineY =
      idx < rows.length
        ? rows[idx].getBoundingClientRect().top - 3
        : rows[rows.length - 1].getBoundingClientRect().bottom + 2;
    const fromIdx =
      source.from === "deck" ? rows.findIndex((r) => r.dataset.unitKey === source.unitKey) : -1;
    const noop = fromIdx >= 0 && (idx === fromIdx || idx === fromIdx + 1);
    const no = idx < rows.length ? Number(rows[idx].dataset.startNo) : state.deckCards.length + 1;
    line.style.display = "block";
    line.style.top = `${lineY}px`;
    line.style.left = `${lr.left}px`;
    line.style.width = `${lr.width}px`;
    line.classList.toggle("is-noop", noop);
    line.dataset.label = noop ? "（元の位置）" : `ここへ挿入 → No.${no}`;
  } else if (source.from === "deck" && isPointInEl(dbPane, x, y)) {
    dragState.target = { type: "remove" };
    dbPane.classList.add("drag-over-pane");
  }
}

function autoScrollTick() {
  if (!dragState.active) return;
  const { x, y } = dragState;
  const speed = (d) => Math.min(30, 4 + d * 0.4);
  let scrolled = false;
  for (const id of ["wd-deck-scroll", "wd-db-scroll"]) {
    const sc = document.getElementById(id);
    if (!sc || sc.offsetParent === null) continue;
    if (sc.scrollHeight <= sc.clientHeight + 2) continue;
    const r = sc.getBoundingClientRect();
    if (x < r.left || x > r.right) continue;
    const edge = 70;
    if (y < r.top + edge && y > r.top - 60) {
      sc.scrollTop -= speed(r.top + edge - y);
      scrolled = true;
    } else if (y > r.bottom - edge && y < r.bottom + 60) {
      sc.scrollTop += speed(y - (r.bottom - edge));
      scrolled = true;
    }
  }
  if (!scrolled) {
    const topEdge = 140;
    const bottomEdge = window.innerHeight - (isMobileViewport() ? 110 : 70);
    if (y < topEdge) {
      window.scrollBy(0, -speed(topEdge - y));
      scrolled = true;
    } else if (y > bottomEdge) {
      window.scrollBy(0, speed(y - bottomEdge));
      scrolled = true;
    }
  }
  if (scrolled) updateUnitDropTarget();
  dragState.rafId = requestAnimationFrame(autoScrollTick);
}

function cleanupUnitDrag() {
  window.removeEventListener("pointermove", onUnitDragMove);
  window.removeEventListener("pointerup", onUnitDragEnd);
  window.removeEventListener("pointercancel", onUnitDragCancel);
  if (dragState.rafId) cancelAnimationFrame(dragState.rafId);
  if (dragState.ghost) dragState.ghost.remove();
  if (dragState.line) dragState.line.remove();
  if (dragState.rowEl) dragState.rowEl.classList.remove("is-drag-source");
  document.body.classList.remove("wd-dragging");
  document
    .querySelectorAll(".drag-over-pane")
    .forEach((el) => el.classList.remove("drag-over-pane"));
  Object.assign(dragState, {
    pending: null,
    active: false,
    source: null,
    target: null,
    ghost: null,
    line: null,
    rowEl: null,
    rafId: 0,
  });
}

function onUnitDragEnd() {
  const wasActive = dragState.active;
  const target = dragState.target;
  const source = dragState.source;
  cleanupUnitDrag();
  if (!wasActive) return;
  suppressClickUntil = Date.now() + 350;
  if (!target || !source) return;
  if (target.type === "deck") {
    if (source.from === "deck") moveDeckUnitTo(source.unitKey, target.index);
    else addCardFromDbToDeck(source.origId, { insertAtUnitIndex: target.index });
  } else if (target.type === "remove" && source.from === "deck") {
    removeCardFromDeck(source.origId);
  }
}

function onUnitDragCancel() {
  cleanupUnitDrag();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dragState.active) cleanupUnitDrag();
});

// ----------------------------------------------------------------------------
// タップ移動モード用のフローティングバナー
// ----------------------------------------------------------------------------
function renderFloatingMoveBanner() {
  const existing = document.getElementById("wd-floating-move-banner");
  if (existing) existing.remove();
  if (!state.movingUnitKey) return;
  const unit = findDeckUnit(state.movingUnitKey);
  if (!unit) {
    state.movingUnitKey = null;
    return;
  }
  const banner = document.createElement("div");
  banner.id = "wd-floating-move-banner";
  banner.className = "wd-move-banner";
  banner.setAttribute("data-testid", "wd-floating-move-banner");
  banner.innerHTML = `
    <div class="wd-move-banner-text">
      🔄 <strong>${escapeHtml(unitLabel(unit))}</strong> を移動中 — 移動先の「⤵ ここへ」をタップ
    </div>
    <div class="wd-move-banner-actions">
      <button type="button" class="btn btn-xs btn-primary" id="wd-move-to-first-btn" data-testid="wd-move-to-first-btn">先頭へ</button>
      <button type="button" class="btn btn-xs btn-primary" id="wd-move-to-last-btn" data-testid="wd-move-to-last-btn">末尾へ</button>
      <button type="button" class="btn btn-xs btn-danger" id="wd-move-cancel-btn" data-testid="wd-move-cancel-btn">キャンセル</button>
    </div>
  `;
  document.body.appendChild(banner);
  banner.querySelector("#wd-move-to-first-btn").addEventListener("click", () => {
    moveDeckUnitTo(state.movingUnitKey, 0);
  });
  banner.querySelector("#wd-move-to-last-btn").addEventListener("click", () => {
    moveDeckUnitTo(state.movingUnitKey, getDeckUnits().length);
  });
  banner.querySelector("#wd-move-cancel-btn").addEventListener("click", () => {
    state.movingUnitKey = null;
    renderAll();
  });
}

// ----------------------------------------------------------------------------
// Section 4 & 5: ④ カード台帳・カード画像一覧エクスポート ＆ ⑤ カード台帳インポート
// ----------------------------------------------------------------------------
function renderExportAndLedgerSection(container) {
  const renderCards = getCurrentDeckRenderModels();
  const printSizeOptions = Object.entries(PRINT_SIZES)
    .map(
      ([k, v]) =>
        `<option value="${escapeHtml(k)}" ${state.selectedPrintSize === k ? "selected" : ""}>${escapeHtml(v.label)} (${v.cols}×${v.rows}/頁)</option>`
    )
    .join("");

  container.innerHTML = `
    <div class="wd-export-grid" data-testid="wd-export-section">
      <!-- 1. カード台帳のエクスポート -->
      <div class="wd-export-card">
        <h3>📋 ④ カード台帳のエクスポート</h3>
        <p>
          完成したデッキ（全${renderCards.length}枚）の11列カード台帳を CSV または印刷用画面として出力します。<br/>
          <strong>※ 出力した CSV / JSON は「⑤ カード台帳のインポート」からいつでも読み込んで編集を再開できます。</strong>
        </p>
        <div class="wd-export-card-actions">
          <button type="button" class="btn btn-primary btn-sm" id="wd-dl-csv-btn" data-testid="wd-dl-csv-btn">
            📥 カード台帳 CSV 保存 (.csv)
          </button>
          <button type="button" class="btn btn-secondary btn-sm" id="wd-print-ledger-btn" data-testid="wd-print-ledger-btn">
            🖨️ 台帳を印刷 / PDF
          </button>
          <button type="button" class="btn btn-sm" id="wd-dl-json-btn" data-testid="wd-dl-json-btn">
            📥 デッキ JSON 保存 (.json)
          </button>
        </div>
      </div>

      <!-- 2. カード画像一覧のエクスポート -->
      <div class="wd-export-card">
        <h3>🖼️ ④ カード画像一覧のエクスポート</h3>
        <p>
          連番（No.1〜No.${renderCards.length}）とイラストが合成された完成カード画像を、A4裁断線付きPDF または PNG画像のZIPとして一括ダウンロードします。
        </p>
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
          <label for="wd-print-size-select" style="font-size:0.78rem;font-weight:700;">PDF印刷サイズ:</label>
          <select id="wd-print-size-select" class="form-select form-input-sm" style="width:auto;" data-testid="wd-print-size-select">
            ${printSizeOptions}
          </select>
        </div>
        <div class="wd-export-card-actions">
          <button type="button" class="btn btn-primary btn-sm" id="wd-dl-pdf-btn" data-testid="wd-dl-pdf-btn">
            📄 カード画像一覧 PDF 保存
          </button>
          <button type="button" class="btn btn-secondary btn-sm" id="wd-dl-zip-btn" data-testid="wd-dl-zip-btn">
            🗂️ カード画像一覧 ZIP 保存
          </button>
          <span id="wd-export-progress-wrap" data-testid="wd-export-progress-wrap" style="display:none;align-items:center;gap:0.4rem;">
            <strong id="wd-export-progress-text">0 / 0</strong>
            <button type="button" class="btn btn-xs btn-danger" id="wd-cancel-export-btn">中断</button>
          </span>
        </div>
      </div>

      <!-- 3. カード台帳のインポート (⑤ 後からインポートして②から再開) -->
      <div class="wd-export-card">
        <h3>📂 ⑤ カード台帳のインポート（続きから再開）</h3>
        <p>
          以前エクスポートした「カード台帳 CSV (<code>hug_deck_cards.csv</code>)」または「デッキ JSON (<code>hug_deck.json</code>)」を読み込み、デッキを復元して②の編集から再開します。
        </p>
        <div class="wd-import-dropzone" id="wd-import-dropzone" data-testid="wd-import-dropzone">
          <div style="font-weight:700;color:#1e293b;margin-bottom:0.25rem;">
            📂 クリックしてファイルを選択、またはここへドロップ
          </div>
          <div style="font-size:0.76rem;color:#64748b;">
            対応形式: カード台帳 CSV (.csv) / デッキ JSON (.json)
          </div>
          <input
            type="file"
            id="wd-import-file-input"
            data-testid="wd-import-file-input"
            accept=".csv,.json,text/csv,application/json"
            style="display:none;"
          />
        </div>
      </div>
    </div>

    <!-- 台帳プレビュー ＆ カード画像一覧プレビュー切替 -->
    <div class="wd-pane" style="padding:1rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;margin-bottom:1rem;">
        <div class="wd-filter-pill-group">
          <button
            type="button"
            class="wd-filter-pill ${state.exportSubView === "ledger" ? "active" : ""}"
            id="wd-subview-ledger-btn"
            data-testid="wd-subview-ledger-btn"
          >
            📋 カード台帳テーブル (${renderCards.length}枚)
          </button>
          <button
            type="button"
            class="wd-filter-pill ${state.exportSubView === "images" ? "active" : ""}"
            id="wd-subview-images-btn"
            data-testid="wd-subview-images-btn"
          >
            🖼️ 完成カード画像一覧 (${renderCards.length}枚)
          </button>
        </div>

        ${
          state.exportSubView === "ledger"
            ? `
              <label class="wd-toggle-pill ${state.showLedgerPoints ? "active" : ""}">
                <input type="checkbox" id="wd-ledger-points-chk" data-testid="wd-ledger-points-chk" ${state.showLedgerPoints ? "checked" : ""} />
                💡 台帳の「判定ポイント」列を表示
              </label>
            `
            : ""
        }
      </div>

      <div id="wd-export-preview-body" data-testid="wd-export-preview-body"></div>
    </div>
  `;

  // Bind export buttons
  container.querySelector("#wd-dl-csv-btn").addEventListener("click", () => {
    if (state.deckCards.length === 0) {
      showToast("出力するカードがありません", "warning");
      return;
    }
    const blob = exportDeckToCardCsvBlob(state.deckCards);
    triggerBlobDownload(blob, "hug_deck_cards.csv");
    showToast("カード台帳 CSV (hug_deck_cards.csv) をダウンロードしました", "success");
  });

  container.querySelector("#wd-dl-json-btn").addEventListener("click", () => {
    if (state.deckCards.length === 0) {
      showToast("出力するカードがありません", "warning");
      return;
    }
    const blob = exportDeckToJsonBlob(state.deckCards, state.conditions);
    triggerBlobDownload(blob, "hug_deck.json");
    showToast("デッキ JSON (hug_deck.json) をダウンロードしました", "success");
  });

  container.querySelector("#wd-print-ledger-btn").addEventListener("click", () => {
    if (renderCards.length === 0) {
      showToast("印刷するカードがありません", "warning");
      return;
    }
    const cardsForPrint = state.showLedgerPoints
      ? renderCards
      : renderCards.map((c) => ({ ...c, points: "" }));
    printMasterLedger(cardsForPrint);
  });

  container.querySelector("#wd-print-size-select").addEventListener("change", (e) => {
    state.selectedPrintSize = e.target.value;
  });

  const progWrap = container.querySelector("#wd-export-progress-wrap");
  const progText = container.querySelector("#wd-export-progress-text");
  const cancelBtn = container.querySelector("#wd-cancel-export-btn");

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      if (state.activeExportSignal) state.activeExportSignal.cancelled = true;
    });
  }

  container.querySelector("#wd-dl-pdf-btn").addEventListener("click", async () => {
    if (renderCards.length === 0) {
      showToast("出力するカードがありません", "warning");
      return;
    }
    state.activeExportSignal = { cancelled: false };
    progWrap.style.display = "inline-flex";
    progText.textContent = `0 / ${renderCards.length}`;
    try {
      await exportCardsAsPdf(renderCards, state.selectedPrintSize, "standard", {
        download: true,
        filename: "hug-cards.pdf",
        signal: state.activeExportSignal,
        onProgress: (c, t) => {
          progText.textContent = `${c} / ${t}`;
        },
      });
      showToast("カード画像一覧 PDF (hug-cards.pdf) を出力しました", "success");
    } catch (err) {
      if (err && err.message === "CANCELLED") {
        showToast("PDF出力を中断しました", "info");
      } else {
        showToast((err && err.message) || "PDF出力に失敗しました", "error");
      }
    } finally {
      state.activeExportSignal = null;
      progWrap.style.display = "none";
    }
  });

  container.querySelector("#wd-dl-zip-btn").addEventListener("click", async () => {
    if (renderCards.length === 0) {
      showToast("出力するカードがありません", "warning");
      return;
    }
    state.activeExportSignal = { cancelled: false };
    progWrap.style.display = "inline-flex";
    progText.textContent = `0 / ${renderCards.length}`;
    try {
      await exportCardsAsZip(renderCards, "standard", {
        download: true,
        filename: "hug-cards.zip",
        signal: state.activeExportSignal,
        onProgress: (c, t) => {
          progText.textContent = `${c} / ${t}`;
        },
      });
      showToast("カード画像一覧 ZIP (hug-cards.zip) を出力しました", "success");
    } catch (err) {
      if (err && err.message === "CANCELLED") {
        showToast("ZIP出力を中断しました", "info");
      } else {
        showToast((err && err.message) || "ZIP出力に失敗しました", "error");
      }
    } finally {
      state.activeExportSignal = null;
      progWrap.style.display = "none";
    }
  });

  // Import dropzone & file input
  const dropzone = container.querySelector("#wd-import-dropzone");
  const fileInput = container.querySelector("#wd-import-file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImportLedgerFileObject(file);
  });
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportLedgerFileObject(file);
  });

  // Subview switcher
  container.querySelector("#wd-subview-ledger-btn").addEventListener("click", () => {
    state.exportSubView = "ledger";
    renderExportAndLedgerSection(container);
  });
  container.querySelector("#wd-subview-images-btn").addEventListener("click", () => {
    state.exportSubView = "images";
    renderExportAndLedgerSection(container);
  });

  const ledgerPtChk = container.querySelector("#wd-ledger-points-chk");
  if (ledgerPtChk) {
    ledgerPtChk.addEventListener("change", (e) => {
      state.showLedgerPoints = Boolean(e.target.checked);
      renderExportAndLedgerSection(container);
    });
  }

  // Preview body
  const previewBody = container.querySelector("#wd-export-preview-body");
  if (renderCards.length === 0) {
    previewBody.innerHTML = `<div class="empty-banner"><p>デッキにカードがありません</p></div>`;
  } else if (state.exportSubView === "ledger") {
    const displayCards = state.showLedgerPoints
      ? renderCards
      : renderCards.map((c) => ({ ...c, points: "（非表示）" }));
    previewBody.appendChild(renderMasterListElement(displayCards));
  } else {
    const grid = document.createElement("div");
    grid.className = "gen-cards-preview-grid";
    grid.setAttribute("data-testid", "wd-export-images-grid");
    for (const rc of renderCards) {
      const el = renderCardPreviewElement(rc, {
        designMode: "standard",
        showNumber: true,
        onClick: (card) => openCardDetailModal(card.original_id || card.id, true),
      });
      grid.appendChild(el);
    }
    previewBody.appendChild(grid);
  }
}

function getCurrentDeckRenderModels() {
  return state.deckCards
    .map((dc) =>
      toCardRenderModel(dc, dc.group, {
        cardNumber: dc.card_number,
      })
    )
    .filter(Boolean);
}

// ============================================================================
// ⑤ カード台帳ファイル (CSV / JSON) インポート処理 & モーダル
// ============================================================================

async function handleImportLedgerFileObject(file) {
  try {
    const text = await file.text();
    const res = importDeckFromLedgerFile(text, file.name, state.db);
    if (state.deckCards.length > 0) {
      pushUndoSnapshot();
    }
    state.deckCards = normalizeAndRenumber(res.deckCards);
    if (res.restoredConditions) {
      state.conditions = { ...state.conditions, ...res.restoredConditions };
    }
    state.movingUnitKey = null;
    saveStateToLocalStorage();

    // インポート完了後は②デッキ＆DBカード編集へ遷移して続きから作業可能にする
    state.activeSection = isMobileViewport() ? "deck" : "workspace";
    closeModalIfPresent();
    renderAll();

    showToast(
      `「${file.name}」から ${res.deckCards.length}枚のデッキを復元しました（DB照合:${res.matchedCount}枚）。このまま②で編集を続けられます`,
      "success"
    );
  } catch (err) {
    showToast((err && err.message) || "カード台帳のインポートに失敗しました", "error");
  }
}

function openImportLedgerModal() {
  closeModalIfPresent();
  const backdrop = document.createElement("div");
  backdrop.id = "wd-modal-backdrop";
  backdrop.className = "wd-modal-backdrop";
  backdrop.setAttribute("data-testid", "wd-import-modal");

  backdrop.innerHTML = `
    <div class="wd-modal-dialog" style="max-width:540px;">
      <div class="wd-modal-header">
        <h3 style="margin:0;font-size:1.05rem;">📂 ⑤ カード台帳のインポート（続きから再開）</h3>
        <button type="button" class="btn btn-xs" id="wd-modal-close-btn">✕ 閉じる</button>
      </div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:0.9rem;">
        <p style="margin:0;font-size:0.86rem;color:#334155;line-height:1.5;">
          エクスポートした <strong>カード台帳 CSV (<code>hug_deck_cards.csv</code>)</strong> または <strong>デッキ JSON (<code>hug_deck.json</code>)</strong> を選択してください。<br/>
          カードの並び順・抜き差し状態を復元し、データベースのカード画像と紐付けて<strong>「② デッキ＆DBカード編集」</strong>から作業を再開できます。
        </p>
        <div class="wd-import-dropzone" id="wd-modal-dropzone" data-testid="wd-modal-dropzone" style="padding:1.8rem 1rem;">
          <div style="font-size:1rem;font-weight:800;color:#1e293b;margin-bottom:0.35rem;">
            📥 ファイルを選択 または ここへドラッグ＆ドロップ
          </div>
          <div style="font-size:0.8rem;color:#64748b;">
            カード台帳 CSV (.csv) ／ デッキ JSON (.json)
          </div>
          <input
            type="file"
            id="wd-modal-file-input"
            data-testid="wd-modal-file-input"
            accept=".csv,.json,text/csv,application/json"
            style="display:none;"
          />
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModalIfPresent();
  });
  backdrop.querySelector("#wd-modal-close-btn").addEventListener("click", closeModalIfPresent);

  const dz = backdrop.querySelector("#wd-modal-dropzone");
  const fi = backdrop.querySelector("#wd-modal-file-input");
  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("drag-over");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImportLedgerFileObject(file);
  });
  fi.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportLedgerFileObject(file);
  });
}

// ============================================================================
// カード拡大・訓練ポイント・詳細確認モーダル
// ============================================================================

function closeModalIfPresent() {
  const el = document.getElementById("wd-modal-backdrop");
  if (el) el.remove();
}

function openCardDetailModal(origId, isInDeck = false) {
  closeModalIfPresent();
  const deckCard = state.deckCards.find((c) => c.original_id === origId);
  const dbEntry = state.dbCardByOrigId.get(origId) || deckCard;
  if (!dbEntry) return;

  const target = deckCard || dbEntry;
  const rec = target.data || {};
  const grp = target.group || null;
  const isEvent = target.kind === "event";
  const cardNo = deckCard ? deckCard.card_number : null;

  const renderModel = toCardRenderModel(rec, grp, {
    cardNumber: cardNo,
    originalId: origId,
  });

  const hhMembers = grp && target.group_id
    ? state.dbCardsByGroupId.get(target.group_id) || []
    : [];

  const backdrop = document.createElement("div");
  backdrop.id = "wd-modal-backdrop";
  backdrop.className = "wd-modal-backdrop";
  backdrop.setAttribute("data-testid", "wd-card-detail-modal");

  backdrop.innerHTML = `
    <div class="wd-modal-dialog">
      <div class="wd-modal-header">
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          ${cardNo ? `<span class="badge" style="background:#0f172a;color:#fff;font-weight:800;">No.${cardNo}</span>` : ""}
          <span class="wd-card-orig-badge">${escapeHtml(origId)}</span>
          <strong style="font-size:1.05rem;">${escapeHtml(target.title || origId)}</strong>
        </div>
        <button type="button" class="btn btn-xs" id="wd-detail-close-btn" data-testid="wd-detail-close-btn">✕ 閉じる</button>
      </div>

      <div class="wd-modal-body">
        <div>
          <div class="wd-card-img-wrap" style="border:1px solid #cbd5e1;border-radius:10px;">
            <img alt="${escapeHtml(target.title || origId)}" class="wd-card-img" id="wd-modal-card-img" />
          </div>
          <div style="margin-top:0.5rem;text-align:center;">
            <button type="button" class="btn btn-xs" id="wd-modal-dl-png-btn">⬇ このカードのPNG画像を保存</button>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.75rem;">
            <div style="font-weight:800;font-size:0.85rem;color:#92400e;margin-bottom:0.3rem;">
              💡 訓練ポイント（判定ポイント）
            </div>
            <div style="font-size:0.9rem;color:#451a03;line-height:1.5;" data-testid="wd-modal-training-point">
              ${escapeHtml(rec.training_point || "（記載なし）")}
            </div>
          </div>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.75rem;font-size:0.85rem;line-height:1.55;">
            ${
              isEvent
                ? `
                  <div><strong>イベント名:</strong> ${escapeHtml(rec.event_name || "-")}</div>
                  <div><strong>カテゴリ:</strong> ${escapeHtml((rec.category || []).join("、") || "-")}</div>
                  <div><strong>情報元:</strong> ${escapeHtml(rec.source || "-")} ／ <strong>優先度:</strong> ${escapeHtml(rec.priority ?? "-")} ／ <strong>難易度:</strong> ${escapeHtml(rec.difficulty || "-")}</div>
                  <div><strong>発生時期:</strong> ${escapeHtml((rec.relative_timing || []).join("・") || "中盤")} ／ <strong>進行度:</strong> ${escapeHtml((rec.disaster_phase || []).join("・") || "-")}</div>
                  ${rec.prerequisite_card_id ? `<div><strong>前提カード:</strong> ${escapeHtml(rec.prerequisite_card_id)}</div>` : ""}
                  <hr style="border:none;border-top:1px solid #e2e8f0;margin:0.5rem 0;" />
                  <div><strong>状況描写:</strong> ${escapeHtml(rec.scene_description || "-")}</div>
                  <div style="margin-top:0.35rem;"><strong>イベント内容:</strong><br/>${escapeHtml(rec.content || "-")}</div>
                `
                : `
                  <div><strong>世帯:</strong> ${escapeHtml(target.group_id || "-")} ${escapeHtml(target.group_name || "-")} （避難元: ${escapeHtml((grp && grp.evacuation_origin) || "-")} ／ 緊急度: ${escapeHtml((grp && grp.urgency_level) || "-")}）</div>
                  <div><strong>氏名:</strong> ${escapeHtml(rec.name || "-")} （${escapeHtml(rec.data_type || "人物")} ・ 年齢: ${escapeHtml(rec.age ?? "-")} ・ 性別: ${escapeHtml(rec.gender || "-")} ・ 続柄: ${escapeHtml(rec.relationship || "-")}）</div>
                  <div><strong>発生時期:</strong> ${escapeHtml(target.timing_label || "中盤")} ／ <strong>進行度:</strong> ${escapeHtml(target.phase_label || "-")}</div>
                  <hr style="border:none;border-top:1px solid #e2e8f0;margin:0.5rem 0;" />
                  <div><strong>容姿・様子:</strong> ${escapeHtml(rec.appearance || "-")}</div>
                  ${rec.statement ? `<div style="margin-top:0.35rem;"><strong>発言・セリフ:</strong><br/>${escapeHtml(rec.statement)}</div>` : ""}
                  ${
                    hhMembers.length > 1
                      ? `
                        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0.5rem 0;" />
                        <div><strong>同一世帯のメンバー (${hhMembers.length}枚組):</strong></div>
                        <ul style="margin:0.25rem 0 0 1.2rem;padding:0;">
                          ${hhMembers
                            .map(
                              (m) =>
                                `<li><strong>${escapeHtml(m.original_id)}</strong>: ${escapeHtml(m.title)} (${escapeHtml(m.data.relationship || m.data.data_type || "")})</li>`
                            )
                            .join("")}
                        </ul>
                      `
                      : ""
                  }
                `
            }
          </div>
        </div>
      </div>

      <div class="wd-modal-footer">
        ${
          deckCard
            ? `
              <button type="button" class="btn btn-sm btn-danger" id="wd-modal-remove-btn" data-testid="wd-modal-remove-btn">
                ✕ このカードをデッキから外す
              </button>
            `
            : `
              <button type="button" class="btn btn-sm btn-primary" id="wd-modal-add-btn" data-testid="wd-modal-add-btn">
                ＋ このカードをデッキに追加する
              </button>
            `
        }
        <button type="button" class="btn btn-sm" id="wd-modal-close-footer-btn">閉じる</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const modalImg = backdrop.querySelector("#wd-modal-card-img");
  if (modalImg && renderModel) {
    bindCardCanvasImage(modalImg, renderModel, {
      showNumber: Boolean(cardNo),
    });
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModalIfPresent();
  });
  backdrop.querySelector("#wd-detail-close-btn").addEventListener("click", closeModalIfPresent);
  backdrop.querySelector("#wd-modal-close-footer-btn").addEventListener("click", closeModalIfPresent);

  backdrop.querySelector("#wd-modal-dl-png-btn").addEventListener("click", async () => {
    if (!renderModel) return;
    const dataUrl = await generateCardImageCanvas(renderModel, "standard", {
      showNumber: Boolean(cardNo),
    });
    const a = document.createElement("a");
    a.download = `hug-card-${cardNo || origId}.png`;
    a.href = dataUrl;
    a.click();
  });

  const remBtn = backdrop.querySelector("#wd-modal-remove-btn");
  if (remBtn) {
    remBtn.addEventListener("click", () => {
      closeModalIfPresent();
      removeCardFromDeck(origId, { forceSingle: deckCard.kind !== "event" });
    });
  }

  const addBtn = backdrop.querySelector("#wd-modal-add-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      closeModalIfPresent();
      addCardFromDbToDeck(origId);
    });
  }
}

// ============================================================================
// アプリケーション起動・グローバルイベントバインド
// ============================================================================

async function initWebDeckApp() {
  const main = document.getElementById("wd-main");
  try {
    const db = await loadStaticDatabase();
    indexDatabase(db);

    const restored = restoreStateFromLocalStorage();
    if (!restored) {
      // 保存済みデッキがあれば最新（先頭）を初期ロード、なければデフォルト条件で初期提案
      const savedDecks = db.saved_decks || [];
      if (savedDecks.length > 0) {
        loadSavedDeckPreset(savedDecks[0]);
      } else {
        proposeDeckFromConditions({ notify: false });
      }
    } else {
      renderAll();
    }
  } catch (err) {
    if (main) {
      main.innerHTML = `
        <div class="validation-errors-box" style="margin:2rem auto;max-width:600px;">
          <h3>データベースの読み込みに失敗しました</h3>
          <p>${escapeHtml((err && err.message) || String(err))}</p>
        </div>
      `;
    }
    return;
  }

  // Header & Navigation click handlers
  document.querySelectorAll(".wd-step-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.dataset.section;
      if (sec) {
        state.activeSection = sec;
        renderAll();
      }
    });
  });

  document.querySelectorAll(".wd-mob-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.mobSection;
      if (target === "training") {
        launchTrainingMode();
        return;
      }
      state.activeSection = target;
      renderAll();
    });
  });

  const startTrainingBtn = document.getElementById("wd-open-training-btn");
  if (startTrainingBtn) {
    startTrainingBtn.addEventListener("click", () => launchTrainingMode());
  }

  const headerImportBtn = document.getElementById("wd-header-import-btn");
  if (headerImportBtn) {
    headerImportBtn.addEventListener("click", () => openImportLedgerModal());
  }

  const headerExportBtn = document.getElementById("wd-header-export-btn");
  if (headerExportBtn) {
    headerExportBtn.addEventListener("click", () => {
      state.activeSection = "export";
      renderAll();
    });
  }

  let lastIsMobile = isMobileViewport();
  window.addEventListener("resize", () => {
    const nowMobile = isMobileViewport();
    if (nowMobile !== lastIsMobile) {
      lastIsMobile = nowMobile;
      renderAll();
    }
  });
}

function launchTrainingMode() {
  if (!state.deckCards || state.deckCards.length === 0) {
    showToast("表示するカードがデッキにありません", "warning");
    return;
  }
  openTrainingView(state.deckCards);
}

document.addEventListener("DOMContentLoaded", initWebDeckApp);
