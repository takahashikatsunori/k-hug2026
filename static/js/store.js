/**
 * アプリケーション全体の状態ストア.
 */

export const store = {
  /** @type {Record<string, any> | null} */
  schema: null,
  /** @type {string} */
  activeTab: "list",

  // 検索・一覧の状態
  searchQuery: {
    view: "all",
    keyword: "",
    fields: [],
    training: null,
    sort: "deck",
  },
  /** @type {Record<string, any> | null} */
  lastSearchResult: null,
  /** @type {Record<string, number>} */
  totalCounts: { events: 0, households: 0, persons: 0, pets: 0, units: 0 },

  // エディタの状態
  editorMode: "event", // "event" | "household"
  /** @type {string | null} */
  editingId: null,

  // デッキ構築の状態
  deckConditions: {
    disaster_type: "地震",
    shelter: "小平第五小学校",
    date: "",
    holiday_type: [],
    time_slot: "",
    infrastructure: [],
    weather: [],
    disaster_phase: [],
    max_events: "",
    max_households: "",
  },
  deckResolutions: {},
  /** @type {string[] | null} */
  deckManualOrder: null,
  deckPhaseFirst: false,
  /** @type {Record<string, any> | null} */
  currentDeck: null,
  /** @type {Record<string, any> | null} */
  loadedSavedDeckNotice: null,

  // イラスト・カード出力設定の状態
  /** @type {Set<string>} */
  imageIds: new Set(),
  /** @type {Record<string, string>} */
  imageCacheBust: {},
  /** @type {'standard' | 'largeText'} */
  cardDesignMode: "standard",
  /** @type {string} */
  printSizeId: "4.5x6.5",
  /** @type {'units' | 'cards' | 'ledger'} */
  deckViewSubMode: "units",

  updateImageStatus(statusData) {
    if (!statusData) return;
    if (Array.isArray(statusData)) {
      this.imageIds = new Set(statusData);
      return;
    }
    this.imageIds = new Set(statusData.image_ids || []);
    const bust = { ...this.imageCacheBust };
    for (const c of statusData.cards || []) {
      if (c.original_id && c.imageSha256) {
        bust[c.original_id] = String(c.imageSha256).slice(0, 10);
      }
    }
    this.imageCacheBust = bust;
  },

  markImageUpdated(cardId) {
    if (!cardId) return;
    this.imageIds.add(cardId);
    this.imageCacheBust[cardId] = String(Date.now());
  },

  markImageDeleted(cardId) {
    if (!cardId) return;
    this.imageIds.delete(cardId);
    delete this.imageCacheBust[cardId];
  },

  // イベントリスナー
  _listeners: new Set(),

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  notify(reason = "update") {
    for (const fn of this._listeners) {
      fn(reason, this);
    }
  },
};
