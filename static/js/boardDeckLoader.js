/**
 * 台紙配置シミュレーション用: カードDB・デッキ・台紙マニフェストの読み込みユーティリティ.
 * （trainingApp.js / hugGameApp.js と同じデッキ読込ロジックを UI 非依存の関数として提供）
 */
import { store } from "./store.js";
import { computeGroupPositionsByIndex } from "./cardCanvas.js";
import {
  buildAllDatabaseCardEntries,
  buildInitialDeck,
  importDeckFromJsonText,
  renumberDeckCards,
} from "./webDeckEngine.js";

export const LOCAL_WEB_DECK_KEY = "hug_web_deck_state_v1";

/**
 * カードDBの共通コンテキスト（スキーマ・イラスト解決関数）を store に設定する.
 * @param {Record<string, any>} db
 */
export function initDatabaseContext(db) {
  if (!db) return;
  store.schema = db.schema || {};
  store.imageIds = new Set(db.image_ids || []);
  const imageMeta = db.image_meta || {};
  store.resolveImageUrl = (origId, ver = "") => {
    const meta = imageMeta[origId];
    const ext = (meta && meta.ext) || ".png";
    const q = ver ? `?v=${encodeURIComponent(ver)}` : "";
    return `./data/images/${encodeURIComponent(origId)}${ext}${q}`;
  };
}

/** @returns {Promise<Record<string, any> | null>} */
export async function loadCardDatabase() {
  for (const url of ["./data/cards_db.json", "/data/cards_db.json"]) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) {
        const db = await res.json();
        initDatabaseContext(db);
        return db;
      }
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

export const DEFAULT_BOARD_ID = "kodaira_dai5_es_1sheet";

/** デフォルト台紙（小平第五小学校 見取り図・凡例）を解決する. */
export function resolveDefaultBoard(boards) {
  if (!Array.isArray(boards) || boards.length === 0) return null;
  return boards.find((b) => b.id === DEFAULT_BOARD_ID) || boards[0];
}

/** 台紙マニフェスト (static/boards/boards.json) を読み込む. */
export async function loadBoardManifest() {
  try {
    const res = await fetch("./static/boards/boards.json", { cache: "no-cache" });
    if (res.ok) {
      const json = await res.json();
      const list = Array.isArray(json) ? json : json.boards;
      if (Array.isArray(list) && list.length > 0) {
        return list.map((b) => ({
          ...b,
          url: b.url || `./static/boards/${b.file}`,
          page: Number(b.page) || 1,
        }));
      }
    }
  } catch {
    // フォールバック
  }
  return [
    {
      id: DEFAULT_BOARD_ID,
      name: "小平第五小学校 見取り図・凡例（1:200・1枚）",
      file: "kodaira_dai5_es_floorplan_hug_1sheet.pdf",
      url: "./static/boards/kodaira_dai5_es_floorplan_hug_1sheet.pdf",
      page: 1,
    },
  ];
}

function shouldQueryServerApi() {
  const host = String(window.location?.hostname || "").toLowerCase();
  return !host.endsWith(".github.io");
}

function annotateDeckGroupPositions(cards) {
  const posList = computeGroupPositionsByIndex(cards);
  return (cards || []).map((c, idx) => {
    const pos = posList[idx];
    if (!pos) return c;
    return { ...c, group_index: pos.group_index, group_total: pos.group_total };
  });
}

/**
 * サーバー保存デッキ（API）と cards_db.json 内の保存済みデッキを統合した一覧.
 * @param {Record<string, any> | null} db
 */
export async function fetchSavedDecks(db) {
  const staticDecks = Array.isArray(db?.saved_decks)
    ? db.saved_decks.map((d) => ({ ...d, _fromApi: false }))
    : [];
  let apiDecks = [];
  if (shouldQueryServerApi()) {
    try {
      const res = await fetch("/api/decks", { cache: "no-cache" });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) apiDecks = list.map((d) => ({ ...d, _fromApi: true }));
      }
    } catch {
      // 静的 JSON にフォールバック
    }
  }
  const merged = [...apiDecks];
  const seenNames = new Set(apiDecks.map((d) => String(d.name || "").trim()));
  const seenIds = new Set(apiDecks.map((d) => String(d.id)));
  for (const sd of staticDecks) {
    const name = String(sd.name || "").trim();
    if (seenNames.has(name)) continue;
    const id = seenIds.has(String(sd.id)) ? `static-${sd.id}` : sd.id;
    merged.push({ ...sd, id, _fromApi: false });
  }
  return merged;
}

/**
 * 保存済みデッキからカード配列を構築する.
 * @returns {Promise<{ title: string, cards: any[] }>}
 */
export async function buildDeckFromSaved(db, deckList, deckId) {
  const known = (deckList || []).find((d) => String(d.id) === String(deckId));
  let detail = null;
  let fromServer = false;
  if (shouldQueryServerApi() && (!known || known._fromApi)) {
    try {
      const res = await fetch(`/api/decks/${deckId}`, { cache: "no-cache" });
      if (res.ok) {
        detail = await res.json();
        fromServer = true;
      }
    } catch {
      // フォールバック
    }
  }
  if (!detail && known) detail = known;
  if (!detail) throw new Error("保存デッキ情報を取得できませんでした");

  const cond = detail.conditions || {};
  let cards = null;
  if (fromServer) {
    try {
      const res = await fetch("/api/deck/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions: cond,
          resolutions: detail.resolutions || {},
          manual_order: detail.manual_order || null,
          excluded_ids: Array.isArray(cond.excluded_ids) ? cond.excluded_ids : [],
        }),
      });
      if (res.ok) {
        const built = await res.json();
        const raw = built.deck?.cards || built.cards || [];
        if (raw.length > 0) {
          cards = annotateDeckGroupPositions(
            raw.map((c, i) => ({
              card_number: c.card_number || i + 1,
              original_id: c.original_id || c.card_id,
              kind: c.kind,
              data: c.data || c,
              group: c.group
                ? { ...c.group, group_id: c.new_group_id || c.group.group_id || c.group_id }
                : null,
              group_id: c.new_group_id || c.group_id,
              group_name: c.group_name,
              group_index: c.group_index,
              group_total: c.group_total,
            }))
          );
        }
      }
    } catch {
      // クライアント側構築へ
    }
  }
  if ((!cards || cards.length === 0) && db) {
    const built = buildInitialDeck(db, cond, {
      phaseFirst: false,
      resolutions: detail.resolutions || {},
      manualOrder: detail.manual_order || null,
      excludedIds: Array.isArray(cond.excluded_ids) ? cond.excluded_ids : [],
    });
    cards = built.cardEntries || [];
  }
  if (!cards || cards.length === 0) throw new Error("デッキにカードがありません");
  return { title: detail.name || `保存デッキ #${deckId}`, cards };
}

export function hasLocalWebDeck() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_WEB_DECK_KEY) || "null");
    return Boolean(saved && Array.isArray(saved.cardOrigIds) && saved.cardOrigIds.length > 0);
  } catch {
    return false;
  }
}

/** Webデッキツールで編集中のデッキ（localStorage）からカード配列を構築する. */
export function buildDeckFromLocalWebDeck(db) {
  const saved = JSON.parse(localStorage.getItem(LOCAL_WEB_DECK_KEY) || "null");
  if (!saved || !Array.isArray(saved.cardOrigIds) || saved.cardOrigIds.length === 0) {
    throw new Error("ブラウザに保存された編集中デッキがありません");
  }
  if (!db) throw new Error("カードデータベースを読み込めませんでした");
  const byId = new Map(buildAllDatabaseCardEntries(db).map((c) => [c.original_id, c]));
  const overrides = saved.originOverrides || saved.conditions?.origin_overrides || {};
  const entries = [];
  for (const oid of saved.cardOrigIds) {
    const e = byId.get(String(oid));
    if (!e) continue;
    const d = structuredClone(e.data);
    const grp = e.group ? structuredClone(e.group) : null;
    const ov = overrides[String(e.group_id)];
    if (ov) {
      if (grp) grp.evacuation_origin = ov;
      if (d) d.evacuation_origin = ov;
    }
    entries.push({
      original_id: e.original_id,
      kind: e.kind,
      unit_id: e.unit_id,
      group_id: e.group_id,
      group_name: e.group_name,
      data: d,
      group: grp,
    });
  }
  if (entries.length === 0) throw new Error("有効なカードが見つかりませんでした");
  return { title: "Webツール編集中デッキ", cards: renumberDeckCards(entries, db) };
}

/** デッキJSONテキストからカード配列を構築する. */
export function buildDeckFromJsonText(db, text, fileName = "JSONデッキ") {
  let cards = [];
  if (db) {
    cards = importDeckFromJsonText(text, db)?.deckCards || [];
  } else {
    const parsed = JSON.parse(text);
    const raw = parsed.cards || parsed.deck_cards || [];
    cards = annotateDeckGroupPositions(
      raw.map((c, i) => {
        const d = c.data || c;
        const grp = c.group || null;
        return {
          card_number: c.card_number || i + 1,
          original_id: c.card_id || c.original_id || d.member_id || `C-${i + 1}`,
          kind: c.kind || (c.event_id ? "event" : d.data_type === "ペット" ? "pet" : "person"),
          data: d,
          group_id: c.group_id || d.group_id || grp?.group_id || null,
          group_name: c.group_name || grp?.group_name || null,
          group: grp,
        };
      })
    );
  }
  if (!cards || cards.length === 0) throw new Error("有効なカードが見つかりませんでした");
  return { title: String(fileName).replace(/\.json$/i, ""), cards };
}

/** デッキ構成の集計. */
export function summarizeDeck(cards) {
  const list = cards || [];
  const events = list.filter((c) => c.kind === "event").length;
  const households = new Set(list.filter((c) => c.kind !== "event" && c.group_id).map((c) => c.group_id)).size;
  const persons = list.filter((c) => c.kind === "person").length;
  const pets = list.filter((c) => c.kind === "pet").length;
  return { total: list.length, events, households, persons, pets };
}
