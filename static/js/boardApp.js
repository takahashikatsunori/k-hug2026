/**
 * HUG 台紙配置シミュレーション (board.html)
 *
 * デッキからカードを1枚ずつ引き、PDFの訓練用台紙（A0の縦横4倍 / 8倍（規定）/ 16倍 実寸比）の上に自由に並べる.
 * - 台紙: pdf.js でベース画像を描画し、拡大時は表示範囲だけを高精細に再描画
 * - カード: 名刺サイズ 55×91mm（台紙と実寸比を一致）
 * - 操作: ドラッグ移動 / ピンチ・ホイールで拡大縮小 / 縮小時は枚数バブル表示
 * - 出力: pdf-lib で元の台紙PDF（ベクター）＋カード画像を重ねたPDFを生成
 */
import { escapeHtml } from "./util.js";
import { store } from "./store.js";
import {
  toCardRenderModel,
  computeGroupPositionMap,
  generateCardImageCanvas,
  resolveCardGroupId,
  FIXED_DESIGN_MODE,
} from "./cardCanvas.js";
import {
  calcPdfUserUnit,
  canvasToJpegBytes,
  imageUrlToJpegBytes,
  deliverPdfBlob,
} from "./boardEngine.js";
import {
  loadCardDatabase,
  loadBoardManifest,
  resolveDefaultBoard,
  fetchSavedDecks,
  buildDeckFromSaved,
  buildDeckFromLocalWebDeck,
  buildDeckFromJsonText,
  hasLocalWebDeck,
  summarizeDeck,
} from "./boardDeckLoader.js";

// ============================================================================
// 定数
// ============================================================================
const CARD_W = 55; // mm (名刺サイズ)
const CARD_H = 91; // mm
const MM_PER_PT = 25.4 / 72;
const PT_PER_MM = 72 / 25.4;
const DESK_MARGIN = 150; // 台紙の外側に置ける余白 (mm)
const CLUSTER_CARD_PX = 28; // 画面上のカード幅がこれ未満になったら枚数バブル表示
const MAX_SCALE = 12; // px/mm (55×91mm カードで最大 660×1092px)
const SESSION_KEY = "hug_board_session_v1";
const SETTINGS_KEY = "hug_board_settings_v1";

export const SHEET_SIZES = {
  "4x": { id: "4x", label: "A0の縦横4倍", mult: 4, short: 841 * 4, long: 1189 * 4 },
  "8x": { id: "8x", label: "A0の縦横8倍（規定）", mult: 8, short: 841 * 8, long: 1189 * 8 },
  "16x": { id: "16x", label: "A0の縦横16倍", mult: 16, short: 841 * 16, long: 1189 * 16 },
  "32x": { id: "32x", label: "A0の縦横32倍", mult: 32, short: 841 * 32, long: 1189 * 32 },
};

export function resolveSheetSize(sizeSpec) {
  if (typeof sizeSpec === "string" && SHEET_SIZES[sizeSpec]) {
    return SHEET_SIZES[sizeSpec];
  }
  const raw = String(sizeSpec || "8x").trim();
  const mMatch = raw.match(/^(?:custom:)?(\d+(?:\.\d+)?)x?$/i);
  if (mMatch) {
    const mult = Math.max(1, Math.min(64, Number(mMatch[1]) || 8));
    if (SHEET_SIZES[`${mult}x`]) return SHEET_SIZES[`${mult}x`];
    return {
      id: `custom:${mult}`,
      label: `A0の縦横${mult}倍`,
      mult,
      short: Math.round(841 * mult),
      long: Math.round(1189 * mult),
    };
  }
  return SHEET_SIZES["8x"];
}

const LOGO_IMG_ATTRS = `src="./static/logo/正式ロゴ.jpeg" onerror="if(!this.dataset.fb1){this.dataset.fb1='1';this.src='./static/logo/official_logo.jpeg';}else if(!this.dataset.fb2){this.dataset.fb2='1';this.src='./logo/正式ロゴ.jpeg';}"`;

const pdfjsLib = window.pdfjsLib;
const ABS = (p) => new URL(p, window.location.href).href;
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = ABS("./static/vendor/pdfjs/pdf.worker.min.js");
}
const PDF_OPTIONS = {
  cMapUrl: ABS("./static/vendor/pdfjs/cmaps/"),
  cMapPacked: true,
  standardFontDataUrl: ABS("./static/vendor/pdfjs/standard_fonts/"),
};

// ============================================================================
// 状態
// ============================================================================
const app = {
  db: null,
  boards: [],
  decks: [],
  setup: {
    deckKey: "",
    deck: null, // { title, cards }
    loading: false,
    error: "",
    boardId: "",
    sizeId: "8x",
    customMult: 24,
  },
  settings: { autoPreview: true, drawByHousehold: true },

  /** @type {null | { v:number, deckTitle:string, cards:any[], boardId:string, sizeId:string, next:number, hand:number[], placed:Record<string,{x:number,y:number,z:number}>, z:number, view?:any, savedAt?:number }} */
  session: null,
  board: null, // マニフェストのエントリ
  boardInfo: null, // { doc, page, bytes, wPt, hPt }
  geo: null, // { W, H, pdf:{x,y,w,h,ptToMm} }
  baseRes: 1, // ベース画像の px/mm
  baseOffscreen: null, // 全台紙のオフスクリーンキャンバス
  detailOffscreen: null, // 拡大表示用の再利用オフスクリーンキャンバス
  ink: null, // 空き領域探索用の積分画像

  view: { s: 1, tx: 0, ty: 0 },
  minScale: 0.1,
  undo: [],
  selected: null,
  models: new Map(),
  posMap: new Map(),
  cardEls: new Map(),
  renderedUrls: new Map(),
  renderPromises: new Map(),
  prefetchTimer: 0,
  prefetchToken: 0,
  els: {},
  exporting: false,
};

const boardCache = new Map();

// ============================================================================
// ユーティリティ
// ============================================================================
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function toast(msg, type = "info", ms = 2600) {
  const c = document.getElementById("bd-toast-container");
  if (!c) return;
  const el = document.createElement("div");
  el.className = `bd-toast bd-toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (typeof s.autoPreview === "boolean") app.settings.autoPreview = s.autoPreview;
    if (typeof s.drawByHousehold === "boolean") app.settings.drawByHousehold = s.drawByHousehold;
  } catch {
    // ignore
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings));
  } catch {
    // ignore
  }
}

function readSavedSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && s.v === 1 && Array.isArray(s.cards) && s.cards.length > 0 && s.boardId) return s;
  } catch {
    // ignore
  }
  return null;
}

let saveTimer = 0;
let saveWarned = false;
function saveSession() {
  if (!app.session) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!app.session) return;
    try {
      app.session.view = { ...app.view };
      app.session.savedAt = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(app.session));
    } catch {
      if (!saveWarned) {
        saveWarned = true;
        toast("ブラウザへの自動保存に失敗しました（容量不足の可能性）", "warn", 4000);
      }
    }
  }, 350);
}

function cardInfo(idx) {
  const c = app.session.cards[idx] || {};
  const no = c.card_number ?? idx + 1;
  const d = c.data || {};
  const name =
    c.kind === "event" ? d.event_name || c.title || "イベント" : d.name || d.pet_name || c.title || "避難者";
  const kindLabel = c.kind === "event" ? "イベント" : c.kind === "pet" ? "ペット" : "避難者";
  return { no, name, kindLabel, isEvent: c.kind === "event" };
}

function getModel(idx) {
  if (app.models.has(idx)) return app.models.get(idx);
  const c = app.session.cards[idx];
  const pos = app.posMap.get(String(c?.original_id || ""));
  const model = c
    ? toCardRenderModel(c, c.group, {
        cardNumber: c.card_number ?? idx + 1,
        imageIds: store.imageIds,
        groupIndex: pos?.group_index ?? c.group_index,
        groupTotal: pos?.group_total ?? c.group_total,
      })
    : null;
  app.models.set(idx, model);
  return model;
}

const PREFETCH_AHEAD = 18;

function getExistingCardDataUrl(idx) {
  const cached = app.renderedUrls.get(idx);
  if (cached) return cached;
  const src = app.cardEls.get(idx)?.querySelector("img")?.getAttribute("src");
  return src && src.startsWith("data:") ? src : "";
}

function ensureCardUrl(idx) {
  const existing = getExistingCardDataUrl(idx);
  if (existing) return Promise.resolve(existing);
  if (app.renderPromises.has(idx)) return app.renderPromises.get(idx);
  const m = getModel(idx);
  if (!m) return Promise.resolve("");
  const p = generateCardImageCanvas(m, FIXED_DESIGN_MODE, { showNumber: true })
    .then((url) => {
      if (app.session && url) app.renderedUrls.set(idx, url);
      return url;
    })
    .catch(() => "")
    .finally(() => {
      app.renderPromises.delete(idx);
    });
  app.renderPromises.set(idx, p);
  return p;
}

function prunePrefetchCache() {
  const s = app.session;
  if (!s || app.renderedUrls.size <= 40) return;
  const handSet = new Set(s.hand);
  for (const idx of app.renderedUrls.keys()) {
    if (idx < s.next && !handSet.has(idx)) {
      app.renderedUrls.delete(idx);
    }
  }
}

function stopPrefetch() {
  app.prefetchToken++;
  clearTimeout(app.prefetchTimer);
  app.prefetchTimer = 0;
}

function schedulePrefetch(delayMs = 20) {
  stopPrefetch();
  if (!app.session) return;
  prunePrefetchCache();
  const token = app.prefetchToken;
  const step = async () => {
    if (token !== app.prefetchToken || !app.session) return;
    if (app.exporting) {
      app.prefetchTimer = setTimeout(step, 200);
      return;
    }
    const s = app.session;
    let nextTarget = null;
    for (const idx of s.hand) {
      if (!getExistingCardDataUrl(idx)) {
        nextTarget = idx;
        break;
      }
    }
    if (nextTarget == null) {
      const end = Math.min(s.cards.length, s.next + PREFETCH_AHEAD);
      for (let i = s.next; i < end; i++) {
        if (!getExistingCardDataUrl(i)) {
          nextTarget = i;
          break;
        }
      }
    }
    if (nextTarget == null) return;
    await ensureCardUrl(nextTarget);
    if (token !== app.prefetchToken || !app.session) return;
    app.prefetchTimer = setTimeout(step, 16);
  };
  app.prefetchTimer = setTimeout(step, delayMs);
}

function bindCardImg(img, idx) {
  if (!img) return;
  img.dataset.renderIdx = String(idx);
  const existing = getExistingCardDataUrl(idx);
  if (existing) {
    img.src = existing;
    return;
  }
  const m = getModel(idx);
  if (!m) return;
  ensureCardUrl(idx).then((url) => {
    if (url && img.dataset.renderIdx === String(idx)) img.src = url;
  });
}

// ============================================================================
// 台紙PDF
// ============================================================================
async function loadBoardInfo(board) {
  if (boardCache.has(board.id)) return boardCache.get(board.id);
  if (!pdfjsLib) throw new Error("PDF描画ライブラリを読み込めませんでした");
  let bytes = board.bytes instanceof Uint8Array ? board.bytes : null;
  if (!bytes) {
    const candidates = [board.url, board.fallbackUrl].filter(Boolean);
    let lastStatus = "";
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          bytes = new Uint8Array(await res.arrayBuffer());
          break;
        }
        lastStatus = String(res.status);
      } catch {
        // 次の候補へ
      }
    }
    if (!bytes) {
      throw new Error(`台紙PDFを取得できませんでした${lastStatus ? ` (${lastStatus})` : ""}`);
    }
  }
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), ...PDF_OPTIONS }).promise;
  const page = await doc.getPage(clamp(board.page || 1, 1, doc.numPages));
  const vp = page.getViewport({ scale: 1 });
  const info = { doc, page, bytes, wPt: vp.width, hPt: vp.height };
  boardCache.set(board.id, info);
  return info;
}

function computeGeometry(info, sizeId) {
  const s = resolveSheetSize(sizeId);
  const landscape = info.wPt >= info.hPt;
  const W = landscape ? s.long : s.short;
  const H = landscape ? s.short : s.long;
  const pw = info.wPt * MM_PER_PT;
  const ph = info.hPt * MM_PER_PT;
  const fit = Math.min(W / pw, H / ph);
  const w = pw * fit;
  const h = ph * fit;
  return { W, H, pdf: { x: (W - w) / 2, y: (H - h) / 2, w, h, ptToMm: MM_PER_PT * fit } };
}

async function renderBoardThumb(board, canvas) {
  try {
    const info = await loadBoardInfo(board);
    const targetW = 300;
    const scale = targetW / info.wPt;
    const vp = info.page.getViewport({ scale });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await info.page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    canvas.classList.add("is-ready");
  } catch {
    canvas.classList.add("is-error");
  }
}

/** ベース画像（台紙全体）をオフスクリーンに描画する. */
async function renderBaseBoard() {
  const { geo, boardInfo } = app;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  const maxPixels = coarse ? 4e6 : 12e6;
  const r = Math.min(Math.sqrt(maxPixels / (geo.W * geo.H)), 8);
  const canvas = app.baseOffscreen || document.createElement("canvas");
  app.baseOffscreen = canvas;
  canvas.width = Math.max(1, Math.round(geo.W * r));
  canvas.height = Math.max(1, Math.round(geo.H * r));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = boardInfo.page.getViewport({ scale: r * geo.pdf.ptToMm });
  await boardInfo.page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, geo.pdf.x * r, geo.pdf.y * r],
  }).promise;
  app.baseRes = r;
  buildInkMap();
  drawViewportBoard();
}

// ---------------------------------------------------------------------------
// 拡大時の高精細描画（表示範囲のみ・GPUレイヤー肥大化を防ぐため単一キャンバスへ合成）
// ---------------------------------------------------------------------------
const detail = { timer: 0, task: null, rendered: null, token: 0 };

function scheduleDetailRender() {
  clearTimeout(detail.timer);
  detail.timer = setTimeout(renderDetail, 90);
}

async function renderDetail() {
  const { geo, boardInfo, els } = app;
  if (!geo || !boardInfo || !els.stage) return;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 2 : 2.5);
  const v = { ...app.view };
  const r = v.s * dpr;
  if (r <= app.baseRes * 1.15) {
    detail.rendered = null;
    drawViewportBoard();
    return;
  }
  const token = ++detail.token;
  if (detail.task) {
    try {
      detail.task.cancel();
    } catch {
      // ignore
    }
    detail.task = null;
  }
  const vw = els.stage.clientWidth;
  const vh = els.stage.clientHeight;
  if (!vw || !vh) return;

  // ビューポートサイズのオフスクリーンへベクターPDFを実画面ネイティブ解像度で直接描画する
  const offW = Math.max(1, Math.round(vw * dpr));
  const offH = Math.max(1, Math.round(vh * dpr));

  const off = app.detailOffscreen || document.createElement("canvas");
  app.detailOffscreen = off;
  if (off.width !== offW || off.height !== offH) {
    off.width = offW;
    off.height = offH;
  }
  const ctx = off.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, offW, offH);

  const sx = v.tx * dpr;
  const sy = v.ty * dpr;
  const sx0 = clamp(sx, 0, offW);
  const sy0 = clamp(sy, 0, offH);
  const sx1 = clamp(sx + geo.W * r, 0, offW);
  const sy1 = clamp(sy + geo.H * r, 0, offH);
  if (sx1 > sx0 && sy1 > sy0) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  }

  try {
    const viewport = boardInfo.page.getViewport({ scale: r * geo.pdf.ptToMm });
    const task = boardInfo.page.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, sx + geo.pdf.x * r, sy + geo.pdf.y * r],
      background: "rgba(0,0,0,0)",
    });
    detail.task = task;
    await task.promise;
  } catch {
    return; // キャンセルまたは一時エラー
  }
  if (token !== detail.token) return;
  detail.task = null;
  detail.rendered = { s: v.s, tx: v.tx, ty: v.ty, vw, vh };
  drawViewportBoard();
}

function drawViewportBoard() {
  const { els, geo } = app;
  const canvas = els.baseCanvas;
  if (!canvas || !els.stage) return;
  const vw = els.stage.clientWidth;
  const vh = els.stage.clientHeight;
  if (!vw || !vh) return;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 2 : 2.5);
  const cw = Math.max(1, Math.round(vw * dpr));
  const ch = Math.max(1, Math.round(vh * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!geo) return;

  const { s, tx, ty } = app.view;
  const k = s * dpr;

  // デスク余白（ビューポート内にクリップして描画）
  const deskX0 = clamp((tx - DESK_MARGIN * s) * dpr, 0, cw);
  const deskY0 = clamp((ty - DESK_MARGIN * s) * dpr, 0, ch);
  const deskX1 = clamp((tx + (geo.W + DESK_MARGIN) * s) * dpr, 0, cw);
  const deskY1 = clamp((ty + (geo.H + DESK_MARGIN) * s) * dpr, 0, ch);
  if (deskX1 > deskX0 && deskY1 > deskY0) {
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(deskX0, deskY0, deskX1 - deskX0, deskY1 - deskY0);
  }

  // 台紙の白地と枠線（shadowBlur は巨大座標でモバイルGPUメモリを圧迫するため使わない）
  const sx0 = clamp(tx * dpr, 0, cw);
  const sy0 = clamp(ty * dpr, 0, ch);
  const sx1 = clamp((tx + geo.W * s) * dpr, 0, cw);
  const sy1 = clamp((ty + geo.H * s) * dpr, 0, ch);
  if (sx1 > sx0 && sy1 > sy0) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  }

  // ベース画像（可視領域のみ転送）
  const base = app.baseOffscreen;
  if (base && base.width > 0 && base.height > 0) {
    const wx0 = clamp(-tx / s, 0, geo.W);
    const wy0 = clamp(-ty / s, 0, geo.H);
    const wx1 = clamp((vw - tx) / s, 0, geo.W);
    const wy1 = clamp((vh - ty) / s, 0, geo.H);
    if (wx1 > wx0 && wy1 > wy0) {
      const srcX = wx0 * app.baseRes;
      const srcY = wy0 * app.baseRes;
      const srcW = (wx1 - wx0) * app.baseRes;
      const srcH = (wy1 - wy0) * app.baseRes;
      const dstX = (wx0 * s + tx) * dpr;
      const dstY = (wy0 * s + ty) * dpr;
      const dstW = (wx1 - wx0) * k;
      const dstH = (wy1 - wy0) * k;
      ctx.drawImage(base, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
    }
  }

  // 高精細ディテール画像（拡大時）
  const r = detail.rendered;
  const det = app.detailOffscreen;
  if (r && det && det.width > 0 && det.height > 0 && s * dpr > app.baseRes * 1.15) {
    const scaleRatio = s / r.s;
    const dx = (tx - r.tx * scaleRatio) * dpr;
    const dy = (ty - r.ty * scaleRatio) * dpr;
    const dw = r.vw * scaleRatio * dpr;
    const dh = r.vh * scaleRatio * dpr;
    ctx.drawImage(det, 0, 0, det.width, det.height, dx, dy, dw, dh);
  }
}

// ---------------------------------------------------------------------------
// 空き領域の探索（台紙の描画が少なく、他のカードと重ならない場所）
// ---------------------------------------------------------------------------
function buildInkMap() {
  const { geo } = app;
  const cell = Math.max(5, Math.ceil(Math.max(geo.W, geo.H) / 360)); // mm (keep grid <= ~360 cells on longest side)
  const gw = Math.ceil(geo.W / cell);
  const gh = Math.ceil(geo.H / cell);
  // 段階的に縮小して細い線も平均化して残す
  let src = app.baseOffscreen || app.els.baseCanvas;
  let w = src.width;
  let h = src.height;
  while (w / 2 > gw * 1.5) {
    const nw = Math.max(gw, Math.round(w / 2));
    const nh = Math.max(gh, Math.round(h / 2));
    const c = document.createElement("canvas");
    c.width = nw;
    c.height = nh;
    c.getContext("2d").drawImage(src, 0, 0, nw, nh);
    src = c;
    w = nw;
    h = nh;
  }
  const out = document.createElement("canvas");
  out.width = gw;
  out.height = gh;
  const octx = out.getContext("2d", { willReadFrequently: true });
  octx.drawImage(src, 0, 0, gw, gh);
  const data = octx.getImageData(0, 0, gw, gh).data;
  const sat = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) {
    let rowSum = 0;
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      rowSum += 1 - lum / 255;
      sat[(y + 1) * (gw + 1) + (x + 1)] = sat[y * (gw + 1) + (x + 1)] + rowSum;
    }
  }
  app.ink = { cell, gw, gh, sat };
}

function findEmptySpot(prefer) {
  const { ink, geo, session } = app;
  if (!ink) return { x: prefer.x, y: prefer.y };
  const { cell, gw, gh, sat } = ink;
  const cw = Math.ceil((CARD_W + 6) / cell);
  const ch = Math.ceil((CARD_H + 6) / cell);
  const step = gw * gh > 60000 ? 2 : 1;
  const rects = Object.values(session.placed).map((p) => [
    p.x - CARD_W / 2 - 4,
    p.y - CARD_H / 2 - 4,
    p.x + CARD_W / 2 + 4,
    p.y + CARD_H / 2 + 4,
  ]);
  const diag = Math.hypot(geo.W, geo.H);
  const area = cw * ch;
  let best = null;
  for (let gy = 1; gy + ch < gh; gy += step) {
    for (let gx = 1; gx + cw < gw; gx += step) {
      const s =
        sat[(gy + ch) * (gw + 1) + (gx + cw)] -
        sat[gy * (gw + 1) + (gx + cw)] -
        sat[(gy + ch) * (gw + 1) + gx] +
        sat[gy * (gw + 1) + gx];
      const x0 = gx * cell;
      const y0 = gy * cell;
      const x1 = x0 + cw * cell;
      const y1 = y0 + ch * cell;
      let overlap = 0;
      for (const r of rects) {
        const ox = Math.min(x1, r[2]) - Math.max(x0, r[0]);
        const oy = Math.min(y1, r[3]) - Math.max(y0, r[1]);
        if (ox > 0 && oy > 0) overlap += ox * oy;
      }
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const score =
        (s / area) * 100 + (overlap / (CARD_W * CARD_H)) * 60 + (Math.hypot(cx - prefer.x, cy - prefer.y) / diag) * 6;
      if (!best || score < best.score) best = { score, x: cx, y: cy };
    }
  }
  return best || { x: prefer.x, y: prefer.y };
}

// ============================================================================
// ビュー（拡大縮小・パン）
// ============================================================================
function stageSize() {
  const st = app.els.stage;
  return { w: st?.clientWidth || window.innerWidth, h: st?.clientHeight || window.innerHeight };
}

function fitView() {
  const { w, h } = stageSize();
  const pad = Math.min(24, w * 0.04);
  const s = Math.min((w - pad * 2) / app.geo.W, (h - pad * 2) / app.geo.H);
  return { s, tx: (w - app.geo.W * s) / 2, ty: (h - app.geo.H * s) / 2 };
}

function updateScaleLimits() {
  app.minScale = fitView().s * 0.35;
}

function clampView(v) {
  const { w, h } = stageSize();
  const s = clamp(v.s, app.minScale, MAX_SCALE);
  const keep = 80;
  const x0 = -DESK_MARGIN * s;
  const x1 = (app.geo.W + DESK_MARGIN) * s;
  const y0 = -DESK_MARGIN * s;
  const y1 = (app.geo.H + DESK_MARGIN) * s;
  const tx = clamp(v.tx, keep - x1, w - keep - x0);
  const ty = clamp(v.ty, keep - y1, h - keep - y0);
  return { s, tx, ty };
}

let viewRaf = 0;
function requestView() {
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => {
    viewRaf = 0;
    applyView();
  });
}

function isClusterMode() {
  return CARD_W * app.view.s < CLUSTER_CARD_PX;
}

function applyView() {
  const { els } = app;
  if (!els.stage) return;
  const { s, tx, ty } = app.view;
  const t = `translate(${tx}px, ${ty}px) scale(${s})`;
  els.cardWorld.style.transform = t;
  const cluster = isClusterMode();
  els.stage.classList.toggle("is-cluster", cluster);
  if (app.selected != null) {
    const el = app.cardEls.get(app.selected);
    if (el) el.style.setProperty("--ui-px", `${1 / s}px`);
  }
  renderClusters();
  drawViewportBoard();
  scheduleDetailRender();
}

function setView(v, { save = false } = {}) {
  app.view = clampView(v);
  requestView();
  if (save) saveSession();
}

function zoomAt(px, py, factor) {
  const { s, tx, ty } = app.view;
  const s1 = clamp(s * factor, app.minScale, MAX_SCALE);
  const wx = (px - tx) / s;
  const wy = (py - ty) / s;
  setView({ s: s1, tx: px - wx * s1, ty: py - wy * s1 });
}

let anim = { token: 0 };
function animateTo(target, ms = 320) {
  const token = ++anim.token;
  const from = { ...app.view };
  const to = clampView(target);
  const { w, h } = stageSize();
  const c0 = { x: (w / 2 - from.tx) / from.s, y: (h / 2 - from.ty) / from.s };
  const c1 = { x: (w / 2 - to.tx) / to.s, y: (h / 2 - to.ty) / to.s };
  const t0 = performance.now();
  app.els.stage?.classList.add("is-gesturing");
  const step = (now) => {
    if (token !== anim.token) return;
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
    const cx = c0.x + (c1.x - c0.x) * e;
    const cy = c0.y + (c1.y - c0.y) * e;
    app.view = { s, tx: w / 2 - cx * s, ty: h / 2 - cy * s };
    applyView();
    if (p < 1) requestAnimationFrame(step);
    else {
      app.view = to;
      applyView();
      app.els.stage?.classList.remove("is-gesturing");
      saveSession();
    }
  };
  requestAnimationFrame(step);
}

function cancelAnimation() {
  anim.token++;
}

function fitBounds(x0, y0, x1, y1, { minCardPx = CLUSTER_CARD_PX * 2.6 } = {}) {
  const { w, h } = stageSize();
  const pad = 40;
  const bw = Math.max(x1 - x0, CARD_W);
  const bh = Math.max(y1 - y0, CARD_H);
  let s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  s = clamp(s, minCardPx / CARD_W, Math.min(MAX_SCALE, 6));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { s, tx: w / 2 - cx * s, ty: h / 2 - cy * s };
}

function focusCard(idx) {
  const p = app.session.placed[idx];
  if (!p) return;
  const { w, h } = stageSize();
  const sx = p.x * app.view.s + app.view.tx;
  const sy = p.y * app.view.s + app.view.ty;
  const visible = sx > 30 && sx < w - 30 && sy > 30 && sy < h - 30;
  if (isClusterMode()) {
    const s = Math.max(app.view.s, 90 / CARD_W);
    animateTo({ s, tx: w / 2 - p.x * s, ty: h / 2 - p.y * s });
  } else if (!visible) {
    animateTo({ s: app.view.s, tx: w / 2 - p.x * app.view.s, ty: h / 2 - p.y * app.view.s });
  }
}

function viewCenterWorld() {
  const { w, h } = stageSize();
  return { x: (w / 2 - app.view.tx) / app.view.s, y: (h / 2 - app.view.ty) / app.view.s };
}

// ============================================================================
// 枚数バブル（縮小表示時）
// ============================================================================
function renderClusters() {
  const layer = app.els.clusterLayer;
  if (!layer) return;
  if (!isClusterMode()) {
    if (layer.childElementCount) layer.innerHTML = "";
    return;
  }
  const { s, tx, ty } = app.view;
  const { w, h } = stageSize();
  const cellPx = 64;
  const cells = new Map();
  for (const [key, p] of Object.entries(app.session.placed)) {
    const sx = p.x * s + tx;
    const sy = p.y * s + ty;
    if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 40) continue;
    const k = `${Math.floor(sx / cellPx)},${Math.floor(sy / cellPx)}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { idxs: [], sx: 0, sy: 0 }));
    c.idxs.push(Number(key));
    c.sx += sx;
    c.sy += sy;
  }
  let clusters = [...cells.values()].map((c) => ({ idxs: c.idxs, x: c.sx / c.idxs.length, y: c.sy / c.idxs.length }));
  // 近接バブルの統合
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 48) {
          const n = a.idxs.length + b.idxs.length;
          clusters[i] = {
            idxs: a.idxs.concat(b.idxs),
            x: (a.x * a.idxs.length + b.x * b.idxs.length) / n,
            y: (a.y * a.idxs.length + b.y * b.idxs.length) / n,
          };
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const pool = [...layer.children];
  clusters.forEach((c, i) => {
    let btn = pool[i];
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bd-cluster";
      btn.setAttribute("data-testid", "bd-cluster");
      btn.addEventListener("click", onClusterClick);
      layer.appendChild(btn);
    }
    const n = c.idxs.length;
    const size = Math.round(34 + Math.min(20, Math.log2(n) * 6));
    btn.style.width = btn.style.height = `${size}px`;
    btn.style.transform = `translate(${c.x - size / 2}px, ${c.y - size / 2}px)`;
    btn.textContent = String(n);
    btn.dataset.idxs = c.idxs.join(",");
    btn.title = `${n}枚のカード（タップで拡大）`;
    btn.setAttribute("aria-label", `${n}枚のカードを拡大表示`);
  });
  for (let i = clusters.length; i < pool.length; i++) pool[i].remove();
}

function onClusterClick(e) {
  const idxs = String(e.currentTarget.dataset.idxs || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  if (idxs.length === 0) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of idxs) {
    const p = app.session.placed[i];
    if (!p) continue;
    x0 = Math.min(x0, p.x - CARD_W / 2);
    y0 = Math.min(y0, p.y - CARD_H / 2);
    x1 = Math.max(x1, p.x + CARD_W / 2);
    y1 = Math.max(y1, p.y + CARD_H / 2);
  }
  if (!Number.isFinite(x0)) return;
  const padX = CARD_W * 0.9;
  const padY = CARD_H * 0.7;
  animateTo(fitBounds(x0 - padX, y0 - padY, x1 + padX, y1 + padY), 380);
}

// ============================================================================
// セッション操作（引く・置く・戻す・元に戻す）
// ============================================================================
function snapshot() {
  const s = app.session;
  return { next: s.next, hand: [...s.hand], placed: structuredClone(s.placed), z: s.z };
}

function pushUndo(snap = snapshot()) {
  app.undo.push(snap);
  if (app.undo.length > 150) app.undo.shift();
  updateToolbar();
}

function undoLast() {
  const snap = app.undo.pop();
  if (!snap) {
    toast("これ以上戻せません");
    return;
  }
  Object.assign(app.session, snap);
  selectCard(null);
  syncCards();
  renderHand();
  updateToolbar();
  requestView();
  saveSession();
  toast("1つ前の状態に戻しました");
}

function clampCardPos(x, y) {
  const { W, H } = app.geo;
  return {
    x: clamp(x, -DESK_MARGIN + CARD_W / 2, W + DESK_MARGIN - CARD_W / 2),
    y: clamp(y, -DESK_MARGIN + CARD_H / 2, H + DESK_MARGIN - CARD_H / 2),
  };
}

function cardHouseholdKey(idx) {
  const c = app.session?.cards?.[idx];
  if (!c || c.kind === "event" || c.type === "イベント") return "";
  return resolveCardGroupId(c, c.group);
}

function collectNextDrawIndices() {
  const s = app.session;
  if (!s || s.next >= s.cards.length) return [];
  const first = s.next;
  if (!app.settings.drawByHousehold) return [first];
  const gid = cardHouseholdKey(first);
  if (!gid) return [first];
  const batch = [first];
  let cursor = first + 1;
  while (cursor < s.cards.length && cardHouseholdKey(cursor) === gid) {
    batch.push(cursor);
    cursor++;
  }
  return batch;
}

function drawCard() {
  const s = app.session;
  const batch = collectNextDrawIndices();
  if (batch.length === 0) {
    toast("山札のカードはすべて引きました", "info");
    return;
  }
  pushUndo();
  s.next += batch.length;
  // renderHand() は [...s.hand].reverse() で先頭ほど左に並べるため、逆順で積んで世帯の先頭を左端へ出す
  for (let i = batch.length - 1; i >= 0; i--) {
    s.hand.push(batch[i]);
  }
  renderHand(batch);
  updateToolbar();
  saveSession();
  schedulePrefetch(15);
  if (app.settings.autoPreview) {
    openPreview(batch[0], "hand");
    if (batch.length > 1) {
      toast(`同じ世帯の${batch.length}枚を手札に引きました（背景をタップして他のカードも見られます）`, "info", 3200);
    }
  } else if (batch.length > 1) {
    toast(`同じ世帯の${batch.length}枚を手札に引きました`, "info", 2600);
  }
}

function placeCard(idx, x, y, { focus = false } = {}) {
  const s = app.session;
  pushUndo();
  s.hand = s.hand.filter((i) => i !== idx);
  const p = clampCardPos(x, y);
  s.placed[idx] = { x: p.x, y: p.y, z: ++s.z };
  syncCards();
  renderHand();
  updateToolbar();
  requestView();
  saveSession();
  const el = app.cardEls.get(idx);
  if (el) {
    el.classList.remove("is-new");
    void el.offsetWidth;
    el.classList.add("is-new");
    setTimeout(() => el.classList.remove("is-new"), 1600);
  }
  selectCard(idx);
  if (focus) focusCard(idx);
  schedulePrefetch(20);
  if (s.next >= s.cards.length && s.hand.length === 0) {
    toast("🎉 すべてのカードを配置しました。右上の「PDF」で保存できます", "success", 4200);
  }
}

function returnToHand(idx) {
  const s = app.session;
  if (!s.placed[idx]) return;
  pushUndo();
  delete s.placed[idx];
  s.hand.push(idx);
  selectCard(null);
  syncCards();
  renderHand(idx);
  updateToolbar();
  requestView();
  saveSession();
}

function resetAll() {
  pushUndo();
  const s = app.session;
  s.next = 0;
  s.hand = [];
  s.placed = {};
  s.z = 0;
  selectCard(null);
  syncCards();
  renderHand();
  updateToolbar();
  requestView();
  saveSession();
  schedulePrefetch(20);
  toast("すべてのカードを山札に戻しました（↩で取り消せます）");
}

// ============================================================================
// カード要素の描画
// ============================================================================
function ensureCardEl(idx) {
  let el = app.cardEls.get(idx);
  if (el) return el;
  const info = cardInfo(idx);
  el = document.createElement("div");
  el.className = `bd-card${info.isEvent ? " is-event" : ""}`;
  el.dataset.idx = String(idx);
  el.setAttribute("data-testid", `bd-card-${info.no}`);
  el.title = `No.${info.no} ${info.name}`;
  const img = document.createElement("img");
  img.alt = `No.${info.no} ${info.name}`;
  img.draggable = false;
  el.appendChild(img);
  bindCardImg(img, idx);
  app.cardEls.set(idx, el);
  return el;
}

function positionCardEl(el, p) {
  el.style.left = `${p.x - CARD_W / 2}px`;
  el.style.top = `${p.y - CARD_H / 2}px`;
  el.style.zIndex = String(p.z || 1);
}

function syncCards() {
  const world = app.els.cardWorld;
  if (!world) return;
  const placed = app.session.placed;
  for (const [idx, el] of app.cardEls) {
    if (!placed[idx] && el.parentNode) el.remove();
  }
  for (const [key, p] of Object.entries(placed)) {
    const idx = Number(key);
    const el = ensureCardEl(idx);
    positionCardEl(el, p);
    if (!el.parentNode) world.appendChild(el);
  }
}

function bringToFront(idx) {
  const s = app.session;
  const p = s.placed[idx];
  if (!p) return;
  if (p.z === s.z) return;
  p.z = ++s.z;
  const el = app.cardEls.get(idx);
  if (el) el.style.zIndex = String(p.z);
}

function selectCard(idx) {
  if (app.selected != null) app.cardEls.get(app.selected)?.classList.remove("is-selected");
  app.selected = idx;
  const bar = app.els.selbar;
  if (idx == null || !app.session?.placed[idx]) {
    app.selected = null;
    if (bar) bar.hidden = true;
    return;
  }
  const el = app.cardEls.get(idx);
  if (el) {
    el.classList.add("is-selected");
    el.style.setProperty("--ui-px", `${1 / app.view.s}px`);
  }
  if (bar) {
    const info = cardInfo(idx);
    bar.querySelector(".bd-selbar-label").innerHTML = `<b>No.${escapeHtml(String(info.no))}</b> ${escapeHtml(info.name)}`;
    bar.hidden = false;
  }
}

// ============================================================================
// 手札
// ============================================================================
function renderHand(highlightIdx = null) {
  const hand = app.els.hand;
  if (!hand) return;
  const s = app.session;
  const hiSet = new Set(
    Array.isArray(highlightIdx) ? highlightIdx : highlightIdx != null ? [highlightIdx] : []
  );
  hand.innerHTML = "";
  if (s.hand.length === 0) {
    const remaining = s.cards.length - s.next;
    hand.innerHTML = `<div class="bd-hand-empty">${
      remaining > 0
        ? app.settings.drawByHousehold
          ? "「カードを引く」で山札から世帯ごとに引きます。<br />引いたカードはここに並び、<b>ドラッグで台紙へ</b>置けます。"
          : "「カードを引く」で山札から1枚引きます。<br />引いたカードはここに並び、<b>ドラッグで台紙へ</b>置けます。"
        : "山札も手札も空です。配置が終わったら <b>PDF</b> で保存できます。"
    }</div>`;
    return;
  }
  const order = [...s.hand].reverse(); // 新しいカードを左に
  for (const idx of order) {
    const info = cardInfo(idx);
    const item = document.createElement("div");
    item.className = `bd-hand-card${hiSet.has(idx) ? " is-new" : ""}`;
    item.dataset.idx = String(idx);
    item.setAttribute("data-testid", `bd-hand-card-${info.no}`);
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.title = `No.${info.no} ${info.name}（タップで拡大／ドラッグで台紙へ）`;
    const img = document.createElement("img");
    img.alt = `No.${info.no} ${info.name}`;
    img.draggable = false;
    item.appendChild(img);
    hand.appendChild(item);
    bindCardImg(img, idx);
  }
  hand.scrollLeft = 0;
}

// ============================================================================
// ツールバー表示
// ============================================================================
function updateToolbar() {
  const s = app.session;
  const { els } = app;
  if (!s || !els.drawBtn) return;
  const remaining = s.cards.length - s.next;
  const placedCount = Object.keys(s.placed).length;
  els.deckCount.textContent = String(remaining);
  els.drawBtn.disabled = remaining <= 0;
  els.drawBtn.querySelector(".bd-draw-label").textContent = remaining > 0 ? "カードを引く" : "山札なし";
  els.progress.innerHTML = `配置 <b>${placedCount}</b><span>/${s.cards.length}</span>`;
  els.undoBtn.disabled = app.undo.length === 0;
}

// ============================================================================
// ポインタ操作（パン・ピンチ・カード移動）
// ============================================================================
const ptr = {
  map: new Map(),
  mode: null, // 'pan' | 'card' | 'pinch'
  rect: null,
  start: null,
  last: null,
  view0: null,
  moved: false,
  idx: null,
  grab: null,
  snap: null,
  pinch: null,
  lastTap: null,
  edgeRaf: 0,
};

function localPoint(e) {
  const r = ptr.rect || app.els.stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function beginPinch() {
  const pts = [...ptr.map.values()];
  const a = pts[0];
  const b = pts[1];
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
  const v = app.view;
  ptr.pinch = { d0: d, s0: v.s, wx: (m.x - v.tx) / v.s, wy: (m.y - v.ty) / v.s };
  ptr.mode = "pinch";
}

function cancelCardDrag() {
  if (ptr.mode !== "card") return;
  const el = app.cardEls.get(ptr.idx);
  el?.classList.remove("is-dragging");
  if (ptr.moved && ptr.snap) {
    const orig = ptr.snap.placed[ptr.idx];
    if (orig) {
      app.session.placed[ptr.idx] = { ...orig };
      if (el) positionCardEl(el, orig);
    }
  }
}

function onStageDown(e) {
  if (e.target.closest(".bd-cluster, .bd-zoom-ctrl, .bd-selbar, button, a")) return;
  if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  cancelAnimation();
  try {
    app.els.stage.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }
  ptr.rect = app.els.stage.getBoundingClientRect();
  const p = localPoint(e);
  ptr.map.set(e.pointerId, p);
  app.els.stage.classList.add("is-gesturing");

  if (ptr.map.size === 1) {
    ptr.start = p;
    ptr.last = p;
    ptr.view0 = { ...app.view };
    ptr.moved = false;
    const cardEl = e.button === 0 && !isClusterMode() ? e.target.closest(".bd-card") : null;
    if (cardEl) {
      ptr.mode = "card";
      ptr.idx = Number(cardEl.dataset.idx);
      const pl = app.session.placed[ptr.idx];
      const wx = (p.x - app.view.tx) / app.view.s;
      const wy = (p.y - app.view.ty) / app.view.s;
      ptr.grab = { dx: wx - pl.x, dy: wy - pl.y };
      ptr.snap = null;
    } else {
      ptr.mode = "pan";
    }
  } else if (ptr.map.size === 2) {
    cancelCardDrag();
    beginPinch();
  }
}

function onStageMove(e) {
  if (!ptr.map.has(e.pointerId)) return;
  const p = localPoint(e);
  ptr.map.set(e.pointerId, p);

  if (ptr.mode === "pinch" && ptr.map.size >= 2) {
    const pts = [...ptr.map.values()];
    const a = pts[0];
    const b = pts[1];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const s = clamp(ptr.pinch.s0 * (d / ptr.pinch.d0), app.minScale, MAX_SCALE);
    setView({ s, tx: m.x - ptr.pinch.wx * s, ty: m.y - ptr.pinch.wy * s });
    return;
  }

  ptr.last = p;
  const dist = Math.hypot(p.x - ptr.start.x, p.y - ptr.start.y);
  if (ptr.mode === "pan") {
    if (!ptr.moved && dist > 4) ptr.moved = true;
    if (ptr.moved) {
      setView({ s: ptr.view0.s, tx: ptr.view0.tx + (p.x - ptr.start.x), ty: ptr.view0.ty + (p.y - ptr.start.y) });
    }
  } else if (ptr.mode === "card") {
    if (!ptr.moved && dist > 5) {
      ptr.moved = true;
      ptr.snap = snapshot();
      bringToFront(ptr.idx);
      selectCard(ptr.idx);
      app.cardEls.get(ptr.idx)?.classList.add("is-dragging");
      if (!ptr.edgeRaf) ptr.edgeRaf = requestAnimationFrame(edgeLoop);
    }
    if (ptr.moved) moveDraggedCard();
  }
}

function moveDraggedCard() {
  const p = ptr.last;
  const wx = (p.x - app.view.tx) / app.view.s - ptr.grab.dx;
  const wy = (p.y - app.view.ty) / app.view.s - ptr.grab.dy;
  const pos = clampCardPos(wx, wy);
  const pl = app.session.placed[ptr.idx];
  pl.x = pos.x;
  pl.y = pos.y;
  const el = app.cardEls.get(ptr.idx);
  if (el) positionCardEl(el, pl);
}

/** カードをドラッグしたまま画面端に近づけると自動スクロール. */
function edgeLoop() {
  ptr.edgeRaf = 0;
  if (ptr.mode !== "card" || !ptr.moved) return;
  const { w, h } = stageSize();
  const m = 40;
  const p = ptr.last;
  let vx = 0;
  let vy = 0;
  if (p.x < m) vx = ((m - p.x) / m) * 12;
  else if (p.x > w - m) vx = -((p.x - (w - m)) / m) * 12;
  if (p.y < m) vy = ((m - p.y) / m) * 12;
  else if (p.y > h - m) vy = -((p.y - (h - m)) / m) * 12;
  if (vx || vy) {
    setView({ s: app.view.s, tx: app.view.tx + vx, ty: app.view.ty + vy });
    moveDraggedCard();
  }
  ptr.edgeRaf = requestAnimationFrame(edgeLoop);
}

function onStageUp(e) {
  if (!ptr.map.has(e.pointerId)) return;
  const wasCancel = e.type === "pointercancel";
  ptr.map.delete(e.pointerId);

  if (ptr.mode === "pinch") {
    if (ptr.map.size === 1) {
      const [rest] = ptr.map.values();
      ptr.mode = "pan";
      ptr.start = rest;
      ptr.last = rest;
      ptr.view0 = { ...app.view };
      ptr.moved = true;
      return;
    }
    if (ptr.map.size === 0) endGesture();
    return;
  }
  if (ptr.map.size > 0) return;

  if (ptr.mode === "card") {
    const idx = ptr.idx;
    app.cardEls.get(idx)?.classList.remove("is-dragging");
    if (ptr.moved && !wasCancel) {
      pushUndo(ptr.snap);
      saveSession();
    } else if (ptr.moved && wasCancel) {
      cancelCardDrag();
    } else {
      // タップ
      bringToFront(idx);
      selectCard(idx);
      const now = performance.now();
      const lt = ptr.lastTap;
      if (lt && lt.type === "card" && lt.idx === idx && now - lt.t < 350) {
        ptr.lastTap = null;
        openPreview(idx, "placed");
      } else {
        ptr.lastTap = { type: "card", idx, t: now, x: ptr.start.x, y: ptr.start.y };
      }
      saveSession();
    }
  } else if (ptr.mode === "pan" && !ptr.moved && !wasCancel) {
    selectCard(null);
    const now = performance.now();
    const lt = ptr.lastTap;
    if (lt && lt.type === "empty" && now - lt.t < 350 && Math.hypot(lt.x - ptr.start.x, lt.y - ptr.start.y) < 30) {
      ptr.lastTap = null;
      const v = app.view;
      const s = clamp(v.s * 2, app.minScale, MAX_SCALE);
      const wx = (ptr.start.x - v.tx) / v.s;
      const wy = (ptr.start.y - v.ty) / v.s;
      animateTo({ s, tx: ptr.start.x - wx * s, ty: ptr.start.y - wy * s }, 260);
    } else {
      ptr.lastTap = { type: "empty", t: now, x: ptr.start.x, y: ptr.start.y };
    }
  }
  endGesture();
}

function endGesture() {
  ptr.mode = null;
  ptr.snap = null;
  if (ptr.edgeRaf) cancelAnimationFrame(ptr.edgeRaf);
  ptr.edgeRaf = 0;
  app.els.stage?.classList.remove("is-gesturing");
  saveSession();
}

function onWheel(e) {
  e.preventDefault();
  cancelAnimation();
  const p = localPoint({ clientX: e.clientX, clientY: e.clientY });
  ptr.rect = null;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const k = e.ctrlKey ? 0.01 : 0.0018;
  const factor = Math.exp(-e.deltaY * unit * k);
  zoomAt(p.x, p.y, factor);
  app.els.stage.classList.add("is-gesturing");
  clearTimeout(onWheel._t);
  onWheel._t = setTimeout(() => {
    app.els.stage?.classList.remove("is-gesturing");
    saveSession();
  }, 220);
}

// ---------------------------------------------------------------------------
// 手札から台紙へのドラッグ
// ---------------------------------------------------------------------------
const handDrag = { id: null, idx: null, x0: 0, y0: 0, started: false, ghost: null, item: null, touch: false, suppressClick: false };

function onHandDown(e) {
  const item = e.target.closest(".bd-hand-card");
  if (!item || (e.pointerType === "mouse" && e.button !== 0)) return;
  handDrag.id = e.pointerId;
  handDrag.idx = Number(item.dataset.idx);
  handDrag.x0 = e.clientX;
  handDrag.y0 = e.clientY;
  handDrag.started = false;
  handDrag.item = item;
  handDrag.touch = e.pointerType !== "mouse";
  if (e.pointerType === "mouse") e.preventDefault();
}

function ghostSize() {
  const w = clamp(CARD_W * app.view.s, 46, 240);
  return { w, h: (w * CARD_H) / CARD_W };
}

function onHandMove(e) {
  if (handDrag.id !== e.pointerId) return;
  const dx = e.clientX - handDrag.x0;
  const dy = e.clientY - handDrag.y0;
  if (!handDrag.started) {
    const ok = handDrag.touch ? dy < -10 && Math.abs(dy) > Math.abs(dx) * 0.8 : Math.hypot(dx, dy) > 6;
    if (!ok) return;
    handDrag.started = true;
    try {
      handDrag.item.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    handDrag.item.classList.add("is-lifted");
    const g = document.createElement("div");
    g.className = "bd-drag-ghost";
    g.setAttribute("data-testid", "bd-drag-ghost");
    const img = document.createElement("img");
    img.src = handDrag.item.querySelector("img")?.src || "";
    img.draggable = false;
    g.appendChild(img);
    document.body.appendChild(g);
    handDrag.ghost = g;
    document.body.classList.add("is-hand-dragging");
  }
  e.preventDefault();
  const { w, h } = ghostSize();
  const lift = handDrag.touch ? h * 0.5 + 24 : 0;
  const gx = e.clientX - w / 2;
  const gy = e.clientY - h / 2 - lift;
  const g = handDrag.ghost;
  g.style.width = `${w}px`;
  g.style.height = `${h}px`;
  g.style.transform = `translate(${gx}px, ${gy}px)`;
  const r = app.els.stage.getBoundingClientRect();
  const cx = e.clientX;
  const cy = e.clientY - lift;
  g.classList.toggle("is-over", cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
}

function onHandUp(e) {
  if (handDrag.id !== e.pointerId) return;
  const started = handDrag.started;
  const idx = handDrag.idx;
  handDrag.id = null;
  if (!started) return;
  handDrag.suppressClick = true;
  setTimeout(() => (handDrag.suppressClick = false), 50);
  handDrag.item?.classList.remove("is-lifted");
  handDrag.ghost?.remove();
  handDrag.ghost = null;
  document.body.classList.remove("is-hand-dragging");
  if (e.type === "pointercancel") return;
  const { h } = ghostSize();
  const lift = handDrag.touch ? h * 0.5 + 24 : 0;
  const r = app.els.stage.getBoundingClientRect();
  const cx = e.clientX;
  const cy = e.clientY - lift;
  if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
  const wx = (cx - r.left - app.view.tx) / app.view.s;
  const wy = (cy - r.top - app.view.ty) / app.view.s;
  placeCard(idx, wx, wy);
  if (isClusterMode()) toast("縮小表示中のため、カードは枚数の丸ボタンで表示されます");
}

function onHandClick(e) {
  if (handDrag.suppressClick) return;
  const item = e.target.closest(".bd-hand-card");
  if (!item) return;
  openPreview(Number(item.dataset.idx), "hand");
}

// ============================================================================
// モーダル（カード拡大・メニュー）
// ============================================================================
function closeModal() {
  document.querySelectorAll(".bd-modal-overlay").forEach((el) => el.remove());
}

function openModal(html, testId) {
  closeModal();
  const ov = document.createElement("div");
  ov.className = "bd-modal-overlay";
  ov.setAttribute("data-testid", testId);
  ov.innerHTML = html;
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeModal();
  });
  document.body.appendChild(ov);
  return ov;
}

function openPreview(idx, context) {
  const info = cardInfo(idx);
  const inHand = context === "hand";
  const emptyBtn = `<button type="button" class="bd-btn ${info.isEvent ? "bd-btn-primary" : ""}" data-act="empty" data-testid="bd-place-empty-btn">🧭 空いている場所に置く</button>`;
  const centerBtn = `<button type="button" class="bd-btn ${info.isEvent ? "" : "bd-btn-primary"}" data-act="center" data-testid="bd-place-center-btn">📍 画面の中央に置く</button>`;
  const actions = inHand
    ? `${info.isEvent ? emptyBtn + centerBtn : centerBtn + emptyBtn}
       <button type="button" class="bd-btn bd-btn-ghost" data-act="close" data-testid="bd-preview-close-btn">✋ 手札に置いておく</button>`
    : `<button type="button" class="bd-btn" data-act="return" data-testid="bd-preview-return-btn">↩ 手札に戻す</button>
       <button type="button" class="bd-btn bd-btn-primary" data-act="close" data-testid="bd-preview-close-btn">閉じる</button>`;
  const ov = openModal(
    `<div class="bd-preview-dialog" role="dialog" aria-modal="true" aria-label="カード No.${escapeHtml(String(info.no))}">
       <div class="bd-preview-head">
         <span class="bd-kind-badge ${info.isEvent ? "is-event" : ""}">${escapeHtml(info.kindLabel)}</span>
         <span class="bd-preview-title">No.${escapeHtml(String(info.no))} ${escapeHtml(info.name)}</span>
         <button type="button" class="bd-icon-btn" data-act="close" aria-label="閉じる">✕</button>
       </div>
       <div class="bd-preview-img-wrap"><img class="bd-preview-img" alt="No.${escapeHtml(String(info.no))}" /></div>
       ${inHand ? `<p class="bd-preview-hint">${info.isEvent ? "イベントカードは空いている場所に置くのがおすすめです。" : ""}手札からドラッグして好きな場所に置くこともできます。</p>` : ""}
       <div class="bd-preview-actions">${actions}</div>
     </div>`,
    "bd-preview"
  );
  bindCardImg(ov.querySelector(".bd-preview-img"), idx);
  ov.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      closeModal();
      if (act === "center") {
        const c = viewCenterWorld();
        placeCard(idx, c.x, c.y, { focus: true });
      } else if (act === "empty") {
        const spot = findEmptySpot(viewCenterWorld());
        placeCard(idx, spot.x, spot.y, { focus: true });
      } else if (act === "return") {
        returnToHand(idx);
      }
    })
  );
  ov.querySelector(`[data-act="${inHand ? (info.isEvent ? "empty" : "center") : "close"}"]`)?.focus();
}

function openMenu() {
  const s = app.session;
  const size = resolveSheetSize(s.sizeId);
  const ov = openModal(
    `<div class="bd-menu-dialog" role="dialog" aria-modal="true" aria-label="メニュー">
       <div class="bd-preview-head">
         <span class="bd-preview-title">☰ メニュー</span>
         <button type="button" class="bd-icon-btn" data-act="close" aria-label="閉じる">✕</button>
       </div>
       <div class="bd-menu-info">
         <div>🃏 <b>${escapeHtml(s.deckTitle)}</b>（${s.cards.length}枚）</div>
         <div>🗺️ ${escapeHtml(app.board?.name || "")}／${escapeHtml(size.label)} ${app.geo.W}×${app.geo.H}mm</div>
       </div>
       <div class="bd-menu-list">
         <button type="button" class="bd-btn" data-act="pdf">⬇ 配置をPDFでダウンロード</button>
         <button type="button" class="bd-btn" data-act="fit">⤢ 台紙全体を表示</button>
         <label class="bd-toggle-row">
           <input type="checkbox" id="bd-menu-drawhousehold" data-testid="bd-menu-drawhousehold" ${app.settings.drawByHousehold ? "checked" : ""} />
           <span>世帯ごとにまとめてカードを引く</span>
         </label>
         <label class="bd-toggle-row">
           <input type="checkbox" id="bd-menu-autopreview" data-testid="bd-menu-autopreview" ${app.settings.autoPreview ? "checked" : ""} />
           <span>引いたカードを大きく表示する</span>
         </label>
         <button type="button" class="bd-btn" data-act="reset" data-testid="bd-menu-reset">🔁 最初からやり直す（全カードを山札へ）</button>
         <button type="button" class="bd-btn" data-act="setup" data-testid="bd-menu-setup">🗂️ デッキ・台紙を選び直す</button>
         <a class="bd-btn bd-btn-ghost" href="./index.html">← デッキツールへ戻る</a>
       </div>
       <details class="bd-howto">
         <summary>操作方法</summary>
         ${HOWTO_HTML}
       </details>
     </div>`,
    "bd-menu"
  );
  ov.querySelector("#bd-menu-drawhousehold").addEventListener("change", (e) => {
    app.settings.drawByHousehold = e.target.checked;
    saveSettings();
    renderHand();
  });
  ov.querySelector("#bd-menu-autopreview").addEventListener("change", (e) => {
    app.settings.autoPreview = e.target.checked;
    saveSettings();
  });
  ov.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      closeModal();
      if (act === "pdf") exportPdf();
      else if (act === "fit") animateTo(fitView());
      else if (act === "reset") {
        if (confirm("配置したカードと手札をすべて山札に戻して、最初からやり直しますか？")) resetAll();
      } else if (act === "setup") {
        saveSession();
        leavePlay();
        renderSetup();
      }
    })
  );
}

const HOWTO_HTML = `
  <ul class="bd-howto-list">
    <li><b>カードを引く</b>：左下の山札をタップ。既定では世帯単位でまとめて手札に入り、先頭のカードが大きく表示されます（背景をタップすると手札の他のカードも確認できます）。</li>
    <li><b>台紙に置く</b>：手札のカードを台紙へドラッグ（スマホは上方向へ引き出す）。手札をタップして「中央に置く／空いている場所に置く」も可能です。</li>
    <li><b>動かす</b>：置いたカードをドラッグ。重ねて置いてもOK。タップで最前面へ、ダブルタップで拡大表示。</li>
    <li><b>拡大・縮小</b>：PCはマウスホイール、スマホは2本指ピンチ。空いた所をダブルタップでも拡大。</li>
    <li><b>移動</b>：何もない所をドラッグ（スマホは2本指でも可）。</li>
    <li><b>丸い数字ボタン</b>：縮小してカードが見えなくなると、周辺のカード枚数が表示されます。タップでその周辺へ拡大します。</li>
    <li><b>保存</b>：配置は自動でブラウザに保存されます。「PDF」で途中・最終の配置をダウンロードできます。</li>
  </ul>`;

// ============================================================================
// PDF出力
// ============================================================================
function loadScriptOnce(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = src;
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(sc);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    img.src = url;
  });
}

function captionPng(text) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const fontPx = 44;
  const font = `600 ${fontPx}px "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  c.width = Math.min(w, 8000);
  c.height = Math.round(fontPx * 1.4);
  ctx.font = font;
  ctx.fillStyle = "#1e293b";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, c.height / 2);
  return c;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function exportPdf() {
  if (app.exporting) return;
  const s = app.session;
  const placedEntries = Object.entries(s.placed)
    .map(([k, p]) => ({ idx: Number(k), ...p }))
    .sort((a, b) => a.z - b.z);
  app.exporting = true;
  const prog = openModal(
    `<div class="bd-progress-dialog" data-testid="bd-pdf-progress">
       <div class="bd-spinner"></div>
       <div class="bd-progress-text">PDFを作成しています…</div>
     </div>`,
    "bd-pdf-progress-overlay"
  );
  const progText = prog.querySelector(".bd-progress-text");
  try {
    await loadScriptOnce("./static/vendor/pdf-lib.min.js", "PDFLib");
    const { PDFDocument, rgb } = window.PDFLib;
    const { geo } = app;
    const doc = await PDFDocument.create();
    const now = new Date();
    doc.setTitle(`HUG台紙配置 ${s.deckTitle}`);
    doc.setCreator("HUGカード 台紙配置シミュレーション");

    // 出力範囲（台紙＋はみ出したカード）
    let minX = 0;
    let minY = 0;
    let maxX = geo.W;
    let maxY = geo.H;
    for (const p of placedEntries) {
      minX = Math.min(minX, p.x - CARD_W / 2 - 10);
      minY = Math.min(minY, p.y - CARD_H / 2 - 10);
      maxX = Math.max(maxX, p.x + CARD_W / 2 + 10);
      maxY = Math.max(maxY, p.y + CARD_H / 2 + 10);
    }
    const capH = Math.max(14, geo.W * 0.012); // 下部の説明帯 (mm)
    const rawW = (maxX - minX) * PT_PER_MM;
    const rawH = (maxY - minY + capH) * PT_PER_MM;
    const userUnit = calcPdfUserUnit(rawW, rawH);
    const K = PT_PER_MM / userUnit;
    const pageW = (maxX - minX) * K;
    const pageH = (maxY - minY + capH) * K;
    const page = doc.addPage([pageW, pageH]);
    if (userUnit > 1 && window.PDFLib?.PDFName && window.PDFLib?.PDFNumber) {
      page.node.set(window.PDFLib.PDFName.of("UserUnit"), window.PDFLib.PDFNumber.of(userUnit));
    }
    const box = (x, y, w, h) => ({ x: (x - minX) * K, y: (maxY - (y + h) + capH) * K, width: w * K, height: h * K });

    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });
    if (minX < 0 || minY < 0 || maxX > geo.W || maxY > geo.H) {
      page.drawRectangle({ ...box(minX, minY, maxX - minX, maxY - minY), color: rgb(0.93, 0.91, 0.87) });
      page.drawRectangle({ ...box(0, 0, geo.W, geo.H), color: rgb(1, 1, 1) });
    }

    progText.textContent = "台紙を埋め込んでいます…";
    try {
      if (!app.boardInfo?.bytes?.byteLength) throw new Error("PDFバイトが空です");
      const pageIndex = clamp((app.board.page || 1) - 1, 0, app.boardInfo.doc.numPages - 1);
      const [embedded] = await doc.embedPdf(app.boardInfo.bytes, [pageIndex]);
      page.drawPage(embedded, box(geo.pdf.x, geo.pdf.y, geo.pdf.w, geo.pdf.h));
    } catch {
      // 埋め込めないPDFは画像で代替
      const imgSource = app.baseOffscreen || app.els.baseCanvas;
      const jpg = await doc.embedJpg(await canvasToJpegBytes(imgSource, 0.88));
      page.drawImage(jpg, box(0, 0, geo.W, geo.H));
    }
    page.drawRectangle({ ...box(0, 0, geo.W, geo.H), borderColor: rgb(0.6, 0.6, 0.6), borderWidth: Math.max(0.2, 0.8 / userUnit) });

    const scratchCanvas = document.createElement("canvas");
    const cardMaxWidth = placedEntries.length > 25 ? 420 : 540;
    let i = 0;
    try {
      for (const p of placedEntries) {
        i++;
        progText.textContent = `カードを配置しています… ${i} / ${placedEntries.length}`;
        const url = await ensureCardUrl(p.idx);
        const bytes = await imageUrlToJpegBytes(url, scratchCanvas, {
          maxWidth: cardMaxWidth,
          quality: 0.86,
        });
        const img = await doc.embedJpg(bytes);
        const b = box(p.x - CARD_W / 2, p.y - CARD_H / 2, CARD_W, CARD_H);
        page.drawImage(img, b);
        page.drawRectangle({ ...b, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: Math.max(0.15, 0.6 / userUnit) });
      }
    } finally {
      scratchCanvas.width = 0;
      scratchCanvas.height = 0;
    }

    const size = resolveSheetSize(s.sizeId);
    const stamp = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const caption = `HUG 台紙配置シミュレーション　デッキ：${s.deckTitle}　台紙：${app.board?.name || ""}（${size.label} ${geo.W}×${geo.H}mm・カード55×91mm）　配置 ${placedEntries.length}/${s.cards.length}枚　出力 ${stamp}`;
    const cap = captionPng(caption);
    const capW = cap.width || 2400;
    const capHpx = cap.height || 68;
    const capBlob = await new Promise((r) => cap.toBlob(r, "image/png"));
    const capImg = await doc.embedPng(new Uint8Array(await capBlob.arrayBuffer()));
    cap.width = 0;
    cap.height = 0;
    const capDrawH = capH * 0.5 * K;
    const capDrawW = Math.min((capW / capHpx) * capDrawH, pageW - 16 * K);
    page.drawImage(capImg, { x: 8 * K, y: capH * 0.25 * K, width: capDrawW, height: (capDrawW / capW) * capHpx });

    progText.textContent = "ファイルを保存しています…";
    const out = await doc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const safeTitle = String(s.deckTitle).replace(/[\\/:*?"<>|\s]+/g, "_");
    const fname = `HUG台紙配置_${safeTitle}_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}.pdf`;
    closeModal();
    const delivery = await deliverPdfBlob(blob, fname, {
      subtitle: `${placedEntries.length}/${s.cards.length}枚配置`,
    });
    if (delivery.mode === "download") {
      toast(`PDFを保存しました（${placedEntries.length}枚配置）`, "success");
    } else {
      toast(`PDFの準備ができました（保存ボタンをタップしてください）`, "success", 3200);
    }
  } catch (err) {
    closeModal();
    toast(`PDFの作成に失敗しました: ${err?.message || err}`, "error", 5000);
  } finally {
    app.exporting = false;
  }
}

// ============================================================================
// プレイ画面
// ============================================================================
function onResizeCaptureCenter() {
  if (!app._lastCenter && app.els.stage) app._lastCenter = viewCenterWorld();
}

function leavePlay() {
  stopPrefetch();
  closeModal();
  clearTimeout(detail.timer);
  detail.token++;
  detail.rendered = null;
  window.removeEventListener("pointermove", onStageMove);
  window.removeEventListener("pointerup", onStageUp);
  window.removeEventListener("pointercancel", onStageUp);
  window.removeEventListener("pointermove", onHandMove);
  window.removeEventListener("pointerup", onHandUp);
  window.removeEventListener("pointercancel", onHandUp);
  window.removeEventListener("resize", onResizeCaptureCenter);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("keydown", onKeyDown);
  if (app.baseOffscreen) {
    app.baseOffscreen.width = 0;
    app.baseOffscreen.height = 0;
    app.baseOffscreen = null;
  }
  if (app.detailOffscreen) {
    app.detailOffscreen.width = 0;
    app.detailOffscreen.height = 0;
    app.detailOffscreen = null;
  }
  app.els = {};
  app.cardEls.clear();
  app.models.clear();
  app.renderedUrls.clear();
  app.renderPromises.clear();
  app.selected = null;
  document.body.classList.remove("is-playing");
  document.body.classList.add("is-setup");
}

let resizeTimer = 0;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!app.els.stage) return;
    const c = app._lastCenter || viewCenterWorld();
    updateScaleLimits();
    const { w, h } = stageSize();
    const s = app.view.s;
    setView({ s, tx: w / 2 - c.x * s, ty: h / 2 - c.y * s });
    app._lastCenter = null;
  }, 120);
}

function onKeyDown(e) {
  if (e.target.closest?.("input, select, textarea")) return;
  const modalOpen = document.querySelector(".bd-modal-overlay");
  if (e.key === "Escape") {
    if (modalOpen) closeModal();
    else selectCard(null);
    return;
  }
  if (modalOpen) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undoLast();
  } else if (e.key === "n" || e.key === "N") {
    drawCard();
  } else if ((e.key === "Delete" || e.key === "Backspace") && app.selected != null) {
    e.preventDefault();
    returnToHand(app.selected);
  } else if (e.key === "+" || e.key === "=" || e.key === ";") {
    const { w, h } = stageSize();
    zoomAt(w / 2, h / 2, 1.4);
  } else if (e.key === "-") {
    const { w, h } = stageSize();
    zoomAt(w / 2, h / 2, 1 / 1.4);
  } else if (e.key === "0") {
    animateTo(fitView());
  }
}

async function startPlay(session) {
  const board = app.boards.find((b) => b.id === session.boardId);
  if (!board) {
    toast("台紙が見つかりません。選び直してください", "error");
    renderSetup();
    return;
  }
  app.session = session;
  app.board = board;
  app.undo = [];
  app.models.clear();
  app.cardEls.clear();
  app.selected = null;
  app.posMap = computeGroupPositionMap(session.cards);

  const main = document.getElementById("bd-main");
  document.body.classList.remove("is-setup");
  document.body.classList.add("is-playing");
  const size = resolveSheetSize(session.sizeId);
  main.innerHTML = `
    <div class="bd-app" data-testid="bd-play-view">
      <header class="bd-topbar">
        <button type="button" class="bd-icon-btn" id="bd-menu-btn" data-testid="bd-menu-btn" aria-label="メニュー">☰</button>
        <div class="bd-title">
          <div class="bd-title-main">${escapeHtml(session.deckTitle)}</div>
          <div class="bd-title-sub">${escapeHtml(board.name)}・${escapeHtml(size.label)}</div>
        </div>
        <div class="bd-progress" id="bd-progress" data-testid="bd-progress"></div>
        <button type="button" class="bd-tool-btn" id="bd-undo-btn" data-testid="bd-undo-btn" title="元に戻す (Ctrl+Z)">↩<span>戻す</span></button>
        <button type="button" class="bd-tool-btn bd-tool-primary" id="bd-pdf-btn" data-testid="bd-pdf-btn" title="現在の配置をPDFでダウンロード">⬇<span>PDF</span></button>
      </header>
      <div class="bd-stage" id="bd-stage" data-testid="bd-stage">
        <canvas class="bd-viewport-canvas" id="bd-base-canvas"></canvas>
        <div class="bd-world bd-card-world" id="bd-card-world" data-testid="bd-card-world"></div>
        <div class="bd-cluster-layer" id="bd-cluster-layer"></div>
        <div class="bd-zoom-ctrl">
          <button type="button" data-zoom="in" data-testid="bd-zoom-in" aria-label="拡大">＋</button>
          <button type="button" data-zoom="out" data-testid="bd-zoom-out" aria-label="縮小">－</button>
          <button type="button" data-zoom="fit" data-testid="bd-zoom-fit" aria-label="全体表示" title="台紙全体を表示">⤢</button>
        </div>
        <div class="bd-selbar" id="bd-selbar" data-testid="bd-selbar" hidden>
          <span class="bd-selbar-label"></span>
          <button type="button" class="bd-btn bd-btn-sm" data-sel="preview" data-testid="bd-sel-preview">🔍 拡大</button>
          <button type="button" class="bd-btn bd-btn-sm" data-sel="return" data-testid="bd-sel-return">↩ 手札へ</button>
          <button type="button" class="bd-icon-btn bd-icon-btn-sm" data-sel="close" aria-label="選択解除">✕</button>
        </div>
        <div class="bd-board-loading" id="bd-board-loading"><div class="bd-spinner"></div>台紙を描画しています…</div>
      </div>
      <footer class="bd-bottombar">
        <button type="button" class="bd-draw-btn" id="bd-draw-btn" data-testid="bd-draw-btn" title="山札からカードを1枚引く (N)">
          <span class="bd-deck-pile"><span class="bd-deck-count" id="bd-deck-count" data-testid="bd-deck-count">0</span></span>
          <span class="bd-draw-label">カードを引く</span>
        </button>
        <div class="bd-hand" id="bd-hand" data-testid="bd-hand"></div>
      </footer>
    </div>`;

  const $ = (id) => document.getElementById(id);
  app.els = {
    stage: $("bd-stage"),
    cardWorld: $("bd-card-world"),
    baseCanvas: $("bd-base-canvas"),
    clusterLayer: $("bd-cluster-layer"),
    selbar: $("bd-selbar"),
    hand: $("bd-hand"),
    drawBtn: $("bd-draw-btn"),
    deckCount: $("bd-deck-count"),
    progress: $("bd-progress"),
    undoBtn: $("bd-undo-btn"),
  };
  const { els } = app;

  // 台紙ジオメトリ
  try {
    app.boardInfo = await loadBoardInfo(board);
  } catch (err) {
    toast(`台紙PDFの読み込みに失敗しました: ${err.message}`, "error", 6000);
    leavePlay();
    renderSetup();
    return;
  }
  app.geo = computeGeometry(app.boardInfo, session.sizeId);
  els.baseCanvas.dataset.mmWidth = String(app.geo.W);
  els.baseCanvas.dataset.mmHeight = String(app.geo.H);

  updateScaleLimits();
  app.view = session.view && session.view.s ? clampView(session.view) : clampView(fitView());
  applyView();
  syncCards();
  renderHand();
  updateToolbar();

  // イベント（ドラッグ移動・終了は要素外でも追従するよう window に登録）
  els.stage.addEventListener("pointerdown", onStageDown);
  window.addEventListener("pointermove", onStageMove);
  window.addEventListener("pointerup", onStageUp);
  window.addEventListener("pointercancel", onStageUp);
  els.stage.addEventListener("wheel", onWheel, { passive: false });
  els.stage.addEventListener("contextmenu", (e) => e.preventDefault());
  els.stage.addEventListener("dblclick", (e) => e.preventDefault());
  els.hand.addEventListener("pointerdown", onHandDown);
  window.addEventListener("pointermove", onHandMove, { passive: false });
  window.addEventListener("pointerup", onHandUp);
  window.addEventListener("pointercancel", onHandUp);
  els.hand.addEventListener("click", onHandClick);
  els.hand.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest(".bd-hand-card")) {
      e.preventDefault();
      openPreview(Number(e.target.closest(".bd-hand-card").dataset.idx), "hand");
    }
  });
  els.drawBtn.addEventListener("click", drawCard);
  els.undoBtn.addEventListener("click", undoLast);
  $("bd-pdf-btn").addEventListener("click", exportPdf);
  $("bd-menu-btn").addEventListener("click", openMenu);
  els.stage.querySelectorAll("[data-zoom]").forEach((b) =>
    b.addEventListener("click", () => {
      const { w, h } = stageSize();
      const z = b.dataset.zoom;
      if (z === "fit") {
        animateTo(fitView());
        return;
      }
      const v = app.view;
      const f = z === "in" ? 1.8 : 1 / 1.8;
      const s = clamp(v.s * f, app.minScale, MAX_SCALE);
      const wx = (w / 2 - v.tx) / v.s;
      const wy = (h / 2 - v.ty) / v.s;
      animateTo({ s, tx: w / 2 - wx * s, ty: h / 2 - wy * s }, 220);
    })
  );
  els.selbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sel]");
    if (!b || app.selected == null) return;
    const idx = app.selected;
    if (b.dataset.sel === "preview") openPreview(idx, "placed");
    else if (b.dataset.sel === "return") returnToHand(idx);
    else selectCard(null);
  });
  window.addEventListener("resize", onResizeCaptureCenter);
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKeyDown);

  // 台紙の描画
  try {
    await renderBaseBoard();
  } catch (err) {
    toast(`台紙の描画に失敗しました: ${err.message}`, "error", 6000);
  }
  document.getElementById("bd-board-loading")?.remove();
  scheduleDetailRender();
  schedulePrefetch(20);
  saveSession();
  if (Object.keys(session.placed).length === 0 && session.hand.length === 0) {
    toast("左下の山札をタップしてカードを引きましょう", "info", 3200);
  }
}

// ============================================================================
// セットアップ画面
// ============================================================================
function deckOptionsHtml() {
  const opts = [`<option value="">-- デッキを選択 --</option>`];
  if (hasLocalWebDeck()) opts.push(`<option value="local">🌐 Webデッキツールで編集中のデッキ</option>`);
  for (const d of app.decks) {
    opts.push(`<option value="saved:${escapeHtml(String(d.id))}">💾 ${escapeHtml(d.name || `デッキ #${d.id}`)}</option>`);
  }
  if (app.setup.deckKey === "json" && app.setup.deck) {
    opts.push(`<option value="json">📂 ${escapeHtml(app.setup.deck.title)}（JSONファイル）</option>`);
  }
  return opts.join("");
}

function deckSummaryHtml() {
  const st = app.setup;
  if (st.loading) return `<div class="bd-deck-summary is-loading">⏳ デッキを読み込んでいます…</div>`;
  if (st.error) return `<div class="bd-deck-summary is-error">⚠️ ${escapeHtml(st.error)}</div>`;
  if (!st.deck) return `<div class="bd-deck-summary is-empty">デッキを選ぶと構成が表示されます。</div>`;
  const sm = summarizeDeck(st.deck.cards);
  return `<div class="bd-deck-summary">
    <div class="bd-deck-name">🃏 ${escapeHtml(st.deck.title)}</div>
    <div class="bd-badges">
      <span class="bd-badge bd-badge-main">合計 <b>${sm.total}</b> 枚</span>
      <span class="bd-badge bd-badge-event">⚡ イベント <b>${sm.events}</b></span>
      <span class="bd-badge">🏠 世帯 <b>${sm.households}</b>（👤${sm.persons} 🐾${sm.pets}）</span>
    </div>
  </div>`;
}

function renderSetup() {
  const main = document.getElementById("bd-main");
  document.body.classList.add("is-setup");
  document.body.classList.remove("is-playing");
  const saved = readSavedSession();
  const st = app.setup;
  if (!st.boardId) st.boardId = resolveDefaultBoard(app.boards)?.id || "";

  let resumeHtml = "";
  if (saved) {
    const board = app.boards.find((b) => b.id === saved.boardId);
    const placedN = Object.keys(saved.placed || {}).length;
    const dt = saved.savedAt ? new Date(saved.savedAt) : null;
    const dtStr = dt ? `${dt.getMonth() + 1}/${dt.getDate()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}` : "";
    resumeHtml = `
      <section class="bd-resume" data-testid="bd-resume">
        <div class="bd-resume-text">
          <div class="bd-resume-title">前回の続きがあります</div>
          <div>🃏 ${escapeHtml(saved.deckTitle)}／🗺️ ${escapeHtml(board?.name || saved.boardId)}・${escapeHtml(resolveSheetSize(saved.sizeId).label)}</div>
          <div>配置 <b>${placedN}</b> / ${saved.cards.length} 枚 ${dtStr ? `（${dtStr} 保存）` : ""}</div>
        </div>
        <div class="bd-resume-actions">
          <button type="button" class="bd-btn bd-btn-primary" id="bd-resume-btn" data-testid="bd-resume-btn" ${board ? "" : "disabled"}>▶ 続きから</button>
          <button type="button" class="bd-btn bd-btn-ghost" id="bd-discard-btn" data-testid="bd-discard-btn">破棄</button>
        </div>
      </section>`;
  }

  main.innerHTML = `
    <div class="bd-setup" data-testid="bd-setup-view">
      <header class="bd-setup-header">
        <img ${LOGO_IMG_ATTRS} alt="HUG ロゴ" class="bd-setup-logo" />
        <div class="bd-setup-heading">
          <h1>台紙配置シミュレーション</h1>
          <p>デッキからカードを1枚ずつ引いて、訓練用の大きな台紙の上に自由に並べます。</p>
        </div>
        <a class="bd-back-link" href="./index.html">← デッキツール</a>
      </header>
      ${resumeHtml}
      <section class="bd-step">
        <h2><span class="bd-step-no">1</span>デッキを選ぶ</h2>
        <div class="bd-row">
          <select id="bd-deck-select" class="bd-select" data-testid="bd-deck-select">${deckOptionsHtml()}</select>
          <button type="button" class="bd-btn" id="bd-json-btn" data-testid="bd-json-btn">📂 JSONファイル</button>
          <input type="file" id="bd-json-input" data-testid="bd-json-input" accept=".json,application/json" hidden />
        </div>
        <div id="bd-deck-summary-wrap" data-testid="bd-deck-summary">${deckSummaryHtml()}</div>
      </section>
      <section class="bd-step">
        <h2><span class="bd-step-no">2</span>台紙を選ぶ</h2>
        <div class="bd-board-list" role="radiogroup" aria-label="台紙">
          ${app.boards
            .map(
              (b) => `
            <button type="button" class="bd-board-opt ${b.id === st.boardId ? "active" : ""}" data-board="${escapeHtml(b.id)}" data-testid="bd-board-opt-${escapeHtml(b.id)}" role="radio" aria-checked="${b.id === st.boardId}">
              <canvas class="bd-board-thumb"></canvas>
              <span class="bd-board-name">${escapeHtml(b.name)}</span>
            </button>`
            )
            .join("")}
        </div>
        <div class="bd-board-actions">
          <button type="button" class="bd-btn bd-btn-sm" id="bd-pdf-upload-btn" data-testid="bd-pdf-upload-btn">📄 手元のPDF台紙を追加</button>
          <input type="file" id="bd-pdf-upload-input" data-testid="bd-pdf-upload-input" accept=".pdf,application/pdf" hidden />
        </div>
        <div class="bd-size-label">台紙の大きさ</div>
        <div class="bd-size-row" role="radiogroup" aria-label="台紙の大きさ">
          ${Object.values(SHEET_SIZES)
            .map(
              (z) => `
            <button type="button" class="bd-size-opt ${z.id === st.sizeId ? "active" : ""}" data-size="${z.id}" data-testid="bd-size-${z.id}" role="radio" aria-checked="${z.id === st.sizeId}">
              <b>${escapeHtml(z.label)}</b>
              <span>${z.long}×${z.short}mm</span>
            </button>`
            )
            .join("")}
          <button type="button" class="bd-size-opt ${String(st.sizeId).startsWith("custom:") ? "active" : ""}" data-size="custom" data-testid="bd-size-custom" role="radio" aria-checked="${String(st.sizeId).startsWith("custom:")}">
            <b>任意倍率</b>
            <span>${String(st.sizeId).startsWith("custom:") ? `${resolveSheetSize(st.sizeId).long}×${resolveSheetSize(st.sizeId).short}mm` : "1〜64倍を指定"}</span>
          </button>
        </div>
        ${
          String(st.sizeId).startsWith("custom:")
            ? `<div class="bd-custom-size-row">
                 <label for="bd-custom-mult">A0の縦横</label>
                 <input type="number" class="bd-custom-size-input" id="bd-custom-mult" data-testid="bd-custom-mult" min="1" max="64" step="1" value="${st.customMult}" />
                 <span>倍（${resolveSheetSize(st.sizeId).long}×${resolveSheetSize(st.sizeId).short}mm）</span>
               </div>`
            : ""
        }
        <p class="bd-note">カードは名刺サイズ（55×91mm）。台紙との大きさの比率は実物どおりに表示されます。</p>
      </section>
      <div class="bd-start-wrap">
        <button type="button" class="bd-start-btn" id="bd-start-btn" data-testid="bd-start-btn" ${st.deck && !st.loading ? "" : "disabled"}>🃏 配置をはじめる</button>
      </div>
      <details class="bd-howto bd-setup-howto">
        <summary>操作方法</summary>
        ${HOWTO_HTML}
      </details>
    </div>`;

  const sel = document.getElementById("bd-deck-select");
  sel.value = st.deckKey || "";
  sel.addEventListener("change", () => selectDeck(sel.value));
  const fileInput = document.getElementById("bd-json-input");
  document.getElementById("bd-json-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      st.deck = buildDeckFromJsonText(app.db, text, f.name);
      st.deckKey = "json";
      st.error = "";
    } catch (err) {
      st.error = `JSONの読み込みに失敗しました: ${err.message}`;
    }
    renderSetup();
  });
  main.querySelectorAll(".bd-board-opt").forEach((btn) => {
    const b = app.boards.find((x) => x.id === btn.dataset.board);
    if (b) renderBoardThumb(b, btn.querySelector("canvas"));
    btn.addEventListener("click", () => {
      st.boardId = btn.dataset.board;
      main.querySelectorAll(".bd-board-opt").forEach((x) => {
        x.classList.toggle("active", x === btn);
        x.setAttribute("aria-checked", String(x === btn));
      });
    });
  });
  const pdfUploadInput = document.getElementById("bd-pdf-upload-input");
  document.getElementById("bd-pdf-upload-btn")?.addEventListener("click", () => pdfUploadInput?.click());
  pdfUploadInput?.addEventListener("change", async () => {
    const f = pdfUploadInput.files?.[0];
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const customId = `custom_${Date.now()}`;
      const customBoard = {
        id: customId,
        name: f.name.replace(/\.pdf$/i, ""),
        page: 1,
        bytes,
      };
      await loadBoardInfo(customBoard);
      app.boards.push(customBoard);
      st.boardId = customId;
      toast(`台紙「${customBoard.name}」を追加しました`, "success");
      renderSetup();
    } catch (err) {
      toast(`台紙PDFを読み込めませんでした: ${err?.message || err}`, "error", 4500);
    }
  });
  main.querySelectorAll(".bd-size-opt").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.size === "custom") {
        const m = Math.max(1, Math.min(64, Number(st.customMult) || 24));
        st.customMult = m;
        st.sizeId = `custom:${m}`;
        renderSetup();
      } else {
        st.sizeId = btn.dataset.size;
        renderSetup();
      }
    })
  );
  const customMultInput = document.getElementById("bd-custom-mult");
  if (customMultInput) {
    customMultInput.addEventListener("change", () => {
      const m = Math.max(1, Math.min(64, Number(customMultInput.value) || 24));
      st.customMult = m;
      st.sizeId = `custom:${m}`;
      renderSetup();
    });
  }
  document.getElementById("bd-start-btn").addEventListener("click", () => {
    if (!st.deck) return;
    if (readSavedSession() && !confirm("前回の配置データは新しい配置で上書きされます。よろしいですか？")) return;
    startPlay({
      v: 1,
      deckTitle: st.deck.title,
      cards: st.deck.cards,
      boardId: st.boardId,
      sizeId: st.sizeId,
      next: 0,
      hand: [],
      placed: {},
      z: 0,
    });
  });
  document.getElementById("bd-resume-btn")?.addEventListener("click", () => {
    const s = readSavedSession();
    if (s) startPlay(s);
  });
  document.getElementById("bd-discard-btn")?.addEventListener("click", () => {
    if (!confirm("前回の配置データを破棄しますか？")) return;
    localStorage.removeItem(SESSION_KEY);
    renderSetup();
  });
}

async function selectDeck(key) {
  const st = app.setup;
  st.deckKey = key;
  st.error = "";
  if (!key) {
    st.deck = null;
    refreshDeckSummary();
    return;
  }
  if (key === "json") return;
  st.loading = true;
  st.deck = null;
  refreshDeckSummary();
  try {
    if (key === "local") st.deck = buildDeckFromLocalWebDeck(app.db);
    else if (key.startsWith("saved:")) st.deck = await buildDeckFromSaved(app.db, app.decks, key.slice(6));
  } catch (err) {
    st.error = err.message || "デッキの読み込みに失敗しました";
  }
  if (st.deckKey !== key) return; // 途中で別のデッキが選ばれた
  st.loading = false;
  refreshDeckSummary();
}

function refreshDeckSummary() {
  const wrap = document.getElementById("bd-deck-summary-wrap");
  if (wrap) wrap.innerHTML = deckSummaryHtml();
  const btn = document.getElementById("bd-start-btn");
  if (btn) btn.disabled = !app.setup.deck || app.setup.loading;
}

// ============================================================================
// エントリポイント
// ============================================================================
async function main() {
  loadSettings();
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  const [db, boards] = await Promise.all([loadCardDatabase(), loadBoardManifest()]);
  app.db = db;
  app.boards = boards;
  app.decks = await fetchSavedDecks(db);

  const params = new URLSearchParams(window.location.search);
  const boardParam = params.get("board");
  if (boardParam && boards.some((b) => b.id === boardParam)) app.setup.boardId = boardParam;
  const sizeParam = params.get("size");
  if (sizeParam) {
    const resolved = resolveSheetSize(sizeParam);
    app.setup.sizeId = resolved.id;
    if (resolved.id.startsWith("custom:")) app.setup.customMult = resolved.mult;
  }

  let initialKey = "";
  const deckParam = params.get("deck");
  const deckIdParam = params.get("deck_id");
  if (params.get("source") === "local" && hasLocalWebDeck()) initialKey = "local";
  else {
    const pick =
      (deckIdParam &&
        app.decks.find(
          (d) => String(d.id) === String(deckIdParam) || String(d.id) === `static-${deckIdParam}`
        )) ||
      (deckParam && app.decks.find((d) => String(d.name || "").trim() === deckParam.trim())) ||
      app.decks.find((d) => String(d.name || "").includes("五小rev5")) ||
      app.decks.find((d) => String(d.name || "").includes("五小")) ||
      app.decks[0];
    if (pick) initialKey = `saved:${pick.id}`;
  }
  renderSetup();
  if (initialKey) {
    const sel = document.getElementById("bd-deck-select");
    if (sel) sel.value = initialKey;
    await selectDeck(initialKey);
    if (params.get("autostart") === "1" && app.setup.deck) {
      startPlay({
        v: 1,
        deckTitle: app.setup.deck.title,
        cards: app.setup.deck.cards,
        boardId: app.setup.boardId,
        sizeId: app.setup.sizeId,
        next: 0,
        hand: [],
        placed: {},
        z: 0,
      });
    }
  }
}

main().catch((err) => {
  console.warn(err);
  const m = document.getElementById("bd-main");
  if (m) m.innerHTML = `<div class="bd-loading">読み込みに失敗しました: ${escapeHtml(err?.message || String(err))}</div>`;
});
