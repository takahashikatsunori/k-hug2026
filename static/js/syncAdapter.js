/**
 * マルチユーザーリアルタイム同期アダプター.
 *
 * - firebaseConfig.js に有効な Firebase 設定がある場合は Firebase Realtime Database を使用。
 * - 未設定または ?localSync=1 の場合は、同一ブラウザ内でのマルチタブ同期
 *   (BroadcastChannel + localStorage) にフォールバックし、オフライン/E2Eテストでも動作する。
 */
import { FIREBASE_CONFIG, isFirebaseConfigured } from "./firebaseConfig.js";

const LOCAL_STORAGE_KEY = "hug_coop_rooms_v1";
const BC_CHANNEL_NAME = "hug_coop_sync_v1";
const FIREBASE_SDK_VER = "10.14.1";

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

/** Firebase Realtime Database が空配列や連番オブジェクトを返しても安全に正規化する. */
export function normalizeRoom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const groups = {};
  const rawGroups = raw.groups && typeof raw.groups === "object" ? raw.groups : {};
  for (const [gid, g] of Object.entries(rawGroups)) {
    if (!g || typeof g !== "object") continue;
    groups[gid] = {
      id: g.id || gid,
      name: g.name || gid,
      hand: toArray(g.hand).map(Number),
      placed: g.placed && typeof g.placed === "object" ? g.placed : {},
      locks: g.locks && typeof g.locks === "object" ? g.locks : {},
      members: g.members && typeof g.members === "object" ? g.members : {},
      z: Number(g.z) || 1,
      updatedAt: Number(g.updatedAt) || 0,
    };
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

class LocalSyncAdapter {
  constructor() {
    this.mode = "local";
    this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BC_CHANNEL_NAME) : null;
    this.listeners = new Map(); // roomId -> Set<fn>
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
      // 容量上限時は古いルームを削除して再試行
      const entries = Object.entries(all).sort(
        (a, b) => (b[1]?.meta?.createdAt || 0) - (a[1]?.meta?.createdAt || 0)
      );
      const trimmed = Object.fromEntries(entries.slice(0, 5));
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trimmed));
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
    return normalizeRoom(all[roomId]);
  }

  async getRoom(roomId) {
    return normalizeRoom(this._readAll()[roomId]);
  }

  async listRooms() {
    const all = this._readAll();
    return Object.values(all)
      .map(normalizeRoom)
      .filter(Boolean)
      .sort((a, b) => (b.meta?.createdAt || 0) - (a.meta?.createdAt || 0));
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
      const existing = new Set([...toArray(g.hand).map(Number), ...Object.keys(g.placed || {}).map(Number)]);
      const nextHand = toArray(g.hand).map(Number);
      for (const idx of cardIndices) {
        if (!existing.has(idx)) {
          nextHand.push(idx);
          existing.add(idx);
        }
      }
      g.hand = nextHand;
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
  }

  _ref(path) {
    return this.m.ref(this.db, path);
  }

  async createRoom(roomId, data) {
    const payload = { ...data, id: roomId };
    await this.m.set(this._ref(`rooms/${roomId}`), payload);
    return normalizeRoom(payload);
  }

  async getRoom(roomId) {
    const snap = await this.m.get(this._ref(`rooms/${roomId}`));
    return snap.exists() ? normalizeRoom(snap.val()) : null;
  }

  async listRooms() {
    // 公開一覧はセキュリティ上持たず、URL/QR直接参加を基本とする
    return [];
  }

  subscribeRoom(roomId, fn) {
    return this.m.onValue(this._ref(`rooms/${roomId}`), (snap) => {
      fn(snap.exists() ? normalizeRoom(snap.val()) : null);
    });
  }

  async updateFacilitator(roomId, patch) {
    await this.m.update(this._ref(`rooms/${roomId}/facilitator`), patch);
  }

  async dealCardsToAllGroups(roomId, cardIndices, newDealtCount) {
    await this.m.runTransaction(this._ref(`rooms/${roomId}`), (room) => {
      if (!room) return room;
      room.facilitator = room.facilitator || {};
      room.facilitator.dealtCount = newDealtCount;
      for (const g of Object.values(room.groups || {})) {
        const hand = toArray(g.hand).map(Number);
        const placedKeys = Object.keys(g.placed || {}).map(Number);
        const existing = new Set([...hand, ...placedKeys]);
        for (const idx of cardIndices) {
          if (!existing.has(idx)) {
            hand.push(idx);
            existing.add(idx);
          }
        }
        g.hand = hand;
        g.updatedAt = Date.now();
      }
      return room;
    });
  }

  async joinGroup(roomId, groupId, memberId, nickname) {
    await this.m.set(this._ref(`rooms/${roomId}/groups/${groupId}/members/${memberId}`), {
      name: nickname,
      lastSeen: Date.now(),
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
