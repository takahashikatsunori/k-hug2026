/**
 * マルチユーザーリアルタイム同期アダプター.
 *
 * - firebaseConfig.js に有効な Firebase 設定がある場合は Firebase Realtime Database を使用。
 * - 未設定または ?localSync=1 の場合は、同一ブラウザ内でのマルチタブ同期
 *   (BroadcastChannel + localStorage) にフォールバックし、オフライン/E2Eテストでも動作する。
 *
 * 通信量最適化:
 * - ルーム作成時に保存した cards（数百KB）は購読初回に1回のみ取得してメモリキャッシュし、
 *   リアルタイム監視は軽量な facilitator と groups（または指定 groupId）のみを購読する。
 * - カード移動/配置/戻し時は事前 getRoom() を行わず、マルチパス update で差分のみ送信する。
 */
import { FIREBASE_CONFIG, isFirebaseConfigured } from "./firebaseConfig.js";

const LOCAL_STORAGE_KEY = "hug_coop_rooms_v1";
const ADMIN_HISTORY_KEY = "hug_coop_admin_history_v1";
const BC_CHANNEL_NAME = "hug_coop_sync_v1";
const FIREBASE_SDK_VER = "10.14.1";

export function roundCoord(v) {
  return Math.round(Number(v) * 10) / 10;
}

function toArray(val) {
  if (Array.isArray(val)) return val.filter((v) => v !== null && v !== undefined);
  if (val && typeof val === "object") {
    return Object.keys(val)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => val[k])
      .filter((v) => v !== null && v !== undefined);
  }
  return [];
}

function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(ADMIN_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(list) {
  try {
    localStorage.setItem(ADMIN_HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore storage quota errors
  }
}

function upsertLocalHistoryEntry(entry) {
  const list = loadLocalHistory().filter((x) => x && x.id !== entry.id);
  list.unshift(entry);
  saveLocalHistory(list);
}

function removeLocalHistoryEntry(roomId) {
  saveLocalHistory(loadLocalHistory().filter((x) => x && x.id !== roomId));
}

function normalizeGroup(gid, g) {
  return {
    id: g?.id || gid,
    name: g?.name || gid,
    hand: toArray(g?.hand).map(Number),
    placed: g?.placed && typeof g.placed === "object" ? g.placed : {},
    locks: g?.locks && typeof g.locks === "object" ? g.locks : {},
    members: g?.members && typeof g.members === "object" ? g.members : {},
    z: Number(g?.z) || 1,
    updatedAt: Number(g?.updatedAt) || 0,
  };
}

/** Firebase Realtime Database が空配列や連番オブジェクトを返しても安全に正規化する. */
export function normalizeRoom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const groups = {};
  const rawGroups = raw.groups && typeof raw.groups === "object" ? raw.groups : {};
  for (const [gid, g] of Object.entries(rawGroups)) {
    if (!g || typeof g !== "object") continue;
    groups[gid] = normalizeGroup(gid, g);
  }
  return {
    id: raw.id || "",
    meta: raw.meta || {},
    cards: toArray(raw.cards),
    facilitator: {
      dealtCount: Number(raw.facilitator?.dealtCount) || 0,
      message: String(raw.facilitator?.message || ""),
      messageAt: Number(raw.facilitator?.messageAt) || 0,
      timer: {
        running: Boolean(raw.facilitator?.timer?.running),
        endsAt: Number(raw.facilitator?.timer?.endsAt) || 0,
        remainSec: Number(raw.facilitator?.timer?.remainSec) || 0,
      },
    },
    groups,
  };
}

function buildSummaryFromRoom(roomId, data) {
  const meta = data?.meta || {};
  const groups = data?.groups || {};
  return {
    id: roomId,
    title: meta.title || roomId,
    deckTitle: meta.deckTitle || "",
    sizeId: meta.sizeId || "8x",
    groupCount: Object.keys(groups).length,
    createdAt: Number(meta.createdAt) || Date.now(),
  };
}

class LocalSyncAdapter {
  constructor() {
    this.mode = "local";
    this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BC_CHANNEL_NAME) : null;
    this.listeners = new Map();
    if (this.bc) {
      this.bc.onmessage = (ev) => {
        const roomId = ev.data?.roomId;
        if (roomId) this._notify(roomId);
      };
    }
    window.addEventListener("storage", (ev) => {
      if (ev.key === LOCAL_STORAGE_KEY) {
        for (const roomId of this.listeners.keys()) this._notify(roomId);
      }
    });
  }

  _readAll() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _writeAll(all, notifyRoomId = null) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
    } catch {
      const entries = Object.entries(all).sort(
        (a, b) => (b[1]?.meta?.createdAt || 0) - (a[1]?.meta?.createdAt || 0)
      );
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 5))));
    }
    if (notifyRoomId) {
      this._notify(notifyRoomId);
      if (this.bc) this.bc.postMessage({ roomId: notifyRoomId });
    }
  }

  _notify(roomId) {
    const subs = this.listeners.get(roomId);
    if (!subs || subs.size === 0) return;
    const room = normalizeRoom(this._readAll()[roomId]);
    for (const fn of subs) fn(room);
  }

  async createRoom(roomId, data) {
    const all = this._readAll();
    all[roomId] = { ...data, id: roomId };
    this._writeAll(all, roomId);
    upsertLocalHistoryEntry(buildSummaryFromRoom(roomId, data));
    return normalizeRoom(all[roomId]);
  }

  async getRoom(roomId) {
    return normalizeRoom(this._readAll()[roomId]);
  }

  async listRooms() {
    const all = this._readAll();
    const byId = new Map();
    for (const h of loadLocalHistory()) {
      if (h?.id && all[h.id]) byId.set(h.id, h);
    }
    for (const [id, r] of Object.entries(all)) {
      if (!byId.has(id)) byId.set(id, buildSummaryFromRoom(id, r));
    }
    return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async deleteRoom(roomId) {
    const all = this._readAll();
    delete all[roomId];
    this._writeAll(all, roomId);
    removeLocalHistoryEntry(roomId);
  }

  async clearRoomHistory() {
    this._writeAll({});
    saveLocalHistory([]);
  }

  subscribeRoom(roomId, fn) {
    if (!this.listeners.has(roomId)) this.listeners.set(roomId, new Set());
    this.listeners.get(roomId).add(fn);
    Promise.resolve().then(() => fn(normalizeRoom(this._readAll()[roomId])));
    return () => {
      const set = this.listeners.get(roomId);
      if (set) set.delete(fn);
    };
  }

  async updateFacilitator(roomId, patch) {
    const all = this._readAll();
    const room = all[roomId];
    if (!room) return;
    room.facilitator = { ...(room.facilitator || {}), ...patch };
    this._writeAll(all, roomId);
  }

  async dealCardsToAllGroups(roomId, cardIndices, newDealtCount) {
    const all = this._readAll();
    const room = all[roomId];
    if (!room) return;
    room.facilitator = { ...(room.facilitator || {}), dealtCount: newDealtCount };
    for (const g of Object.values(room.groups || {})) {
      const hand = toArray(g.hand).map(Number);
      const existing = new Set([...hand, ...Object.keys(g.placed || {}).map(Number)]);
      for (const idx of cardIndices) {
        if (!existing.has(idx)) {
          hand.push(idx);
          existing.add(idx);
        }
      }
      g.hand = hand;
      g.updatedAt = Date.now();
    }
    this._writeAll(all, roomId);
  }

  async joinGroup(roomId, groupId, memberId, nickname) {
    const all = this._readAll();
    const room = all[roomId];
    if (!room?.groups?.[groupId]) return;
    room.groups[groupId].members = room.groups[groupId].members || {};
    room.groups[groupId].members[memberId] = { name: nickname, lastSeen: Date.now() };
    this._writeAll(all, roomId);
  }

  async placeOrMoveCard(roomId, groupId, cardIdx, posObj, nextHandOrNull, nextZ) {
    const all = this._readAll();
    const g = all[roomId]?.groups?.[groupId];
    if (!g) return;
    g.placed = g.placed || {};
    g.placed[String(cardIdx)] = {
      x: roundCoord(posObj.x),
      y: roundCoord(posObj.y),
      z: Number(nextZ) || 1,
      by: posObj.by || "",
    };
    if (nextHandOrNull !== null && nextHandOrNull !== undefined) {
      g.hand = nextHandOrNull;
    }
    g.z = Number(nextZ) || g.z || 1;
    g.updatedAt = Date.now();
    this._writeAll(all, roomId);
  }

  async returnCard(roomId, groupId, cardIdx, nextHand) {
    const all = this._readAll();
    const g = all[roomId]?.groups?.[groupId];
    if (!g) return;
    if (g.placed) delete g.placed[String(cardIdx)];
    g.hand = nextHand;
    g.updatedAt = Date.now();
    this._writeAll(all, roomId);
  }

  async updateGroupBoard(roomId, groupId, patch) {
    const all = this._readAll();
    const g = all[roomId]?.groups?.[groupId];
    if (!g) return;
    if (patch.hand !== undefined) g.hand = patch.hand;
    if (patch.placed !== undefined) g.placed = patch.placed;
    if (patch.z !== undefined) g.z = patch.z;
    g.updatedAt = Date.now();
    this._writeAll(all, roomId);
  }

  async setCardLock(roomId, groupId, cardIdx, lockOrNull) {
    const all = this._readAll();
    const g = all[roomId]?.groups?.[groupId];
    if (!g) return;
    g.locks = g.locks || {};
    if (lockOrNull) g.locks[String(cardIdx)] = lockOrNull;
    else delete g.locks[String(cardIdx)];
    this._writeAll(all, roomId);
  }
}

class FirebaseSyncAdapter {
  constructor(fbApp, dbMod) {
    this.mode = "firebase";
    this.db = dbMod.getDatabase(fbApp);
    this.m = dbMod;
    this.roomStaticCache = new Map(); // roomId -> { meta, cards }
  }

  _ref(path) {
    return path ? this.m.ref(this.db, path) : this.m.ref(this.db);
  }

  async createRoom(roomId, data) {
    // Firebase は undefined 値を含むオブジェクトを拒否するため JSON ラウンドトリップで除去する
    const payload = JSON.parse(JSON.stringify({ ...data, id: roomId }));
    const summary = buildSummaryFromRoom(roomId, payload);
    await this.m.set(this._ref(`rooms/${roomId}`), payload);
    try {
      await this.m.set(this._ref(`roomIndex/${roomId}`), summary);
    } catch {
      // roomIndex 権限が制限されていても本体とローカル履歴で運用継続する
    }
    this.roomStaticCache.set(roomId, {
      meta: payload.meta,
      cards: toArray(payload.cards),
    });
    upsertLocalHistoryEntry(summary);
    return normalizeRoom(payload);
  }

  async getRoom(roomId) {
    const cached = this.roomStaticCache.get(roomId);
    if (cached) {
      const [facSnap, grpSnap] = await Promise.all([
        this.m.get(this._ref(`rooms/${roomId}/facilitator`)),
        this.m.get(this._ref(`rooms/${roomId}/groups`)),
      ]);
      if (!grpSnap.exists()) {
        this.roomStaticCache.delete(roomId);
        return null;
      }
      return normalizeRoom({
        id: roomId,
        meta: cached.meta,
        cards: cached.cards,
        facilitator: facSnap.val() || {},
        groups: grpSnap.val() || {},
      });
    }
    const snap = await this.m.get(this._ref(`rooms/${roomId}`));
    if (!snap.exists()) {
      removeLocalHistoryEntry(roomId);
      return null;
    }
    const room = normalizeRoom({ ...snap.val(), id: roomId });
    if (!room || Object.keys(room.groups || {}).length === 0) {
      removeLocalHistoryEntry(roomId);
      return null;
    }
    this.roomStaticCache.set(roomId, { meta: room.meta, cards: room.cards });
    return room;
  }

  async listRooms() {
    const byId = new Map();
    for (const h of loadLocalHistory()) {
      if (h?.id) byId.set(h.id, h);
    }
    try {
      const snap = await this.m.get(this._ref("roomIndex"));
      if (snap.exists()) {
        const val = snap.val() || {};
        for (const [id, s] of Object.entries(val)) {
          if (s && typeof s === "object") byId.set(id, { ...s, id });
        }
      }
    } catch {
      // roomIndex 読み取り不可時はローカル履歴のみ表示
    }
    return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async deleteRoom(roomId) {
    this.roomStaticCache.delete(roomId);
    removeLocalHistoryEntry(roomId);
    await Promise.all([
      this.m.set(this._ref(`rooms/${roomId}`), null),
      this.m.set(this._ref(`roomIndex/${roomId}`), null).catch(() => {}),
    ]);
  }

  async clearRoomHistory() {
    const entries = await this.listRooms();
    saveLocalHistory([]);
    await Promise.all(
      entries.map((e) => {
        this.roomStaticCache.delete(e.id);
        return Promise.all([
          this.m.set(this._ref(`rooms/${e.id}`), null).catch(() => {}),
          this.m.set(this._ref(`roomIndex/${e.id}`), null).catch(() => {}),
        ]);
      })
    );
  }

  subscribeRoom(roomId, fn, opts = {}) {
    let cancelled = false;
    const unsubs = [];
    const groupId = opts.groupId || "";

    (async () => {
      let cached = this.roomStaticCache.get(roomId);
      if (!cached) {
        const [metaSnap, cardsSnap] = await Promise.all([
          this.m.get(this._ref(`rooms/${roomId}/meta`)),
          this.m.get(this._ref(`rooms/${roomId}/cards`)),
        ]);
        if (cancelled) return;
        if (!metaSnap.exists()) {
          removeLocalHistoryEntry(roomId);
          this.roomStaticCache.delete(roomId);
          fn(null);
          return;
        }
        cached = { meta: metaSnap.val() || {}, cards: toArray(cardsSnap.val()) };
        this.roomStaticCache.set(roomId, cached);
      }
      if (cancelled) return;

      let latestFac = null;
      let latestGroups = null;

      const emit = () => {
        if (cancelled || latestFac === null || latestGroups === null) return;
        if (Object.keys(latestGroups).length === 0) {
          removeLocalHistoryEntry(roomId);
          this.roomStaticCache.delete(roomId);
          fn(null);
          return;
        }
        fn(
          normalizeRoom({
            id: roomId,
            meta: cached.meta,
            cards: cached.cards,
            facilitator: latestFac,
            groups: latestGroups,
          })
        );
      };

      unsubs.push(
        this.m.onValue(this._ref(`rooms/${roomId}/facilitator`), (snap) => {
          latestFac = snap.exists() ? snap.val() : {};
          emit();
        })
      );

      if (groupId) {
        unsubs.push(
          this.m.onValue(this._ref(`rooms/${roomId}/groups/${groupId}`), (snap) => {
            latestGroups = snap.exists() ? { [groupId]: snap.val() } : {};
            emit();
          })
        );
      } else {
        unsubs.push(
          this.m.onValue(this._ref(`rooms/${roomId}/groups`), (snap) => {
            latestGroups = snap.exists() ? snap.val() : {};
            emit();
          })
        );
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unsubs) {
        try {
          u();
        } catch {
          // ignore
        }
      }
    };
  }

  async updateFacilitator(roomId, patch) {
    await this.m.update(this._ref(`rooms/${roomId}/facilitator`), patch);
  }

  async dealCardsToAllGroups(roomId, cardIndices, newDealtCount, currentRoom = null) {
    let groupsMap = currentRoom?.groups;
    if (!groupsMap) {
      const snap = await this.m.get(this._ref(`rooms/${roomId}/groups`));
      groupsMap = snap.exists() ? snap.val() : {};
    }
    const updates = { "facilitator/dealtCount": newDealtCount };
    const now = Date.now();
    for (const [gid, g] of Object.entries(groupsMap || {})) {
      const hand = toArray(g?.hand).map(Number);
      const placedKeys = Object.keys(g?.placed || {}).map(Number);
      const existing = new Set([...hand, ...placedKeys]);
      for (const idx of cardIndices) {
        if (!existing.has(idx)) {
          hand.push(idx);
          existing.add(idx);
        }
      }
      updates[`groups/${gid}/hand`] = hand;
      updates[`groups/${gid}/updatedAt`] = now;
    }
    await this.m.update(this._ref(`rooms/${roomId}`), updates);
  }

  async joinGroup(roomId, groupId, memberId, nickname) {
    await this.m.set(this._ref(`rooms/${roomId}/groups/${groupId}/members/${memberId}`), {
      name: nickname,
      lastSeen: Date.now(),
    });
  }

  async placeOrMoveCard(roomId, groupId, cardIdx, posObj, nextHandOrNull, nextZ) {
    const updates = {
      [`placed/${cardIdx}`]: {
        x: roundCoord(posObj.x),
        y: roundCoord(posObj.y),
        z: Number(nextZ) || 1,
        by: posObj.by || "",
      },
      z: Number(nextZ) || 1,
      updatedAt: Date.now(),
    };
    if (nextHandOrNull !== null && nextHandOrNull !== undefined) {
      updates.hand = nextHandOrNull;
    }
    await this.m.update(this._ref(`rooms/${roomId}/groups/${groupId}`), updates);
  }

  async returnCard(roomId, groupId, cardIdx, nextHand) {
    await this.m.update(this._ref(`rooms/${roomId}/groups/${groupId}`), {
      [`placed/${cardIdx}`]: null,
      hand: nextHand,
      updatedAt: Date.now(),
    });
  }

  async updateGroupBoard(roomId, groupId, patch) {
    const out = { updatedAt: Date.now() };
    if (patch.hand !== undefined) out.hand = patch.hand;
    if (patch.placed !== undefined) out.placed = patch.placed;
    if (patch.z !== undefined) out.z = patch.z;
    await this.m.update(this._ref(`rooms/${roomId}/groups/${groupId}`), out);
  }

  async setCardLock(roomId, groupId, cardIdx, lockOrNull) {
    await this.m.set(this._ref(`rooms/${roomId}/groups/${groupId}/locks/${cardIdx}`), lockOrNull || null);
  }
}

/**
 * 環境に応じた同期アダプターを生成する.
 * @param {{ forceLocal?: boolean }} [opts]
 */
export async function createSyncAdapter(opts = {}) {
  const params = new URLSearchParams(window.location?.search || "");
  const forceLocal = Boolean(opts.forceLocal) || params.get("localSync") === "1";
  if (!forceLocal && isFirebaseConfigured()) {
    try {
      const [appMod, dbMod] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VER}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VER}/firebase-database.js`),
      ]);
      const fbApp =
        appMod.getApps().length > 0 ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
      return new FirebaseSyncAdapter(fbApp, dbMod);
    } catch (err) {
      console.warn("Firebase 初期化に失敗したため LocalSync へフォールバックします:", err);
    }
  }
  return new LocalSyncAdapter();
}
