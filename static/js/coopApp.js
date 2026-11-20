/**
 * メンバー用入り口 ＆ 共有台紙画面 (coop.html).
 * こだいらSVCs マルチユーザーHUG台紙シミュレーション.
 */
import { loadBoardManifest, loadCardDatabase, resolveDefaultBoard } from "./boardDeckLoader.js";
import { renderQrToCanvas, downloadQrPng } from "./qrCode.js";
import { createSyncAdapter, roundCoord } from "./syncAdapter.js";
import { t, LANG_MODES } from "./coopI18n.js";
import {
  CARD_W,
  CARD_H,
  DESK_MARGIN,
  clamp,
  cardSummary,
  escapeHtml,
  CardImageCache,
  createBoardStage,
  exportBoardToPdf,
} from "./boardEngine.js";

const LOGO_HTML = `<img class="co-brand-logo" src="./static/logo/正式ロゴ.jpeg" onerror="if(!this.dataset.fb1){this.dataset.fb1='1';this.src='./static/logo/official_logo.jpeg';}" alt="こだいらSVCs" />`;
const MEMBER_ID_KEY = "hug_coop_member_id_v1";

function getMemberId() {
  let id = sessionStorage.getItem(MEMBER_ID_KEY);
  if (!id) {
    id = "m-" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(MEMBER_ID_KEY, id);
  }
  return id;
}

const app = {
  sync: null,
  boards: [],
  memberId: getMemberId(),
  nickname: "",
  roomId: "",
  groupId: "",
  langMode: LANG_MODES.kids,
  langOverridden: false,
  actionMode: "", // "" | "pdf"
  room: null,
  unsub: null,
  stage: null,
  imageCache: new CardImageCache(),
  prevHandSet: null,
  prevPlacedSet: null,
  timerInterval: 0,
  joined: false,
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

function buildTakeHomePdfUrl() {
  const url = new URL("./coop.html", window.location.href);
  url.search = "";
  url.searchParams.set("room", app.roomId);
  url.searchParams.set("group", app.groupId);
  url.searchParams.set("action", "pdf");
  const cur = new URLSearchParams(window.location.search);
  if (cur.get("localSync") === "1") url.searchParams.set("localSync", "1");
  return url.toString();
}

function L(key, vars) {
  return t(app.langMode, key, vars);
}

function formatTimer(timer) {
  if (!timer) return "";
  let sec = timer.remainSec || 0;
  if (timer.running && timer.endsAt) {
    sec = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
  }
  if (!timer.running && sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderLangToggleBtn() {
  return `<button type="button" class="co-btn co-btn-sm" id="co-lang-toggle" data-testid="co-lang-toggle" title="${escapeHtml(
    L("langSwitchTo")
  )}">🌐 ${escapeHtml(L("langToggleLabel"))}</button>`;
}

function bindLangToggle(rerenderFn) {
  const btn = document.getElementById("co-lang-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    app.langOverridden = true;
    app.langMode = app.langMode === "kids" ? "general" : "kids";
    rerenderFn();
  });
}

async function renderJoinView() {
  document.body.classList.remove("is-playing");
  const root = document.getElementById("co-app");
  if (!root) return;

  const hasPresetRoom = Boolean(app.roomId && app.room);
  const groupObj = hasPresetRoom ? app.room.groups?.[app.groupId] : null;
  const localRooms = !hasPresetRoom ? await app.sync.listRooms() : [];

  root.innerHTML = `
    <header class="co-header">
      <div class="co-brand">
        ${LOGO_HTML}
        <div>
          <div class="co-brand-title">こだいらSVCs</div>
          <div class="co-brand-sub">${escapeHtml(L("brandSub"))}</div>
        </div>
      </div>
      <div class="co-header-actions">
        ${renderLangToggleBtn()}
      </div>
    </header>
    <main class="co-narrow">
      <div class="co-card" data-testid="coop-join-view">
        <h2>👋 ${escapeHtml(L("joinTitle"))}</h2>
        <p style="margin:0 0 16px;color:var(--co-muted);font-size:0.92rem;">${escapeHtml(L("joinSubtitle"))}</p>

        ${
          hasPresetRoom
            ? `<div style="padding:12px 14px;border-radius:14px;background:var(--co-primary-soft);border:2px solid #bfdbfe;margin-bottom:16px;">
                 <div style="font-size:0.82rem;color:var(--co-primary);font-weight:700;">${escapeHtml(
                   app.room.meta.title || app.roomId
                 )}</div>
                 <div style="font-size:1.15rem;font-weight:800;margin-top:2px;" data-testid="coop-preset-group">${escapeHtml(
                   groupObj?.name || app.groupId
                 )}</div>
               </div>`
            : `<div class="co-field">
                 <label class="co-label" for="co-room-input">${escapeHtml(L("roomLabel"))}</label>
                 <div style="display:flex;gap:8px;">
                   <input class="co-input" id="co-room-input" data-testid="co-room-input" placeholder="${escapeHtml(
                     L("roomPlaceholder")
                   )}" value="${escapeHtml(app.roomId)}" />
                   <button type="button" class="co-btn" id="co-room-lookup">確認</button>
                 </div>
                 ${
                   localRooms.length
                     ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
                          ${localRooms
                            .slice(0, 4)
                            .map(
                              (r) =>
                                `<button type="button" class="co-btn co-btn-sm" data-pick-room="${escapeHtml(
                                  r.id
                                )}">${escapeHtml(r.meta.title || r.id)}</button>`
                            )
                            .join("")}
                        </div>`
                     : ""
                 }
               </div>
               <div class="co-field" id="co-group-select-wrap" ${app.room ? "" : "hidden"}>
                 <label class="co-label" for="co-group-select">${escapeHtml(L("groupLabel"))}</label>
                 <select class="co-select" id="co-group-select" data-testid="co-group-select">
                   ${
                     app.room
                       ? Object.values(app.room.groups || {})
                           .map(
                             (g) =>
                               `<option value="${escapeHtml(g.id)}" ${
                                 g.id === app.groupId ? "selected" : ""
                               }>${escapeHtml(g.name)}</option>`
                           )
                           .join("")
                       : ""
                   }
                 </select>
               </div>`
        }

        <div class="co-field">
          <label class="co-label" for="co-nick-input">${escapeHtml(L("nicknameLabel"))}</label>
          <input class="co-input" id="co-nick-input" data-testid="co-nick-input" placeholder="${escapeHtml(
            L("nicknamePlaceholder")
          )}" value="${escapeHtml(app.nickname)}" autocomplete="nickname" />
        </div>

        <button type="button" class="co-btn co-btn-primary co-btn-lg" id="co-join-btn" data-testid="co-join-btn" style="width:100%;" ${
          app.room ? "" : "disabled"
        }>🚀 ${escapeHtml(L("joinBtn"))}</button>
      </div>
    </main>
  `;

  bindLangToggle(renderJoinView);

  const nickInp = document.getElementById("co-nick-input");
  nickInp.addEventListener("input", () => {
    app.nickname = nickInp.value;
  });

  if (!hasPresetRoom) {
    const roomInp = document.getElementById("co-room-input");
    const loadRoomById = async (rid) => {
      const r = await app.sync.getRoom(rid.trim());
      if (!r) {
        toast("訓練ルームが見つかりませんでした", "warn");
        return;
      }
      app.roomId = r.id;
      app.room = r;
      if (!app.langOverridden && r.meta?.langMode) app.langMode = r.meta.langMode;
      app.groupId = Object.keys(r.groups || {})[0] || "";
      renderJoinView();
    };
    document.getElementById("co-room-lookup")?.addEventListener("click", () => loadRoomById(roomInp.value));
    root.querySelectorAll("[data-pick-room]").forEach((b) =>
      b.addEventListener("click", () => loadRoomById(b.dataset.pickRoom))
    );
    document.getElementById("co-group-select")?.addEventListener("change", (e) => {
      app.groupId = e.target.value;
    });
  }

  document.getElementById("co-join-btn").addEventListener("click", async () => {
    const nick = (app.nickname || "").trim();
    if (!nick) {
      toast(L("nicknamePlaceholder"), "warn");
      nickInp.focus();
      return;
    }
    if (!app.room || !app.groupId) return;
    app.nickname = nick;
    await app.sync.joinGroup(app.roomId, app.groupId, app.memberId, nick);
    startPlaySession();
  });
}

async function renderPdfTakeHomeView() {
  document.body.classList.remove("is-playing");
  const root = document.getElementById("co-app");
  const room = app.room;
  const g = room?.groups?.[app.groupId];
  if (!root || !room || !g) return;
  const placedCount = Object.keys(g.placed || {}).length;

  root.innerHTML = `
    <header class="co-header">
      <div class="co-brand">
        ${LOGO_HTML}
        <div>
          <div class="co-brand-title">こだいらSVCs</div>
          <div class="co-brand-sub">${escapeHtml(room.meta.title || "")} ／ ${escapeHtml(g.name)}</div>
        </div>
      </div>
      <div class="co-header-actions">
        ${renderLangToggleBtn()}
      </div>
    </header>
    <main class="co-narrow">
      <div class="co-card" data-testid="coop-pdf-view" style="text-align:center;">
        <h2>📄 ${escapeHtml(L("pdfExportTitle"))}</h2>
        <p style="color:var(--co-muted);font-size:0.95rem;">${escapeHtml(L("pdfExportDesc"))}</p>
        <div style="margin:14px 0;padding:12px;border-radius:12px;background:var(--co-primary-soft);font-weight:800;">
          ${escapeHtml(g.name)}：${escapeHtml(L("placedProgress", { placed: placedCount, total: room.cards.length }))}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
          <button type="button" class="co-btn co-btn-primary co-btn-lg" id="co-dl-pdf-btn" data-testid="co-dl-pdf-btn">⬇ ${escapeHtml(
            L("pdfExportBtn")
          )}</button>
          <button type="button" class="co-btn" id="co-open-board-btn">${escapeHtml(L("openBoardBtn"))}</button>
        </div>
        <div id="co-pdf-progress" style="margin-top:10px;font-size:0.88rem;color:var(--co-muted);"></div>
      </div>
    </main>
  `;

  bindLangToggle(renderPdfTakeHomeView);
  document.getElementById("co-dl-pdf-btn").addEventListener("click", async () => {
    const prog = document.getElementById("co-pdf-progress");
    const board = app.boards.find((b) => b.id === room.meta.boardId) || resolveDefaultBoard(app.boards);
    const tmpStage = createBoardStage({
      stageEl: document.createElement("div"),
      baseCanvasEl: document.createElement("canvas"),
      cardWorldEl: null,
      clusterLayerEl: null,
      imageCache: app.imageCache,
      readOnly: true,
    });
    try {
      await tmpStage.initBoard(board, room.meta.sizeId);
      await exportBoardToPdf({
        boardInfo: tmpStage.state.boardInfo,
        geo: tmpStage.state.geo,
        baseOffscreen: tmpStage.state.baseOffscreen,
        imageCache: app.imageCache,
        deckTitle: room.meta.deckTitle,
        boardName: board?.name || "",
        groupName: g.name,
        cards: room.cards,
        placed: g.placed,
        onProgress: (m) => {
          if (prog) prog.textContent = m;
        },
      });
      if (prog) prog.textContent = "ダウンロードが完了しました！";
    } catch (err) {
      toast(`PDFエラー: ${err.message}`, "error");
    } finally {
      tmpStage.destroy();
    }
  });
  document.getElementById("co-open-board-btn").addEventListener("click", () => {
    app.actionMode = "";
    renderJoinView();
  });
}

function startPlaySession() {
  app.joined = true;
  app.prevHandSet = null;
  app.prevPlacedSet = null;
  if (app.unsub) app.unsub();
  renderPlayShell();
  app.unsub = app.sync.subscribeRoom(
    app.roomId,
    (room) => {
      if (!room) return;
      app.room = room;
      syncPlayState();
    },
    { groupId: app.groupId }
  );
}

function renderPlayShell() {
  document.body.classList.add("is-playing");
  const root = document.getElementById("co-app");
  const room = app.room;
  const g = room?.groups?.[app.groupId];
  if (!root || !room || !g) return;

  const board = app.boards.find((b) => b.id === room.meta.boardId) || resolveDefaultBoard(app.boards);

  root.innerHTML = `
    <div class="co-play" data-testid="coop-play-view">
      <header class="co-topbar">
        ${LOGO_HTML}
        <div class="co-topbar-group">
          <div class="co-topbar-title" data-testid="coop-group-title">${escapeHtml(g.name)}</div>
          <span class="co-online-pill" id="co-online-info"></span>
        </div>
        <div class="co-topbar-spacer"></div>
        <span class="co-timer-badge" id="co-timer-badge" hidden></span>
        <span class="co-progress-pill" id="co-progress-text" data-testid="coop-progress"></span>
        ${renderLangToggleBtn()}
        <button type="button" class="co-btn co-btn-sm" id="co-menu-btn" data-testid="coop-menu-btn">☰</button>
      </header>
      <div class="co-banner" id="co-banner" data-testid="coop-banner" hidden></div>
      <div class="bd-stage" id="co-stage" data-testid="coop-stage">
        <canvas class="bd-viewport-canvas" id="bd-base-canvas"></canvas>
        <div class="bd-world bd-card-world" id="co-card-world"></div>
        <div class="bd-cluster-layer" id="co-cluster-layer"></div>
        <div class="bd-selbar" id="co-selbar" hidden>
          <button type="button" class="co-btn co-btn-sm" id="co-sel-zoom">🔍 ${escapeHtml(L("zoomDetail"))}</button>
          <button type="button" class="co-btn co-btn-sm" id="co-sel-return">↩ ${escapeHtml(L("returnToHand"))}</button>
          <button type="button" class="co-btn co-btn-sm" id="co-sel-close">✕</button>
        </div>
        <div class="bd-zoom-ctrl">
          <button type="button" id="co-zin" data-testid="coop-zoom-in" aria-label="${escapeHtml(L("zoomIn"))}">＋</button>
          <button type="button" id="co-zout" data-testid="coop-zoom-out" aria-label="${escapeHtml(L("zoomOut"))}">－</button>
          <button type="button" id="co-zfit" data-testid="coop-zoom-fit" aria-label="${escapeHtml(L("fitView"))}">⤢</button>
        </div>
      </div>
      <footer class="co-bottombar">
        <div class="co-hand-label">
          <span>${escapeHtml(L("handLabel"))}</span>
          <span class="co-hand-count" id="co-hand-count" data-testid="coop-hand-count">0</span>
        </div>
        <div class="co-hand" id="co-hand" data-testid="coop-hand"></div>
      </footer>
    </div>
  `;

  bindLangToggle(() => {
    renderPlayShell();
    syncPlayState();
  });

  if (app.stage) app.stage.destroy();
  app.stage = createBoardStage({
    stageEl: document.getElementById("co-stage"),
    baseCanvasEl: document.getElementById("bd-base-canvas"),
    cardWorldEl: document.getElementById("co-card-world"),
    clusterLayerEl: document.getElementById("co-cluster-layer"),
    imageCache: app.imageCache,
    readOnly: false,
    onSelectCard: (idx) => {
      const selbar = document.getElementById("co-selbar");
      if (selbar) selbar.hidden = idx == null;
    },
    onDragState: (idx, dragging) => {
      app.sync.setCardLock(
        app.roomId,
        app.groupId,
        idx,
        dragging ? { memberId: app.memberId, name: app.nickname, at: Date.now() } : null
      );
    },
    onMoveCard: async (idx, x, y) => {
      const grp = app.room?.groups?.[app.groupId];
      if (!grp) return;
      const nextZ = (grp.z || 1) + 1;
      const posObj = { x: roundCoord(x), y: roundCoord(y), z: nextZ, by: app.nickname };
      grp.placed = grp.placed || {};
      grp.placed[String(idx)] = posObj;
      grp.z = nextZ;
      syncPlayState();
      await app.sync.placeOrMoveCard(app.roomId, app.groupId, idx, posObj, null, nextZ);
    },
    getBadgeText: (idx, p, lock) => {
      if (lock && lock.memberId !== app.memberId) {
        return L("draggingBy", { name: lock.name });
      }
      return p.by ? L("placedBy", { name: p.by }) : "";
    },
  });

  document.getElementById("co-zin").addEventListener("click", () => app.stage?.zoomIn());
  document.getElementById("co-zout").addEventListener("click", () => app.stage?.zoomOut());
  document.getElementById("co-zfit").addEventListener("click", () => app.stage?.zoomFit());
  document.getElementById("co-sel-close").addEventListener("click", () => app.stage?.selectCard(null));
  document.getElementById("co-sel-zoom").addEventListener("click", () => {
    const idx = app.stage?.state?.selected;
    if (idx != null) openCardPreviewModal(idx, "placed");
  });
  document.getElementById("co-sel-return").addEventListener("click", async () => {
    const idx = app.stage?.state?.selected;
    if (idx == null) return;
    await returnCardToHand(idx);
    app.stage?.selectCard(null);
  });
  document.getElementById("co-menu-btn").addEventListener("click", openMenuModal);

  app.stage.initBoard(board, room.meta.sizeId).then(() => syncPlayState());
  clearInterval(app.timerInterval);
  app.timerInterval = setInterval(updateTimerBadge, 500);
}

function updateTimerBadge() {
  const el = document.getElementById("co-timer-badge");
  if (!el || !app.room) return;
  const txt = formatTimer(app.room.facilitator?.timer);
  if (txt) {
    el.textContent = `⏱ ${txt}`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function syncPlayState() {
  const room = app.room;
  const g = room?.groups?.[app.groupId];
  if (!room || !g) return;

  const memberCount = Object.keys(g.members || {}).length;
  const onlineEl = document.getElementById("co-online-info");
  if (onlineEl) onlineEl.textContent = `👤${L("membersOnline", { n: memberCount })}`;

  const placedCount = Object.keys(g.placed || {}).length;
  const progEl = document.getElementById("co-progress-text");
  if (progEl) progEl.textContent = L("placedProgress", { placed: placedCount, total: room.cards.length });

  const banner = document.getElementById("co-banner");
  if (banner) {
    const msg = room.facilitator?.message;
    if (msg) {
      banner.textContent = `📢 ${msg}`;
      banner.hidden = false;
    } else {
      banner.textContent = "";
      banner.hidden = true;
    }
  }
  updateTimerBadge();

  if (app.stage) {
    app.stage.syncCards(room.cards, g.placed, g.locks);
  }

  // 手札トレイ更新（新規配布と台紙からの返却を区別して通知）
  const hand = g.hand || [];
  const curHandSet = new Set(hand);
  const curPlacedSet = new Set(Object.keys(g.placed || {}).map(Number));
  if (app.prevHandSet !== null) {
    const added = hand.filter((i) => !app.prevHandSet.has(i));
    if (added.length > 0) {
      const returnedCount = added.filter((i) => app.prevPlacedSet?.has(i)).length;
      const dealtCount = added.length - returnedCount;
      if (dealtCount > 0) toast(L("newCardToast", { n: dealtCount }), "info");
      if (returnedCount > 0) toast(L("returnedCardToast"), "info");
    }
  }
  app.prevHandSet = curHandSet;
  app.prevPlacedSet = curPlacedSet;

  const hc = document.getElementById("co-hand-count");
  if (hc) hc.textContent = String(hand.length);

  const handEl = document.getElementById("co-hand");
  if (handEl) {
    const handSig = `${app.langMode}:${hand.join(",")}`;
    if (handEl.dataset.handSig !== handSig) {
      handEl.dataset.handSig = handSig;
      if (hand.length === 0) {
        handEl.innerHTML = `<div class="co-hand-empty">${escapeHtml(L("waitingCards"))}</div>`;
      } else {
        handEl.innerHTML = "";
        hand.forEach((idx) => {
          const card = room.cards[idx];
          const info = cardSummary(card, idx);
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `co-hand-card ${info.isEvent ? "is-event" : ""}`;
          btn.dataset.idx = String(idx);
          btn.dataset.testid = `coop-hand-card-${idx}`;
          btn.innerHTML = `<img alt="No.${info.no}" draggable="false" />`;
          app.imageCache.ensure(idx, card).then((m) => {
            const img = btn.querySelector("img");
            if (img) img.src = m.url;
          });
          attachHandCardDrag(btn, idx);
          handEl.appendChild(btn);
        });
      }
    }
  }
}

function attachHandCardDrag(btn, idx) {
  let drag = null;

  const cleanup = () => {
    if (!drag) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    btn.classList.remove("is-dragging");
    if (drag.ghost) drag.ghost.remove();
    drag = null;
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (!drag.moved && d > 6) {
      drag.moved = true;
      btn.classList.add("is-dragging");
      const ghost = document.createElement("div");
      ghost.className = "co-drag-ghost";
      const srcImg = btn.querySelector("img")?.src || "";
      ghost.innerHTML = `<img src="${srcImg}" alt="" />`;
      document.body.appendChild(ghost);
      drag.ghost = ghost;
    }
    if (drag.moved && drag.ghost) {
      drag.ghost.style.left = `${e.clientX}px`;
      drag.ghost.style.top = `${e.clientY}px`;
    }
  };

  const onUp = async (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const moved = drag.moved;
    const cx = e.clientX;
    const cy = e.clientY;
    cleanup();
    if (!moved) {
      openCardPreviewModal(idx, "hand");
      return;
    }
    const stageEl = document.getElementById("co-stage");
    const geo = app.stage?.state?.geo;
    if (!stageEl || !geo) return;
    const rect = stageEl.getBoundingClientRect();
    if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
      const w = app.stage.screenToWorld(cx - rect.left, cy - rect.top);
      const wx = clamp(w.x, -DESK_MARGIN + CARD_W / 2, geo.W + DESK_MARGIN - CARD_W / 2);
      const wy = clamp(w.y, -DESK_MARGIN + CARD_H / 2, geo.H + DESK_MARGIN - CARD_H / 2);
      await placeHandCard(idx, wx, wy, { autoZoom: false });
    }
  };

  const onCancel = (e) => {
    if (drag && e.pointerId === drag.pid) cleanup();
  };

  btn.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    cleanup();
    drag = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
}

async function placeHandCard(idx, x, y, { autoZoom = true } = {}) {
  const g = app.room?.groups?.[app.groupId];
  if (!g) return;
  const hand = (g.hand || []).filter((i) => i !== idx);
  const nextZ = (g.z || 1) + 1;
  const posObj = { x: roundCoord(x), y: roundCoord(y), z: nextZ, by: app.nickname };
  g.placed = { ...(g.placed || {}), [String(idx)]: posObj };
  g.hand = hand;
  g.z = nextZ;
  if (app.prevHandSet) app.prevHandSet = new Set(hand);
  if (app.prevPlacedSet) app.prevPlacedSet.add(idx);
  syncPlayState();
  await app.sync.placeOrMoveCard(app.roomId, app.groupId, idx, posObj, hand, nextZ);
  if (autoZoom) app.stage?.zoomToCards([{ x: posObj.x, y: posObj.y }], 80);
}

async function returnCardToHand(idx) {
  const g = app.room?.groups?.[app.groupId];
  if (!g) return;
  const placed = { ...(g.placed || {}) };
  delete placed[String(idx)];
  const hand = [...(g.hand || [])];
  if (!hand.includes(idx)) hand.push(idx);
  g.placed = placed;
  g.hand = hand;
  syncPlayState();
  await app.sync.returnCard(app.roomId, app.groupId, idx, hand);
}

function openCardPreviewModal(idx, source) {
  const card = app.room?.cards?.[idx];
  if (!card) return;
  const info = cardSummary(card, idx);
  const back = document.createElement("div");
  back.className = "co-modal-backdrop";
  back.innerHTML = `
    <div class="co-modal-dialog" role="dialog" aria-modal="true" data-testid="coop-preview-dialog">
      <div class="co-modal-head" style="justify-content:flex-end;margin-bottom:8px;">
        <button type="button" class="co-btn co-btn-sm" data-act="close">✕</button>
      </div>
      <img class="co-preview-img" id="co-prev-img" alt="No.${info.no}" />
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${
          source === "hand"
            ? `<button type="button" class="co-btn co-btn-primary co-btn-lg" data-act="center" data-testid="coop-place-center">${escapeHtml(
                L("placeCenter")
              )}</button>
               <button type="button" class="co-btn co-btn-green co-btn-lg" data-act="empty" data-testid="coop-place-empty">${escapeHtml(
                 L("placeEmpty")
               )}</button>`
            : `<button type="button" class="co-btn co-btn-lg" data-act="return">${escapeHtml(
                L("returnToHand")
              )}</button>`
        }
      </div>
    </div>
  `;
  document.body.appendChild(back);
  app.imageCache.ensure(idx, card).then((m) => {
    const img = back.querySelector("#co-prev-img");
    if (img) img.src = m.url;
  });
  back.addEventListener("click", async (e) => {
    if (e.target === back || e.target.closest('[data-act="close"]')) {
      back.remove();
      return;
    }
    if (e.target.closest('[data-act="center"]')) {
      back.remove();
      const c = app.stage.viewCenterWorld();
      const geo = app.stage.state.geo;
      await placeHandCard(idx, clamp(c.x, CARD_W / 2, geo.W - CARD_W / 2), clamp(c.y, CARD_H / 2, geo.H - CARD_H / 2));
    } else if (e.target.closest('[data-act="empty"]')) {
      back.remove();
      const c = app.stage.viewCenterWorld();
      const pos = app.stage.findEmptySpot(c);
      await placeHandCard(idx, pos.x, pos.y);
    } else if (e.target.closest('[data-act="return"]')) {
      back.remove();
      await returnCardToHand(idx);
      app.stage?.selectCard(null);
    }
  });
}

function openMenuModal() {
  const g = app.room?.groups?.[app.groupId];
  const pdfUrl = buildTakeHomePdfUrl();
  const back = document.createElement("div");
  back.className = "co-modal-backdrop";
  back.innerHTML = `
    <div class="co-modal-dialog" role="dialog" aria-modal="true">
      <div class="co-modal-head">
        <span class="co-modal-title">☰ ${escapeHtml(L("menu"))}</span>
        <button type="button" class="co-btn co-btn-sm" data-act="close">✕</button>
      </div>
      <div class="co-qr-box" style="margin-bottom:12px;">
        <div style="font-weight:800;">${escapeHtml(L("qrTakeHome"))}</div>
        <canvas id="co-takehome-qr"></canvas>
        <p style="margin:0;font-size:0.84rem;color:var(--co-muted);text-align:center;">${escapeHtml(
          L("qrTakeHomeDesc")
        )}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button type="button" class="co-btn co-btn-primary co-btn-lg" data-act="pdf" data-testid="coop-menu-pdf">⬇ ${escapeHtml(
          L("downloadPdf")
        )}</button>
        <details style="padding:8px 12px;border:1px solid var(--co-border);border-radius:12px;">
          <summary style="font-weight:700;cursor:pointer;">${escapeHtml(L("howToTitle"))}</summary>
          <p style="white-space:pre-line;font-size:0.86rem;margin:8px 0 0;">${escapeHtml(L("howToBody"))}</p>
        </details>
        <button type="button" class="co-btn" data-act="leave">${escapeHtml(L("leaveBtn"))}</button>
      </div>
    </div>
  `;
  document.body.appendChild(back);
  renderQrToCanvas(back.querySelector("#co-takehome-qr"), pdfUrl, { targetSize: 220, quietModules: 5 });
  back.addEventListener("click", async (e) => {
    if (e.target === back || e.target.closest('[data-act="close"]')) {
      back.remove();
      return;
    }
    if (e.target.closest('[data-act="pdf"]')) {
      back.remove();
      const board = app.boards.find((b) => b.id === app.room.meta.boardId) || resolveDefaultBoard(app.boards);
      await exportBoardToPdf({
        boardInfo: app.stage.state.boardInfo,
        geo: app.stage.state.geo,
        baseOffscreen: app.stage.state.baseOffscreen,
        imageCache: app.imageCache,
        deckTitle: app.room.meta.deckTitle,
        boardName: board?.name || "",
        groupName: g?.name || "",
        cards: app.room.cards,
        placed: g?.placed || {},
      });
    } else if (e.target.closest('[data-act="leave"]')) {
      back.remove();
      if (app.unsub) app.unsub();
      if (app.stage) app.stage.destroy();
      app.joined = false;
      renderJoinView();
    }
  });
}

async function boot() {
  app.sync = await createSyncAdapter();
  await loadCardDatabase();
  app.boards = await loadBoardManifest();
  const params = new URLSearchParams(window.location.search);
  app.roomId = (params.get("room") || "").trim();
  app.groupId = (params.get("group") || "").trim();
  app.actionMode = (params.get("action") || "").trim();

  if (app.roomId) {
    app.room = await app.sync.getRoom(app.roomId);
    if (app.room) {
      if (app.room.meta?.langMode) app.langMode = app.room.meta.langMode;
      if (!app.groupId || !app.room.groups?.[app.groupId]) {
        app.groupId = Object.keys(app.room.groups || {})[0] || "";
      }
      if (app.actionMode === "pdf") {
        await renderPdfTakeHomeView();
        return;
      }
    }
  }
  await renderJoinView();
}

boot();
