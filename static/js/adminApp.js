/**
 * 管理者用ダッシュボード (admin.html).
 * こだいらSVCs マルチユーザーHUG台紙シミュレーションの訓練作成・配布・進行支援・監視を行う.
 */
import {
  loadCardDatabase,
  loadBoardManifest,
  fetchSavedDecks,
  buildDeckFromSaved,
  buildDeckFromJsonText,
} from "./boardDeckLoader.js";
import { resolveCardGroupId } from "./cardCanvas.js";
import { renderQrToCanvas, downloadQrPng } from "./qrCode.js";
import { createSyncAdapter } from "./syncAdapter.js";
import {
  SHEET_PRESETS,
  resolveSheetSize,
  cardSummary,
  escapeHtml,
  CardImageCache,
  createBoardStage,
  exportBoardToPdf,
} from "./boardEngine.js";

const LOGO_HTML = `<img class="co-brand-logo" src="./static/logo/正式ロゴ.jpeg" onerror="if(!this.dataset.fb1){this.dataset.fb1='1';this.src='./static/logo/official_logo.jpeg';}" alt="こだいらSVCs" />`;

const app = {
  sync: null,
  db: null,
  boards: [],
  decks: [],
  roomId: "",
  room: null,
  unsub: null,
  monitoredGroupId: "",
  stage: null,
  imageCache: new CardImageCache(),
  timerInterval: 0,
  setup: {
    title: "五小 避難所運営訓練",
    langMode: "kids",
    deckKey: "",
    deck: null,
    loadingDeck: false,
    boardId: "",
    sizeMode: "8x", // "4x" | "8x" | "16x" | "custom"
    customMult: 10,
    groupCount: 4,
    groupNames: ["1はん", "2はん", "3はん", "4はん"],
  },
};

function toast(msg, type = "info", ms = 3200) {
  const wrap = document.getElementById("co-toast-wrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `co-toast is-${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function buildMemberUrl(roomId, groupId, action = "") {
  const url = new URL("./coop.html", window.location.href);
  url.search = "";
  url.searchParams.set("room", roomId);
  url.searchParams.set("group", groupId);
  if (action) url.searchParams.set("action", action);
  const curParams = new URLSearchParams(window.location.search);
  if (curParams.get("localSync") === "1") url.searchParams.set("localSync", "1");
  return url.toString();
}

function syncModePill() {
  const isFb = app.sync?.mode === "firebase";
  return `<span class="co-pill ${isFb ? "" : "is-local"}">${
    isFb ? "🟢 Firebase リアルタイム同期" : "🟡 ローカル同期モード（同一ブラウザ）"
  }</span>`;
}

function randomRoomId() {
  return "hug-" + Math.random().toString(36).slice(2, 8);
}

function defaultGroupName(i, langMode) {
  return langMode === "kids" ? `${i + 1}はん` : `${i + 1}班`;
}

async function selectDeck(deckId) {
  app.setup.deckKey = deckId;
  app.setup.loadingDeck = true;
  renderSetup();
  try {
    app.setup.deck = await buildDeckFromSaved(app.db, app.decks, deckId);
  } catch (err) {
    toast(`デッキ読み込みエラー: ${err.message}`, "error");
    app.setup.deck = null;
  } finally {
    app.setup.loadingDeck = false;
    renderSetup();
  }
}

function getEffectiveSizeSpec() {
  if (app.setup.sizeMode === "custom") {
    const m = Math.max(1, Math.min(32, Number(app.setup.customMult) || 8));
    return `custom:${m}`;
  }
  return app.setup.sizeMode;
}

function renderSetup() {
  const root = document.getElementById("co-app");
  if (!root) return;
  const st = app.setup;
  const sizeObj = resolveSheetSize(getEffectiveSizeSpec());

  root.innerHTML = `
    <header class="co-header">
      <div class="co-brand">
        ${LOGO_HTML}
        <div>
          <div class="co-brand-title">こだいらSVCs 管理者画面</div>
          <div class="co-brand-sub">マルチユーザー訓練ルーム作成・進行管理</div>
        </div>
      </div>
      <div class="co-header-actions">
        ${syncModePill()}
        <a class="co-btn co-btn-sm" href="./board.html">1人用台紙へ</a>
      </div>
    </header>
    <main class="co-container">
      <div class="co-card" data-testid="admin-setup">
        <h2>🛠️ 新しい訓練ルームをつくる</h2>
        <div class="co-grid-2">
          <div class="co-field">
            <label class="co-label" for="ad-title">訓練の名前</label>
            <input class="co-input" id="ad-title" data-testid="ad-title" value="${escapeHtml(st.title)}" />
          </div>
          <div class="co-field">
            <span class="co-label">参加画面の言葉遣い（初期設定）</span>
            <div class="co-seg-row">
              <button type="button" class="co-seg-btn ${st.langMode === "kids" ? "active" : ""}" data-lang="kids" data-testid="ad-lang-kids">
                誰でも（小学生むけ）<span>ひらがな多め・やさしい表示</span>
              </button>
              <button type="button" class="co-seg-btn ${st.langMode === "general" ? "active" : ""}" data-lang="general" data-testid="ad-lang-general">
                一般（中学生以上）<span>漢字表記（置く・手札など）</span>
              </button>
            </div>
          </div>
        </div>

        <div class="co-grid-2">
          <div class="co-field">
            <label class="co-label" for="ad-deck">使用するカードデッキ</label>
            <select class="co-select" id="ad-deck" data-testid="ad-deck">
              ${app.decks
                .map(
                  (d) =>
                    `<option value="${escapeHtml(d.id)}" ${
                      st.deckKey === d.id ? "selected" : ""
                    }>${escapeHtml(d.name)}</option>`
                )
                .join("")}
              ${
                st.deckKey === "upload" && st.deck
                  ? `<option value="upload" selected>読込JSON: ${escapeHtml(st.deck.title)}</option>`
                  : ""
              }
            </select>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <button type="button" class="co-btn co-btn-sm" id="ad-json-btn">📂 デッキJSON読込</button>
              <input type="file" id="ad-json-input" accept=".json,application/json" hidden />
              <span style="font-size:0.85rem;color:var(--co-muted);">${
                st.loadingDeck ? "読込中…" : st.deck ? `${st.deck.cards.length}枚` : ""
              }</span>
            </div>
          </div>

          <div class="co-field">
            <label class="co-label" for="ad-board">使用する台紙</label>
            <select class="co-select" id="ad-board" data-testid="ad-board">
              ${app.boards
                .map(
                  (b) =>
                    `<option value="${escapeHtml(b.id)}" ${
                      st.boardId === b.id ? "selected" : ""
                    }>${escapeHtml(b.name)}</option>`
                )
                .join("")}
            </select>
          </div>
        </div>

        <div class="co-field">
          <span class="co-label">台紙の大きさ（名刺サイズ 55×91mm に対する比率：現在 ${sizeObj.long}×${sizeObj.short}mm）</span>
          <div class="co-seg-row">
            ${Object.values(SHEET_PRESETS)
              .map(
                (z) => `
              <button type="button" class="co-seg-btn ${st.sizeMode === z.id ? "active" : ""}" data-size="${z.id}" data-testid="ad-size-${z.id}">
                <b>${escapeHtml(z.label)}</b>
                <span>${z.long}×${z.short}mm</span>
              </button>`
              )
              .join("")}
            <button type="button" class="co-seg-btn ${st.sizeMode === "custom" ? "active" : ""}" data-size="custom" data-testid="ad-size-custom">
              <b>任意サイズ</b>
              <span>倍率を指定</span>
            </button>
          </div>
          ${
            st.sizeMode === "custom"
              ? `<div style="margin-top:10px;display:flex;align-items:center;gap:10px;">
                   <label for="ad-custom-mult" style="font-weight:700;font-size:0.9rem;">A0の縦横</label>
                   <input type="number" class="co-input" id="ad-custom-mult" data-testid="ad-custom-mult" min="1" max="32" step="1" value="${st.customMult}" style="width:110px;" />
                   <span style="font-weight:700;">倍（${sizeObj.long}×${sizeObj.short}mm）</span>
                 </div>`
              : ""
          }
        </div>

        <div class="co-field">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
            <span class="co-label" style="margin:0;">グループ設定（${st.groupCount}グループ）</span>
            <div style="display:flex;gap:6px;">
              <button type="button" class="co-btn co-btn-sm" id="ad-grp-minus">－</button>
              <button type="button" class="co-btn co-btn-sm" id="ad-grp-plus">＋</button>
            </div>
          </div>
          <div class="co-grid-2">
            ${st.groupNames
              .map(
                (gn, i) => `
              <div class="co-group-edit-row">
                <span style="font-weight:700;min-width:28px;">#${i + 1}</span>
                <input class="co-input ad-grp-name" data-gi="${i}" data-testid="ad-grp-name-${i}" value="${escapeHtml(gn)}" />
              </div>`
              )
              .join("")}
          </div>
        </div>

        <div style="margin-top:18px;display:flex;justify-content:center;">
          <button type="button" class="co-btn co-btn-primary co-btn-lg" id="ad-create-btn" data-testid="ad-create-btn" ${
            st.deck && !st.loadingDeck ? "" : "disabled"
          }>🚀 この設定で訓練を開始する</button>
        </div>
      </div>
      <div id="ad-recent-rooms"></div>
    </main>
  `;

  document.getElementById("ad-title").addEventListener("input", (e) => {
    st.title = e.target.value;
  });
  root.querySelectorAll("[data-lang]").forEach((b) =>
    b.addEventListener("click", () => {
      const prev = st.langMode;
      st.langMode = b.dataset.lang;
      st.groupNames = st.groupNames.map((gn, i) =>
        gn === defaultGroupName(i, prev) ? defaultGroupName(i, st.langMode) : gn
      );
      renderSetup();
    })
  );
  document.getElementById("ad-deck").addEventListener("change", (e) => selectDeck(e.target.value));
  document.getElementById("ad-json-btn").addEventListener("click", () =>
    document.getElementById("ad-json-input").click()
  );
  document.getElementById("ad-json-input").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      st.deck = buildDeckFromJsonText(app.db, text, file.name);
      st.deckKey = "upload";
      renderSetup();
    } catch (err) {
      toast(`読込失敗: ${err.message}`, "error");
    }
  });
  document.getElementById("ad-board").addEventListener("change", (e) => {
    st.boardId = e.target.value;
  });
  root.querySelectorAll("[data-size]").forEach((b) =>
    b.addEventListener("click", () => {
      st.sizeMode = b.dataset.size;
      renderSetup();
    })
  );
  const multInput = document.getElementById("ad-custom-mult");
  if (multInput) {
    multInput.addEventListener("input", () => {
      st.customMult = Math.max(1, Math.min(32, Number(multInput.value) || 8));
    });
    multInput.addEventListener("change", () => renderSetup());
  }
  document.getElementById("ad-grp-minus").addEventListener("click", () => {
    if (st.groupCount <= 1) return;
    st.groupCount--;
    st.groupNames = st.groupNames.slice(0, st.groupCount);
    renderSetup();
  });
  document.getElementById("ad-grp-plus").addEventListener("click", () => {
    if (st.groupCount >= 12) return;
    st.groupNames.push(defaultGroupName(st.groupCount, st.langMode));
    st.groupCount++;
    renderSetup();
  });
  root.querySelectorAll(".ad-grp-name").forEach((inp) =>
    inp.addEventListener("input", () => {
      st.groupNames[Number(inp.dataset.gi)] = inp.value;
    })
  );
  document.getElementById("ad-create-btn").addEventListener("click", createTrainingRoom);

  loadRecentRoomsList();
}

function formatHistoryDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function renderHistoryItemsHtml(rooms) {
  return rooms
    .map(
      (r) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--co-border);border-radius:12px;" data-testid="ad-history-item-${escapeHtml(r.id)}">
        <div style="min-width:0;">
          <b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.title || r.id)}</b>
          <div style="font-size:0.8rem;color:var(--co-muted);">ID: ${escapeHtml(r.id)} ／ ${escapeHtml(r.deckTitle || "")}${r.createdAt ? ` ／ ${formatHistoryDate(r.createdAt)}` : ""}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button type="button" class="co-btn co-btn-sm co-btn-primary" data-open-room="${escapeHtml(r.id)}" data-testid="ad-open-room-${escapeHtml(r.id)}">開く</button>
          <button type="button" class="co-btn co-btn-sm" data-del-room="${escapeHtml(r.id)}" data-testid="ad-del-room-${escapeHtml(r.id)}" style="color:var(--co-danger);">🗑️ 削除</button>
        </div>
      </div>`
    )
    .join("");
}

function bindHistoryActions(container, onReload) {
  container.querySelectorAll("[data-open-room]").forEach((b) =>
    b.addEventListener("click", () => {
      onReload?.("open", b.dataset.openRoom);
      openRoom(b.dataset.openRoom);
    })
  );
  container.querySelectorAll("[data-del-room]").forEach((b) =>
    b.addEventListener("click", async () => {
      const rid = b.dataset.delRoom;
      try {
        await app.sync.deleteRoom(rid);
        toast(`訓練ルーム ${rid} を削除しました`);
        if (rid === app.roomId) {
          leaveRoomToSetup();
        } else {
          onReload?.("deleted", rid);
        }
      } catch (err) {
        toast(`削除に失敗しました: ${err.message}`, "error", 5000);
      }
    })
  );
  container.querySelector('[data-act="clear-all-history"]')?.addEventListener("click", async () => {
    try {
      await app.sync.clearRoomHistory();
      toast("訓練履歴をすべて削除しました");
      if (app.roomId) {
        leaveRoomToSetup();
      } else {
        onReload?.("cleared");
      }
    } catch (err) {
      toast(`履歴削除に失敗しました: ${err.message}`, "error", 5000);
    }
  });
}

async function loadRecentRoomsList() {
  const wrap = document.getElementById("ad-recent-rooms");
  if (!wrap || !app.sync) return;
  const rooms = await app.sync.listRooms();
  if (!rooms.length) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = `
    <div class="co-card" data-testid="ad-history-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <h2 style="margin:0;">📂 作成済みの訓練ルーム（履歴）</h2>
        <button type="button" class="co-btn co-btn-sm" data-act="clear-all-history" data-testid="ad-clear-history-btn" style="color:var(--co-danger);">🗑️ 履歴をすべて削除</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${renderHistoryItemsHtml(rooms)}
      </div>
    </div>
  `;
  bindHistoryActions(wrap, () => loadRecentRoomsList());
}

async function openHistoryModal() {
  const rooms = await app.sync.listRooms();
  const back = document.createElement("div");
  back.className = "co-modal-backdrop";
  const renderModalContent = (list) => {
    back.innerHTML = `
      <div class="co-modal-dialog" role="dialog" aria-modal="true" style="max-width:560px;" data-testid="ad-history-modal">
        <div class="co-modal-head">
          <span class="co-modal-title">📂 訓練履歴（切替・削除）</span>
          <button type="button" class="co-btn co-btn-sm" data-act="close">✕</button>
        </div>
        ${
          list.length
            ? `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">${renderHistoryItemsHtml(list)}</div>
               <div style="display:flex;justify-content:flex-end;">
                 <button type="button" class="co-btn co-btn-sm" data-act="clear-all-history" style="color:var(--co-danger);">🗑️ 履歴をすべて削除</button>
               </div>`
            : `<p style="color:var(--co-muted);margin:8px 0;">保存されている訓練履歴はありません。</p>`
        }
      </div>
    `;
    bindHistoryActions(back, async (kind) => {
      if (kind === "open") {
        back.remove();
      } else {
        const next = await app.sync.listRooms();
        renderModalContent(next);
      }
    });
  };
  renderModalContent(rooms);
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest('[data-act="close"]')) back.remove();
  });
  document.body.appendChild(back);
}

function leaveRoomToSetup() {
  clearInterval(app.timerInterval);
  if (app.unsub) app.unsub();
  if (app.stage) app.stage.destroy();
  app.stage = null;
  app.room = null;
  app.roomId = "";
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url.toString());
  renderSetup();
}

async function createTrainingRoom() {
  const st = app.setup;
  if (!st.deck || !st.deck.cards.length) {
    toast("デッキを選択してください", "warn");
    return;
  }
  const roomId = randomRoomId();
  const groups = {};
  st.groupNames.forEach((gn, i) => {
    const gid = `g${i + 1}`;
    groups[gid] = {
      id: gid,
      name: (gn || defaultGroupName(i, st.langMode)).trim(),
      hand: [],
      placed: {},
      locks: {},
      members: {},
      z: 1,
      updatedAt: Date.now(),
    };
  });

  const payload = {
    meta: {
      title: (st.title || "避難所運営訓練").trim(),
      langMode: st.langMode,
      deckTitle: st.deck.title,
      boardId: st.boardId,
      sizeId: getEffectiveSizeSpec(),
      createdAt: Date.now(),
    },
    cards: st.deck.cards,
    facilitator: {
      dealtCount: 0,
      message: "",
      messageAt: 0,
      timer: { running: false, endsAt: 0, remainSec: 0 },
    },
    groups,
  };

  try {
    await app.sync.createRoom(roomId, payload);
    openRoom(roomId);
  } catch (err) {
    toast(`訓練ルームの作成に失敗しました: ${err.message}`, "error", 6000);
    loadRecentRoomsList();
  }
}

function openRoom(roomId) {
  clearInterval(app.timerInterval);
  if (app.unsub) app.unsub();
  if (app.stage) app.stage.destroy();
  app.stage = null;
  app.room = null;
  app.roomId = roomId;
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url.toString());
  app.monitoredGroupId = "";
  app.unsub = app.sync.subscribeRoom(roomId, (room) => {
    if (!room || Object.keys(room.groups || {}).length === 0) {
      toast("訓練ルームのデータが見つからなかったため一覧へ戻ります", "warn", 4000);
      leaveRoomToSetup();
      return;
    }
    const firstLoad = !app.room;
    app.room = room;
    if (!app.monitoredGroupId) {
      app.monitoredGroupId = Object.keys(room.groups)[0] || "";
    }
    if (firstLoad || !document.getElementById("ad-console")) {
      renderConsole();
    } else {
      updateConsoleLive();
    }
  });
}

function computeNextDealBatch(mode) {
  const room = app.room;
  if (!room) return [];
  const total = room.cards.length;
  const start = room.facilitator.dealtCount;
  if (start >= total) return [];

  if (mode === "one") return [start];
  if (mode === "three") {
    const out = [];
    for (let i = start; i < Math.min(total, start + 3); i++) out.push(i);
    return out;
  }
  if (mode === "household") {
    const first = room.cards[start];
    const info = cardSummary(first, start);
    if (info.isEvent) return [start];
    const gid = resolveCardGroupId(first);
    if (!gid) return [start];
    const out = [start];
    for (let i = start + 1; i < total; i++) {
      const c = room.cards[i];
      if (cardSummary(c, i).isEvent) break;
      if (resolveCardGroupId(c) === gid) out.push(i);
      else break;
    }
    return out;
  }
  return [];
}

async function handleDeal(mode) {
  const batch = computeNextDealBatch(mode);
  if (!batch.length) {
    toast("すべてのカードを配布済みです", "warn");
    return;
  }
  const nextCount = batch[batch.length - 1] + 1;
  await app.sync.dealCardsToAllGroups(app.roomId, batch, nextCount, app.room);
  toast(`${batch.length}枚のカードを全グループへ配布しました`, "info");
}

function formatTimerText(timer) {
  if (!timer) return "00:00";
  let sec = timer.remainSec || 0;
  if (timer.running && timer.endsAt) {
    sec = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function startTimer(minutes) {
  const sec = Math.max(10, Math.round(minutes * 60));
  await app.sync.updateFacilitator(app.roomId, {
    timer: { running: true, endsAt: Date.now() + sec * 1000, remainSec: sec },
  });
}

async function pauseOrResumeTimer() {
  const tm = app.room?.facilitator?.timer;
  if (!tm) return;
  if (tm.running) {
    const rem = Math.max(0, Math.ceil((tm.endsAt - Date.now()) / 1000));
    await app.sync.updateFacilitator(app.roomId, {
      timer: { running: false, endsAt: 0, remainSec: rem },
    });
  } else if (tm.remainSec > 0) {
    await app.sync.updateFacilitator(app.roomId, {
      timer: { running: true, endsAt: Date.now() + tm.remainSec * 1000, remainSec: tm.remainSec },
    });
  }
}

async function resetTimer() {
  await app.sync.updateFacilitator(app.roomId, {
    timer: { running: false, endsAt: 0, remainSec: 0 },
  });
}

function openQrModal(title, url, desc) {
  const back = document.createElement("div");
  back.className = "co-modal-backdrop";
  back.innerHTML = `
    <div class="co-modal-dialog" role="dialog" aria-modal="true">
      <div class="co-modal-head">
        <span class="co-modal-title">${escapeHtml(title)}</span>
        <button type="button" class="co-btn co-btn-sm" data-act="close">✕</button>
      </div>
      <div class="co-qr-box">
        <canvas id="ad-qr-canvas"></canvas>
        <p style="margin:0;font-size:0.86rem;color:var(--co-muted);text-align:center;">${escapeHtml(desc)}</p>
        <input class="co-input" readonly value="${escapeHtml(url)}" style="font-size:0.8rem;" data-testid="ad-qr-url" />
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="co-btn co-btn-sm co-btn-primary" data-act="copy">URLをコピー</button>
          <button type="button" class="co-btn co-btn-sm" data-act="dl">QR画像を保存</button>
          <a class="co-btn co-btn-sm co-btn-green" href="${escapeHtml(url)}" target="_blank" rel="noopener">新しいタブで開く</a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(back);
  const canvas = back.querySelector("#ad-qr-canvas");
  renderQrToCanvas(canvas, url, { size: 220 });
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest('[data-act="close"]')) back.remove();
  });
  back.querySelector('[data-act="copy"]').addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("URLをコピーしました");
    } catch {
      toast("URL欄を選択してコピーしてください", "warn");
    }
  });
  back.querySelector('[data-act="dl"]').addEventListener("click", () => {
    downloadQrPng(url, title);
  });
}

function renderConsole() {
  const root = document.getElementById("co-app");
  const room = app.room;
  if (!root || !room) return;
  const sizeObj = resolveSheetSize(room.meta.sizeId);
  const board = app.boards.find((b) => b.id === room.meta.boardId) || app.boards[0];

  root.innerHTML = `
    <header class="co-header" id="ad-console">
      <div class="co-brand">
        ${LOGO_HTML}
        <div>
          <div class="co-brand-title">${escapeHtml(room.meta.title)}（管理者コンソール）</div>
          <div class="co-brand-sub">ルームID: <b>${escapeHtml(app.roomId)}</b> ／ ${escapeHtml(room.meta.deckTitle)}（${room.cards.length}枚）／ ${escapeHtml(sizeObj.label)}</div>
        </div>
      </div>
      <div class="co-header-actions">
        ${syncModePill()}
        <button type="button" class="co-btn co-btn-sm" id="ad-history-btn" data-testid="ad-history-btn">📂 訓練履歴</button>
        <button type="button" class="co-btn co-btn-sm" id="ad-new-room-btn" data-testid="ad-new-room-btn">＋ 新しい訓練</button>
      </div>
    </header>
    <main class="co-container">
      <div class="co-grid-2">
        <section class="co-card">
          <h2>🃏 カード一斉配布（全グループ同時）</h2>
          <div id="ad-deal-status" data-testid="ad-deal-status" style="margin-bottom:12px;font-size:0.95rem;"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="co-btn co-btn-primary" id="ad-deal-one" data-testid="ad-deal-one">1枚配る</button>
            <button type="button" class="co-btn co-btn-green" id="ad-deal-household" data-testid="ad-deal-household">1世帯まとめて配る</button>
            <button type="button" class="co-btn" id="ad-deal-three" data-testid="ad-deal-three">3枚配る</button>
          </div>
        </section>

        <section class="co-card">
          <h2>⏱️ 訓練の進行サポート</h2>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <span class="co-timer-badge" id="ad-timer-text" data-testid="ad-timer-text">⏱ 00:00</span>
            <button type="button" class="co-btn co-btn-sm" data-timer="1">1分</button>
            <button type="button" class="co-btn co-btn-sm" data-timer="3">3分</button>
            <button type="button" class="co-btn co-btn-sm" data-timer="5">5分</button>
            <button type="button" class="co-btn co-btn-sm" id="ad-timer-toggle">⏯ 一時停止/再開</button>
            <button type="button" class="co-btn co-btn-sm" id="ad-timer-reset">↺ リセット</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input class="co-input" id="ad-msg-input" data-testid="ad-msg-input" placeholder="メンバー画面に出すメッセージ（例：そうだんタイム！）" style="flex:1;min-width:180px;" />
            <button type="button" class="co-btn co-btn-accent" id="ad-msg-send" data-testid="ad-msg-send">送信</button>
            <button type="button" class="co-btn co-btn-sm" id="ad-msg-clear">消去</button>
          </div>
        </section>
      </div>

      <section class="co-card">
        <h2>👥 グループ一覧・参加QRコード・持ち帰りPDF QR</h2>
        <div class="co-group-grid" id="ad-group-grid"></div>
      </section>

      <section class="co-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <h2 style="margin:0;">👀 グループ台紙ライブモニター：<span id="ad-mon-name"></span></h2>
          <div style="display:flex;gap:8px;">
            <button type="button" class="co-btn co-btn-sm" id="ad-mon-fit">⤢ 全体表示</button>
            <button type="button" class="co-btn co-btn-sm co-btn-primary" id="ad-mon-pdf">⬇ このグループのPDF保存</button>
          </div>
        </div>
        <div class="bd-stage co-monitor-stage" id="ad-mon-stage">
          <canvas class="bd-viewport-canvas" id="ad-mon-canvas"></canvas>
          <div class="bd-world bd-card-world" id="ad-mon-cards"></div>
          <div class="bd-cluster-layer" id="ad-mon-clusters"></div>
          <div class="bd-zoom-ctrl">
            <button type="button" id="ad-mon-zin" aria-label="拡大">＋</button>
            <button type="button" id="ad-mon-zout" aria-label="縮小">－</button>
          </div>
        </div>
      </section>
    </main>
  `;

  document.getElementById("ad-history-btn").addEventListener("click", openHistoryModal);
  document.getElementById("ad-new-room-btn").addEventListener("click", leaveRoomToSetup);
  document.getElementById("ad-deal-one").addEventListener("click", () => handleDeal("one"));
  document.getElementById("ad-deal-household").addEventListener("click", () => handleDeal("household"));
  document.getElementById("ad-deal-three").addEventListener("click", () => handleDeal("three"));
  root.querySelectorAll("[data-timer]").forEach((b) =>
    b.addEventListener("click", () => startTimer(Number(b.dataset.timer)))
  );
  document.getElementById("ad-timer-toggle").addEventListener("click", pauseOrResumeTimer);
  document.getElementById("ad-timer-reset").addEventListener("click", resetTimer);
  document.getElementById("ad-msg-send").addEventListener("click", async () => {
    const val = document.getElementById("ad-msg-input").value.trim();
    await app.sync.updateFacilitator(app.roomId, { message: val, messageAt: Date.now() });
    toast("メッセージを送信しました");
  });
  document.getElementById("ad-msg-clear").addEventListener("click", async () => {
    document.getElementById("ad-msg-input").value = "";
    await app.sync.updateFacilitator(app.roomId, { message: "", messageAt: Date.now() });
  });

  if (app.stage) app.stage.destroy();
  app.stage = createBoardStage({
    stageEl: document.getElementById("ad-mon-stage"),
    baseCanvasEl: document.getElementById("ad-mon-canvas"),
    cardWorldEl: document.getElementById("ad-mon-cards"),
    clusterLayerEl: document.getElementById("ad-mon-clusters"),
    imageCache: app.imageCache,
    readOnly: true,
    getBadgeText: (idx, p, lock) => {
      if (lock && lock.name) return `${lock.name}さんが移動中`;
      return p.by ? `${p.by}さん` : "";
    },
  });
  document.getElementById("ad-mon-fit").addEventListener("click", () => app.stage?.zoomFit());
  document.getElementById("ad-mon-zin").addEventListener("click", () => app.stage?.zoomIn());
  document.getElementById("ad-mon-zout").addEventListener("click", () => app.stage?.zoomOut());
  document.getElementById("ad-mon-pdf").addEventListener("click", async () => {
    const g = app.room?.groups?.[app.monitoredGroupId];
    if (!g || !app.stage?.state?.geo) return;
    await exportBoardToPdf({
      boardInfo: app.stage.state.boardInfo,
      geo: app.stage.state.geo,
      baseOffscreen: app.stage.state.baseOffscreen,
      imageCache: app.imageCache,
      deckTitle: app.room.meta.deckTitle,
      boardName: board?.name || "",
      groupName: g.name,
      cards: app.room.cards,
      placed: g.placed,
    });
  });

  app.stage.initBoard(board, room.meta.sizeId).then(() => updateConsoleLive());
  clearInterval(app.timerInterval);
  app.timerInterval = setInterval(() => {
    const el = document.getElementById("ad-timer-text");
    if (el && app.room) el.textContent = `⏱ ${formatTimerText(app.room.facilitator.timer)}`;
  }, 500);
  updateConsoleLive();
}

function updateConsoleLive() {
  const room = app.room;
  if (!room) return;
  const dealEl = document.getElementById("ad-deal-status");
  if (dealEl) {
    const dc = room.facilitator.dealtCount;
    const total = room.cards.length;
    const next = dc < total ? cardSummary(room.cards[dc], dc) : null;
    const nextGid = dc < total && !next?.isEvent ? resolveCardGroupId(room.cards[dc]) : "";
    dealEl.innerHTML = `配布済み: <b>${dc} / ${total}枚</b>　${
      next
        ? `次のカード: <b>No.${next.no} ${escapeHtml(next.title)}</b>${
            nextGid ? `（世帯: ${escapeHtml(nextGid)}）` : ""
          }`
        : "<b>全カード配布完了</b>"
    }`;
  }

  const tmEl = document.getElementById("ad-timer-text");
  if (tmEl) tmEl.textContent = `⏱ ${formatTimerText(room.facilitator.timer)}`;

  const grid = document.getElementById("ad-group-grid");
  if (grid) {
    grid.innerHTML = Object.values(room.groups)
      .map((g) => {
        const members = Object.values(g.members || {}).map((m) => m.name);
        const placedCount = Object.keys(g.placed || {}).length;
        const handCount = (g.hand || []).length;
        const isMon = g.id === app.monitoredGroupId;
        return `
          <div class="co-group-card ${isMon ? "is-monitored" : ""}" data-testid="ad-group-card-${escapeHtml(g.id)}">
            <div class="co-group-head">
              <span class="co-group-name">${escapeHtml(g.name)}</span>
              <button type="button" class="co-btn co-btn-sm ${isMon ? "co-btn-primary" : ""}" data-mon="${escapeHtml(g.id)}" data-testid="ad-mon-btn-${escapeHtml(g.id)}">${
                isMon ? "表示中" : "台紙を見る"
              }</button>
            </div>
            <div class="co-group-stats">
              <span>👤 参加: <b>${members.length}人</b>${members.length ? `（${escapeHtml(members.join("・"))}）` : ""}</span>
              <span>🃏 配置: <b>${placedCount}枚</b> ／ 手札: <b>${handCount}枚</b></span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="co-btn co-btn-sm" data-qr-join="${escapeHtml(g.id)}" data-testid="ad-qr-join-${escapeHtml(g.id)}">📱 参加用QR</button>
              <button type="button" class="co-btn co-btn-sm" data-qr-pdf="${escapeHtml(g.id)}" data-testid="ad-qr-pdf-${escapeHtml(g.id)}">📄 持ち帰りPDF QR</button>
            </div>
          </div>
        `;
      })
      .join("");

    grid.querySelectorAll("[data-mon]").forEach((b) =>
      b.addEventListener("click", () => {
        app.monitoredGroupId = b.dataset.mon;
        updateConsoleLive();
      })
    );
    grid.querySelectorAll("[data-qr-join]").forEach((b) =>
      b.addEventListener("click", () => {
        const g = room.groups[b.dataset.qrJoin];
        const url = buildMemberUrl(app.roomId, g.id);
        openQrModal(`${g.name} 参加用QRコード`, url, "このQRコードをスマホで読み取ると、ニックネームを入れるだけで参加できます。");
      })
    );
    grid.querySelectorAll("[data-qr-pdf]").forEach((b) =>
      b.addEventListener("click", () => {
        const g = room.groups[b.dataset.qrPdf];
        const url = buildMemberUrl(app.roomId, g.id, "pdf");
        openQrModal(`${g.name} 持ち帰りPDF QRコード`, url, "訓練の終わりに読み取ると、このグループの現在の台紙をPDFでダウンロードできます。");
      })
    );
  }

  const monGroup = room.groups[app.monitoredGroupId];
  const monNameEl = document.getElementById("ad-mon-name");
  if (monNameEl && monGroup) monNameEl.textContent = monGroup.name;
  if (app.stage && monGroup) {
    app.stage.syncCards(room.cards, monGroup.placed, monGroup.locks);
  }
}

async function boot() {
  app.sync = await createSyncAdapter();
  app.db = await loadCardDatabase();
  app.boards = await loadBoardManifest();
  app.decks = await fetchSavedDecks(app.db);
  app.setup.boardId = app.boards[0]?.id || "";

  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  if (roomParam) {
    const existing = await app.sync.getRoom(roomParam);
    if (existing) {
      openRoom(roomParam);
      return;
    }
  }

  const defaultDeck = app.decks.length ? app.decks[0].id : "";
  if (defaultDeck) await selectDeck(defaultDeck);
  else renderSetup();
}

boot();
