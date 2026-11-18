/**
 * 共通台紙レンダリング＆操作エンジン（マルチユーザー版 coop.html / admin.html 共用）.
 *
 * モバイルブラウザでのメモリクラッシュを防ぐため、台紙はビューポートサイズの
 * 単一キャンバス（drawViewportBoard）へ可視領域のみ転送して描画する。
 */
import { generateCardImageCanvas, toCardRenderModel, FIXED_DESIGN_MODE } from "./cardCanvas.js";
import { store } from "./store.js";

export const CARD_W = 55; // mm (名刺サイズ)
export const CARD_H = 91; // mm
export const MM_PER_PT = 25.4 / 72;
export const PT_PER_MM = 72 / 25.4;
export const DESK_MARGIN = 150; // mm
export const CLUSTER_CARD_PX = 28;
export const MAX_SCALE = 12; // px/mm

export const SHEET_PRESETS = {
  "4x": { id: "4x", label: "A0の縦横4倍", mult: 4, short: 841 * 4, long: 1189 * 4 },
  "8x": { id: "8x", label: "A0の縦横8倍（規定）", mult: 8, short: 841 * 8, long: 1189 * 8 },
  "16x": { id: "16x", label: "A0の縦横16倍", mult: 16, short: 841 * 16, long: 1189 * 16 },
  "32x": { id: "32x", label: "A0の縦横32倍", mult: 32, short: 841 * 32, long: 1189 * 32 },
};

export function isIosBrowser() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * PDF 1.6 UserUnit を算出し、MediaBox が 14,400pt (200inch) を超えて
 * iOS Safari / Edge (PDFKit) や Acrobat で切り詰め・エラーにならないようにする.
 */
export function calcPdfUserUnit(rawWidthPt, rawHeightPt) {
  const maxDim = Math.max(rawWidthPt || 0, rawHeightPt || 0);
  if (maxDim <= 14400) return 1;
  return Math.min(75, Math.ceil(maxDim / 14000));
}

export async function canvasToJpegBytes(canvas, quality = 0.88) {
  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function imageUrlToJpegBytes(
  url,
  scratchCanvas = null,
  { maxWidth = 540, quality = 0.86 } = {}
) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("カード画像の読み込みに失敗しました"));
    el.src = url;
  });
  const srcW = img.naturalWidth || 600;
  const srcH = img.naturalHeight || 993;
  const scale = maxWidth > 0 && srcW > maxWidth ? maxWidth / srcW : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const ownCanvas = !scratchCanvas;
  const c = scratchCanvas || document.createElement("canvas");
  try {
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await canvasToJpegBytes(c, quality);
  } finally {
    img.src = "";
    if (ownCanvas) {
      c.width = 0;
      c.height = 0;
    }
  }
}

function escapePdfModalHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPdfSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ensurePdfReadyStyles() {
  if (document.getElementById("hug-pdf-ready-style")) return;
  const st = document.createElement("style");
  st.id = "hug-pdf-ready-style";
  st.textContent = `
    .hug-pdf-ready-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(15, 23, 42, 0.56);
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
    }
    .hug-pdf-ready-card {
      background: #ffffff; color: #0f172a;
      border-radius: 16px; padding: 1.25rem;
      width: 100%; max-width: 390px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
      display: flex; flex-direction: column; gap: 0.75rem;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", sans-serif;
    }
    .hug-pdf-ready-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .hug-pdf-ready-title { font-size: 1.05rem; font-weight: 800; }
    .hug-pdf-ready-close {
      border: 1px solid #cbd5e1; background: #f8fafc; color: #334155;
      border-radius: 8px; width: 34px; height: 34px; font-size: 1rem; cursor: pointer;
    }
    .hug-pdf-ready-meta {
      background: #f1f5f9; border-radius: 10px; padding: 0.65rem 0.8rem;
      font-size: 0.82rem; color: #334155; word-break: break-all; line-height: 1.45;
    }
    .hug-pdf-ready-btn {
      display: flex; align-items: center; justify-content: center; gap: 0.4rem;
      width: 100%; min-height: 46px; padding: 0.65rem 1rem;
      border-radius: 10px; border: 1px solid #cbd5e1;
      background: #ffffff; color: #0f172a; text-decoration: none;
      font-size: 0.94rem; font-weight: 700; cursor: pointer; box-sizing: border-box;
    }
    .hug-pdf-ready-btn.is-primary {
      background: #2563eb; border-color: #1d4ed8; color: #ffffff;
    }
    .hug-pdf-ready-hint { font-size: 0.78rem; color: #475569; margin: 0; line-height: 1.45; }
  `;
  document.head.appendChild(st);
}

/**
 * PDF Blob をブラウザ仕様に合わせて安全に保存・共有する.
 * iOS Safari / Edge (WKWebView) は <a download href="blob:..."> で「リソースエラー」になるため、
 * ユーザー操作起点の navigator.share({ files }) および別タブ表示ダイアログを提供する.
 */
export async function deliverPdfBlob(blob, fname, { subtitle = "" } = {}) {
  const url = URL.createObjectURL(blob);
  if (!isIosBrowser()) {
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 120000);
    return { mode: "download", url };
  }

  // iOS (Edge/Safari/Chrome): ネイティブダウンロードの blob リソースエラーを回避するため長寿命保持
  setTimeout(() => URL.revokeObjectURL(url), 300000);
  ensurePdfReadyStyles();
  document.querySelectorAll('[data-testid="bd-pdf-ready-modal"]').forEach((el) => el.remove());

  const ov = document.createElement("div");
  ov.className = "hug-pdf-ready-overlay";
  ov.setAttribute("data-testid", "bd-pdf-ready-modal");
  const sizeText = formatPdfSize(blob.size);
  ov.innerHTML = `
    <div class="hug-pdf-ready-card" role="dialog" aria-modal="true" aria-label="PDFの準備ができました">
      <div class="hug-pdf-ready-head">
        <span class="hug-pdf-ready-title">📄 PDFの準備ができました</span>
        <button type="button" class="hug-pdf-ready-close" data-testid="bd-pdf-ready-close" aria-label="閉じる">✕</button>
      </div>
      <div class="hug-pdf-ready-meta">
        <div><b>${escapePdfModalHtml(fname)}</b></div>
        <div>${[sizeText, subtitle].filter(Boolean).map(escapePdfModalHtml).join(" ・ ")}</div>
      </div>
      <button type="button" class="hug-pdf-ready-btn is-primary" data-testid="bd-pdf-share-btn">📤 ファイルに保存・共有する</button>
      <a class="hug-pdf-ready-btn" href="${url}" target="_blank" rel="noopener" data-testid="bd-pdf-open-btn">👁️ 別タブでPDFを開く</a>
      <p class="hug-pdf-ready-hint">iPhone / iPad では「ファイルに保存・共有する」から「“ファイル”に保存」を選ぶか、「別タブでPDFを開く」から共有ボタンで保存できます。</p>
    </div>
  `;
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => {
    if (e.target === ov) close();
  });
  ov.querySelector('[data-testid="bd-pdf-ready-close"]').addEventListener("click", close);
  ov.querySelector('[data-testid="bd-pdf-share-btn"]').addEventListener("click", async () => {
    try {
      const file = new File([blob], fname, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] }) || typeof navigator.share === "function") {
        await navigator.share({ files: [file], title: fname });
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
    window.open(url, "_blank", "noopener");
  });
  document.body.appendChild(ov);
  return { mode: "modal", url };
}

/**
 * サイズ指定（"4x" / "8x" / "16x" / "32x" / "custom:N" / 数値倍率）を寸法へ解決する.
 * @param {string|number} sizeSpec
 */
export function resolveSheetSize(sizeSpec) {
  if (typeof sizeSpec === "string" && SHEET_PRESETS[sizeSpec]) {
    return SHEET_PRESETS[sizeSpec];
  }
  const raw = String(sizeSpec || "8x").trim();
  const mMatch = raw.match(/^(?:custom:)?(\d+(?:\.\d+)?)x?$/i);
  if (mMatch) {
    const mult = Math.max(1, Math.min(64, Number(mMatch[1]) || 8));
    return {
      id: `custom:${mult}`,
      label: `A0の縦横${mult}倍`,
      mult,
      short: Math.round(841 * mult),
      long: Math.round(1189 * mult),
    };
  }
  return SHEET_PRESETS["8x"];
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

/** カードデータから表示ラベル・イベント判定を取り出す. */
export function cardSummary(card, idx) {
  const isEvent = Boolean(card && (card.kind === "event" || card.type === "イベント"));
  const no = Number(card?.no ?? card?.card_no ?? card?.number ?? idx + 1);
  const title = isEvent
    ? card?.event_title || card?.name || card?.title || `イベント ${no}`
    : card?.name || card?.role || `カード ${no}`;
  return { isEvent, no, title };
}

/** 台紙PDFを読み込む. */
export async function loadBoardPdf(board) {
  if (!pdfjsLib) throw new Error("PDF.js が読み込まれていません。");
  let bytes;
  if (board.bytes) {
    bytes = board.bytes;
  } else {
    const candidates = [board.url, board.fallbackUrl].filter(Boolean);
    let lastErr = null;
    for (const u of candidates) {
      try {
        const res = await fetch(u, { cache: "no-cache" });
        if (res.ok) {
          bytes = new Uint8Array(await res.arrayBuffer());
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (!bytes) throw lastErr || new Error("台紙PDFを取得できませんでした。");
  }
  const doc = await pdfjsLib.getDocument({ ...PDF_OPTIONS, data: bytes.slice() }).promise;
  const pageNum = clamp(Number(board.page) || 1, 1, doc.numPages);
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  return { doc, page, bytes, wPt: vp.width, hPt: vp.height };
}

/** 台紙とカード(55×91mm)の実寸ジオメトリを計算する. */
export function computeBoardGeometry(info, sizeSpec) {
  const s = resolveSheetSize(sizeSpec);
  const landscape = info.wPt >= info.hPt;
  const W = landscape ? s.long : s.short;
  const H = landscape ? s.short : s.long;
  const pw = info.wPt * MM_PER_PT;
  const ph = info.hPt * MM_PER_PT;
  const fit = Math.min(W / pw, H / ph);
  const w = pw * fit;
  const h = ph * fit;
  return { W, H, size: s, pdf: { x: (W - w) / 2, y: (H - h) / 2, w, h, ptToMm: MM_PER_PT * fit } };
}

/**
 * カード画像をオフスクリーン生成・キャッシュするヘルパー.
 */
export class CardImageCache {
  constructor() {
    this.cache = new Map();
  }
  clear() {
    this.cache.clear();
  }
  async ensure(idx, card) {
    if (this.cache.has(idx)) return this.cache.get(idx);
    const p = (async () => {
      const model = toCardRenderModel(card, card?.group, {
        cardNumber: card?.card_number ?? card?.no ?? idx + 1,
        imageIds: store.imageIds,
        groupIndex: card?.group_index,
        groupTotal: card?.group_total,
      });
      const url = await generateCardImageCanvas(model, FIXED_DESIGN_MODE, { showNumber: true });
      const jpgBytes = await imageUrlToJpegBytes(url, null, { maxWidth: 540, quality: 0.88 });
      return { url, jpgBytes };
    })();
    this.cache.set(idx, p);
    return p;
  }
}

/**
 * 共有台紙ステージコントローラ.
 */
export function createBoardStage({
  stageEl,
  baseCanvasEl,
  cardWorldEl,
  clusterLayerEl,
  imageCache,
  readOnly = false,
  onSelectCard = null,
  onMoveCard = null,
  onDragState = null,
  getBadgeText = null,
}) {
  const state = {
    boardInfo: null,
    geo: null,
    baseRes: 1,
    baseOffscreen: null,
    detailOffscreen: null,
    ink: null,
    view: { s: 0.1, tx: 0, ty: 0 },
    minScale: 0.02,
    cards: [],
    placed: {},
    locks: {},
    selected: null,
    cardEls: new Map(),
    detail: { timer: 0, task: null, rendered: null, token: 0 },
    animToken: 0,
    viewRaf: 0,
    ptr: {
      map: new Map(),
      mode: null,
      panStart: null,
      pinch: null,
      card: null,
      lastTap: null,
    },
    destroyed: false,
  };

  const stageSize = () => ({
    w: stageEl?.clientWidth || 1,
    h: stageEl?.clientHeight || 1,
  });

  function updateScaleLimits() {
    if (!state.geo) return;
    const { w, h } = stageSize();
    const fit = Math.min(w / (state.geo.W + DESK_MARGIN * 2), h / (state.geo.H + DESK_MARGIN * 2));
    state.minScale = Math.max(0.002, fit * 0.5);
  }

  function fitView() {
    if (!state.geo) return { s: 0.1, tx: 0, ty: 0 };
    const { w, h } = stageSize();
    const pad = 28;
    const s = clamp(
      Math.min((w - pad) / state.geo.W, (h - pad) / state.geo.H),
      state.minScale,
      MAX_SCALE
    );
    return { s, tx: (w - state.geo.W * s) / 2, ty: (h - state.geo.H * s) / 2 };
  }

  function clampView(v) {
    if (!state.geo) return v;
    const { w, h } = stageSize();
    const s = clamp(v.s, state.minScale, MAX_SCALE);
    const keepX = Math.min(w * 0.45, 160);
    const keepY = Math.min(h * 0.45, 160);
    const minTx = keepX - (state.geo.W + DESK_MARGIN) * s;
    const maxTx = w - keepX + DESK_MARGIN * s;
    const minTy = keepY - (state.geo.H + DESK_MARGIN) * s;
    const maxTy = h - keepY + DESK_MARGIN * s;
    return { s, tx: clamp(v.tx, minTx, maxTx), ty: clamp(v.ty, minTy, maxTy) };
  }

  function screenToWorld(px, py) {
    return { x: (px - state.view.tx) / state.view.s, y: (py - state.view.ty) / state.view.s };
  }

  function stageLocal(e) {
    const r = stageEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function isClusterMode() {
    return CARD_W * state.view.s < CLUSTER_CARD_PX;
  }

  function drawViewportBoard() {
    if (state.destroyed || !baseCanvasEl || !stageEl) return;
    const vw = stageEl.clientWidth;
    const vh = stageEl.clientHeight;
    if (!vw || !vh) return;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 2 : 2.5);
    const cw = Math.max(1, Math.round(vw * dpr));
    const ch = Math.max(1, Math.round(vh * dpr));
    if (baseCanvasEl.width !== cw || baseCanvasEl.height !== ch) {
      baseCanvasEl.width = cw;
      baseCanvasEl.height = ch;
    }
    const ctx = baseCanvasEl.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const geo = state.geo;
    if (!geo) return;

    const { s, tx, ty } = state.view;
    const k = s * dpr;

    const deskX0 = clamp((tx - DESK_MARGIN * s) * dpr, 0, cw);
    const deskY0 = clamp((ty - DESK_MARGIN * s) * dpr, 0, ch);
    const deskX1 = clamp((tx + (geo.W + DESK_MARGIN) * s) * dpr, 0, cw);
    const deskY1 = clamp((ty + (geo.H + DESK_MARGIN) * s) * dpr, 0, ch);
    if (deskX1 > deskX0 && deskY1 > deskY0) {
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(deskX0, deskY0, deskX1 - deskX0, deskY1 - deskY0);
    }

    const sx0 = clamp(tx * dpr, 0, cw);
    const sy0 = clamp(ty * dpr, 0, ch);
    const sx1 = clamp((tx + geo.W * s) * dpr, 0, cw);
    const sy1 = clamp((ty + geo.H * s) * dpr, 0, ch);
    if (sx1 > sx0 && sy1 > sy0) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    }

    const base = state.baseOffscreen;
    if (base && base.width > 0 && base.height > 0) {
      const wx0 = clamp(-tx / s, 0, geo.W);
      const wy0 = clamp(-ty / s, 0, geo.H);
      const wx1 = clamp((vw - tx) / s, 0, geo.W);
      const wy1 = clamp((vh - ty) / s, 0, geo.H);
      if (wx1 > wx0 && wy1 > wy0) {
        ctx.drawImage(
          base,
          wx0 * state.baseRes,
          wy0 * state.baseRes,
          (wx1 - wx0) * state.baseRes,
          (wy1 - wy0) * state.baseRes,
          (wx0 * s + tx) * dpr,
          (wy0 * s + ty) * dpr,
          (wx1 - wx0) * k,
          (wy1 - wy0) * k
        );
      }
    }

    const r = state.detail.rendered;
    const det = state.detailOffscreen;
    if (r && det && det.width > 0 && det.height > 0 && s * dpr > state.baseRes * 1.15) {
      const scaleRatio = s / r.s;
      ctx.drawImage(
        det,
        0,
        0,
        det.width,
        det.height,
        (tx - r.tx * scaleRatio) * dpr,
        (ty - r.ty * scaleRatio) * dpr,
        r.vw * scaleRatio * dpr,
        r.vh * scaleRatio * dpr
      );
    }
  }

  function scheduleDetailRender() {
    clearTimeout(state.detail.timer);
    state.detail.timer = setTimeout(renderDetail, 90);
  }

  async function renderDetail() {
    if (state.destroyed || !state.geo || !state.boardInfo || !stageEl) return;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 2 : 2.5);
    const v = { ...state.view };
    const r = v.s * dpr;
    if (r <= state.baseRes * 1.15) {
      state.detail.rendered = null;
      drawViewportBoard();
      return;
    }

    const token = ++state.detail.token;
    if (state.detail.task) {
      try {
        state.detail.task.cancel();
      } catch {
        // ignore
      }
      state.detail.task = null;
    }
    const vw = stageEl.clientWidth;
    const vh = stageEl.clientHeight;
    if (!vw || !vh) return;

    // ビューポートサイズのオフスクリーンへベクターPDFを実画面ネイティブ解像度で直接描画する
    // （PDF.js内部のbeginGroup等もオフスクリーン境界でクリップされるため巨大バッファは発生しない）
    const offW = Math.max(1, Math.round(vw * dpr));
    const offH = Math.max(1, Math.round(vh * dpr));
    const off = state.detailOffscreen || document.createElement("canvas");
    state.detailOffscreen = off;
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
    const sx1 = clamp(sx + state.geo.W * r, 0, offW);
    const sy1 = clamp(sy + state.geo.H * r, 0, offH);
    if (sx1 > sx0 && sy1 > sy0) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    }
    try {
      const viewport = state.boardInfo.page.getViewport({ scale: r * state.geo.pdf.ptToMm });
      const task = state.boardInfo.page.render({
        canvasContext: ctx,
        viewport,
        transform: [1, 0, 0, 1, sx + state.geo.pdf.x * r, sy + state.geo.pdf.y * r],
        background: "rgba(0,0,0,0)",
      });
      state.detail.task = task;
      await task.promise;
    } catch {
      return;
    }
    if (token !== state.detail.token || state.destroyed) return;
    state.detail.task = null;
    state.detail.rendered = { s: v.s, tx: v.tx, ty: v.ty, vw, vh };
    drawViewportBoard();
  }

  function buildInkMap() {
    const geo = state.geo;
    const base = state.baseOffscreen;
    if (!geo || !base || !base.width) return;
    const cell = Math.max(5, Math.ceil(Math.max(geo.W, geo.H) / 360));
    const gw = Math.ceil(geo.W / cell);
    const gh = Math.ceil(geo.H / cell);
    let src = base;
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
    const octx = out.getContext("2d");
    octx.drawImage(src, 0, 0, gw, gh);
    const d = octx.getImageData(0, 0, gw, gh).data;
    const sat = new Float64Array((gw + 1) * (gh + 1));
    const W1 = gw + 1;
    for (let y = 0; y < gh; y++) {
      let row = 0;
      for (let x = 0; x < gw; x++) {
        const i = (y * gw + x) * 4;
        const ink = Math.max(0, 1 - (d[i] + d[i + 1] + d[i + 2]) / (3 * 255));
        row += ink;
        sat[(y + 1) * W1 + (x + 1)] = sat[y * W1 + (x + 1)] + row;
      }
    }
    state.ink = { cell, gw, gh, sat };
  }

  function findEmptySpot(prefer) {
    const { ink, geo } = state;
    if (!ink || !geo) return prefer;
    const { cell, gw, gh, sat } = ink;
    const cw = Math.ceil((CARD_W + 6) / cell);
    const ch = Math.ceil((CARD_H + 6) / cell);
    const W1 = gw + 1;
    const placedRects = Object.values(state.placed || {});
    const step = gw * gh > 60000 ? 2 : 1;
    let best = null;
    for (let gy = 1; gy <= gh - ch - 1; gy += step) {
      for (let gx = 1; gx <= gw - cw - 1; gx += step) {
        const inkSum =
          sat[(gy + ch) * W1 + (gx + cw)] -
          sat[gy * W1 + (gx + cw)] -
          sat[(gy + ch) * W1 + gx] +
          sat[gy * W1 + gx];
        const cx = (gx + cw / 2) * cell;
        const cy = (gy + ch / 2) * cell;
        let overlap = false;
        for (const p of placedRects) {
          if (Math.abs(cx - p.x) < CARD_W + 8 && Math.abs(cy - p.y) < CARD_H + 8) {
            overlap = true;
            break;
          }
        }
        const dCenter = Math.hypot(cx - prefer.x, cy - prefer.y) / Math.max(geo.W, geo.H);
        const score = inkSum + (overlap ? 1e6 : 0) + dCenter * 0.25;
        if (!best || score < best.score) best = { score, x: cx, y: cy };
      }
    }
    return best ? { x: best.x, y: best.y } : prefer;
  }

  function renderClusters() {
    if (!clusterLayerEl) return;
    if (!isClusterMode()) {
      clusterLayerEl.innerHTML = "";
      return;
    }
    const { s, tx, ty } = state.view;
    const { w, h } = stageSize();
    const radius = 56;
    const items = Object.entries(state.placed || {})
      .map(([k, p]) => ({ idx: Number(k), x: p.x, y: p.y, sx: p.x * s + tx, sy: p.y * s + ty }))
      .filter((it) => it.sx > -80 && it.sx < w + 80 && it.sy > -80 && it.sy < h + 80);

    const clusters = [];
    for (const it of items) {
      let hit = null;
      let bestD = radius;
      for (const c of clusters) {
        const d = Math.hypot(it.sx - c.sx, it.sy - c.sy);
        if (d < bestD) {
          bestD = d;
          hit = c;
        }
      }
      if (hit) {
        const n = hit.items.length;
        hit.sx = (hit.sx * n + it.sx) / (n + 1);
        hit.sy = (hit.sy * n + it.sy) / (n + 1);
        hit.items.push(it);
      } else {
        clusters.push({ sx: it.sx, sy: it.sy, items: [it] });
      }
    }

    clusterLayerEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    clusters.forEach((c, ci) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bd-cluster";
      btn.dataset.testid = "bd-cluster";
      btn.style.left = `${c.sx}px`;
      btn.style.top = `${c.sy}px`;
      btn.textContent = String(c.items.length);
      btn.setAttribute("aria-label", `${c.items.length}枚のカードの場所へ拡大`);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        zoomToCards(c.items);
      });
      frag.appendChild(btn);
    });
    clusterLayerEl.appendChild(frag);
  }

  function applyView() {
    if (state.destroyed || !stageEl) return;
    const { s, tx, ty } = state.view;
    if (cardWorldEl) {
      cardWorldEl.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    }
    stageEl.classList.toggle("is-cluster", isClusterMode());
    if (state.selected != null) {
      const el = state.cardEls.get(state.selected);
      if (el) el.style.setProperty("--ui-px", `${1 / s}px`);
    }
    renderClusters();
    drawViewportBoard();
    scheduleDetailRender();
  }

  function requestView() {
    if (state.viewRaf) return;
    state.viewRaf = requestAnimationFrame(() => {
      state.viewRaf = 0;
      applyView();
    });
  }

  function setView(v) {
    state.view = clampView(v);
    requestView();
  }

  function animateTo(target, ms = 280) {
    const token = ++state.animToken;
    const from = { ...state.view };
    const to = clampView(target);
    const { w, h } = stageSize();
    const c0 = { x: (w / 2 - from.tx) / from.s, y: (h / 2 - from.ty) / from.s };
    const c1 = { x: (w / 2 - to.tx) / to.s, y: (h / 2 - to.ty) / to.s };
    const t0 = performance.now();
    const step = (now) => {
      if (token !== state.animToken || state.destroyed) return;
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const s = from.s * Math.pow(to.s / from.s, e);
      const cx = c0.x + (c1.x - c0.x) * e;
      const cy = c0.y + (c1.y - c0.y) * e;
      setView({ s, tx: w / 2 - cx * s, ty: h / 2 - cy * s });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function zoomToCards(items, minCardPx = CLUSTER_CARD_PX * 2.6) {
    if (!items || !items.length) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x - CARD_W / 2);
      y0 = Math.min(y0, it.y - CARD_H / 2);
      x1 = Math.max(x1, it.x + CARD_W / 2);
      y1 = Math.max(y1, it.y + CARD_H / 2);
    }
    const { w, h } = stageSize();
    const bw = Math.max(CARD_W * 2.2, x1 - x0);
    const bh = Math.max(CARD_H * 1.8, y1 - y0);
    let s = Math.min((w * 0.78) / bw, (h * 0.72) / bh);
    s = clamp(s, minCardPx / CARD_W, Math.min(MAX_SCALE, 5));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    animateTo({ s, tx: w / 2 - cx * s, ty: h / 2 - cy * s }, 300);
  }

  function syncCards(cards, placed, locks = {}) {
    state.cards = cards || [];
    state.placed = placed || {};
    state.locks = locks || {};
    if (!cardWorldEl) return;

    const active = new Set(Object.keys(state.placed).map(Number));
    for (const [idx, el] of state.cardEls) {
      if (!active.has(idx)) {
        el.remove();
        state.cardEls.delete(idx);
      }
    }

    for (const [key, p] of Object.entries(state.placed)) {
      const idx = Number(key);
      // ローカルでドラッグ中のカードは位置上書きしない
      if (state.ptr.card && state.ptr.card.idx === idx && state.ptr.card.moved) continue;
      let el = state.cardEls.get(idx);
      if (!el) {
        const card = state.cards[idx];
        const info = cardSummary(card, idx);
        el = document.createElement("div");
        el.className = `bd-card ${info.isEvent ? "is-event" : ""}`;
        el.dataset.idx = String(idx);
        el.dataset.testid = `coop-placed-card-${idx}`;
        el.innerHTML = `<img alt="No.${info.no}" draggable="false" /><span class="coop-card-badge" hidden></span>`;
        if (readOnly) el.style.cursor = "default";
        cardWorldEl.appendChild(el);
        state.cardEls.set(idx, el);
        imageCache.ensure(idx, card).then((m) => {
          const img = el.querySelector("img");
          if (img && img.src !== m.url) img.src = m.url;
        });
      }
      el.style.left = `${p.x - CARD_W / 2}px`;
      el.style.top = `${p.y - CARD_H / 2}px`;
      el.style.zIndex = String(p.z || 1);
      el.classList.toggle("is-selected", state.selected === idx);

      const badge = el.querySelector(".coop-card-badge");
      if (badge) {
        const lock = state.locks?.[String(idx)];
        const badgeText = getBadgeText ? getBadgeText(idx, p, lock) : "";
        if (badgeText) {
          badge.textContent = badgeText;
          badge.hidden = false;
          el.classList.toggle("is-locked-other", Boolean(lock));
        } else {
          badge.hidden = true;
          el.classList.remove("is-locked-other");
        }
      }
    }
    renderClusters();
  }

  function selectCard(idx) {
    state.selected = idx;
    for (const [k, el] of state.cardEls) {
      el.classList.toggle("is-selected", k === idx);
      if (k === idx) el.style.setProperty("--ui-px", `${1 / state.view.s}px`);
    }
    if (onSelectCard) onSelectCard(idx);
  }

  function onStageDown(e) {
    if (e.target.closest(".bd-cluster, .bd-zoom-ctrl, .bd-selbar, button, a")) return;
    const p = stageLocal(e);
    state.ptr.map.set(e.pointerId, p);
    try {
      stageEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    state.animToken++;

    if (state.ptr.map.size >= 2) {
      const pts = [...state.ptr.map.values()];
      const d = Math.max(10, dist(pts[0], pts[1]));
      const m = mid(pts[0], pts[1]);
      if (state.ptr.card && state.ptr.card.moved) {
        if (onDragState) onDragState(state.ptr.card.idx, false);
      }
      state.ptr.card = null;
      state.ptr.pinch = {
        d0: d,
        s0: state.view.s,
        wx: (m.x - state.view.tx) / state.view.s,
        wy: (m.y - state.view.ty) / state.view.s,
      };
      state.ptr.mode = "pinch";
      return;
    }

    const cardEl = !readOnly ? e.target.closest(".bd-card") : null;
    if (cardEl && !isClusterMode()) {
      const idx = Number(cardEl.dataset.idx);
      const pos = state.placed[String(idx)];
      if (pos) {
        const w = screenToWorld(p.x, p.y);
        state.ptr.mode = "card";
        state.ptr.card = {
          idx,
          el: cardEl,
          startPx: p,
          moved: false,
          ox: pos.x - w.x,
          oy: pos.y - w.y,
          x: pos.x,
          y: pos.y,
        };
        selectCard(idx);
        return;
      }
    }

    state.ptr.mode = "pan";
    state.ptr.panStart = { p, tx: state.view.tx, ty: state.view.ty, moved: false };
  }

  function onStageMove(e) {
    if (!state.ptr.map.has(e.pointerId)) return;
    const p = stageLocal(e);
    state.ptr.map.set(e.pointerId, p);

    if (state.ptr.mode === "pinch" && state.ptr.map.size >= 2) {
      const pts = [...state.ptr.map.values()];
      const d = Math.max(10, dist(pts[0], pts[1]));
      const m = mid(pts[0], pts[1]);
      const s = clamp(state.ptr.pinch.s0 * (d / state.ptr.pinch.d0), state.minScale, MAX_SCALE);
      setView({ s, tx: m.x - state.ptr.pinch.wx * s, ty: m.y - state.ptr.pinch.wy * s });
      return;
    }

    if (state.ptr.mode === "card" && state.ptr.card) {
      const c = state.ptr.card;
      if (!c.moved && dist(p, c.startPx) > 4) {
        c.moved = true;
        c.el.classList.add("is-dragging");
        if (onDragState) onDragState(c.idx, true);
      }
      if (c.moved && state.geo) {
        const w = screenToWorld(p.x, p.y);
        c.x = clamp(w.x + c.ox, -DESK_MARGIN + CARD_W / 2, state.geo.W + DESK_MARGIN - CARD_W / 2);
        c.y = clamp(w.y + c.oy, -DESK_MARGIN + CARD_H / 2, state.geo.H + DESK_MARGIN - CARD_H / 2);
        c.el.style.left = `${c.x - CARD_W / 2}px`;
        c.el.style.top = `${c.y - CARD_H / 2}px`;
      }
      return;
    }

    if (state.ptr.mode === "pan" && state.ptr.panStart) {
      const ps = state.ptr.panStart;
      if (!ps.moved && dist(p, ps.p) > 4) ps.moved = true;
      setView({
        s: state.view.s,
        tx: ps.tx + (p.x - ps.p.x),
        ty: ps.ty + (p.y - ps.p.y),
      });
    }
  }

  function onStageUp(e) {
    if (!state.ptr.map.has(e.pointerId)) return;
    const p = stageLocal(e);
    state.ptr.map.delete(e.pointerId);

    if (state.ptr.mode === "card" && state.ptr.card) {
      const c = state.ptr.card;
      const moved = c.moved;
      const idx = c.idx;
      const cx = c.x;
      const cy = c.y;
      c.el.classList.remove("is-dragging");
      state.ptr.card = null;
      state.ptr.mode = null;
      if (moved) {
        if (onDragState) onDragState(idx, false);
        if (onMoveCard) onMoveCard(idx, cx, cy);
      }
      return;
    }

    if (state.ptr.mode === "pan" && state.ptr.panStart && !state.ptr.panStart.moved) {
      if (!e.target.closest(".bd-card")) selectCard(null);
      const now = Date.now();
      if (state.ptr.lastTap && now - state.ptr.lastTap.t < 320 && dist(p, state.ptr.lastTap.p) < 32) {
        const w = screenToWorld(p.x, p.y);
        const s = clamp(state.view.s * 2, state.minScale, MAX_SCALE);
        animateTo({ s, tx: p.x - w.x * s, ty: p.y - w.y * s }, 220);
        state.ptr.lastTap = null;
      } else {
        state.ptr.lastTap = { t: now, p };
      }
    }

    if (state.ptr.map.size === 0) state.ptr.mode = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const p = stageLocal(e);
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const s1 = clamp(state.view.s * factor, state.minScale, MAX_SCALE);
    const wx = (p.x - state.view.tx) / state.view.s;
    const wy = (p.y - state.view.ty) / state.view.s;
    setView({ s: s1, tx: p.x - wx * s1, ty: p.y - wy * s1 });
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.destroyed || !state.geo) return;
      updateScaleLimits();
      setView(state.view);
    }, 120);
  }

  stageEl.addEventListener("pointerdown", onStageDown);
  window.addEventListener("pointermove", onStageMove);
  window.addEventListener("pointerup", onStageUp);
  window.addEventListener("pointercancel", onStageUp);
  stageEl.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", onResize);

  async function initBoard(board, sizeSpec) {
    state.boardInfo = await loadBoardPdf(board);
    state.geo = computeBoardGeometry(state.boardInfo, sizeSpec);
    baseCanvasEl.dataset.mmWidth = String(state.geo.W);
    baseCanvasEl.dataset.mmHeight = String(state.geo.H);
    updateScaleLimits();
    state.view = clampView(fitView());
    applyView();

    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    const maxPixels = coarse ? 4e6 : 12e6;
    const r = Math.min(Math.sqrt(maxPixels / (state.geo.W * state.geo.H)), 8);
    const canvas = state.baseOffscreen || document.createElement("canvas");
    state.baseOffscreen = canvas;
    canvas.width = Math.max(1, Math.round(state.geo.W * r));
    canvas.height = Math.max(1, Math.round(state.geo.H * r));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const viewport = state.boardInfo.page.getViewport({ scale: r * state.geo.pdf.ptToMm });
    await state.boardInfo.page.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, state.geo.pdf.x * r, state.geo.pdf.y * r],
    }).promise;
    state.baseRes = r;
    buildInkMap();
    drawViewportBoard();
  }

  function destroy() {
    state.destroyed = true;
    clearTimeout(state.detail.timer);
    clearTimeout(resizeTimer);
    state.detail.token++;
    state.animToken++;
    stageEl.removeEventListener("pointerdown", onStageDown);
    window.removeEventListener("pointermove", onStageMove);
    window.removeEventListener("pointerup", onStageUp);
    window.removeEventListener("pointercancel", onStageUp);
    stageEl.removeEventListener("wheel", onWheel);
    window.removeEventListener("resize", onResize);
    if (state.baseOffscreen) {
      state.baseOffscreen.width = 0;
      state.baseOffscreen.height = 0;
      state.baseOffscreen = null;
    }
    if (state.detailOffscreen) {
      state.detailOffscreen.width = 0;
      state.detailOffscreen.height = 0;
      state.detailOffscreen = null;
    }
  }

  return {
    state,
    initBoard,
    syncCards,
    selectCard,
    fitView,
    screenToWorld,
    findEmptySpot,
    zoomToCards,
    zoomIn: () => {
      const { w, h } = stageSize();
      const s = clamp(state.view.s * 1.8, state.minScale, MAX_SCALE);
      const wx = (w / 2 - state.view.tx) / state.view.s;
      const wy = (h / 2 - state.view.ty) / state.view.s;
      animateTo({ s, tx: w / 2 - wx * s, ty: h / 2 - wy * s }, 220);
    },
    zoomOut: () => {
      const { w, h } = stageSize();
      const s = clamp(state.view.s / 1.8, state.minScale, MAX_SCALE);
      const wx = (w / 2 - state.view.tx) / state.view.s;
      const wy = (h / 2 - state.view.ty) / state.view.s;
      animateTo({ s, tx: w / 2 - wx * s, ty: h / 2 - wy * s }, 220);
    },
    zoomFit: () => animateTo(fitView(), 280),
    viewCenterWorld: () => {
      const { w, h } = stageSize();
      return screenToWorld(w / 2, h / 2);
    },
    destroy,
  };
}

/**
 * 現在の配置状態をPDFとして生成・ダウンロードする.
 */
export async function exportBoardToPdf({
  boardInfo,
  geo,
  baseOffscreen,
  imageCache,
  deckTitle,
  boardName,
  groupName,
  cards,
  placed,
  onProgress = null,
}) {
  const PDFLib = window.PDFLib;
  if (!PDFLib) throw new Error("PDF出力ライブラリが読み込まれていません。");
  const { PDFDocument, PDFName, PDFNumber, rgb } = PDFLib;
  const capH = 14;
  const rawW = geo.W * PT_PER_MM;
  const rawH = (geo.H + capH) * PT_PER_MM;
  const userUnit = calcPdfUserUnit(rawW, rawH);
  const K = PT_PER_MM / userUnit;
  const pageW = geo.W * K;
  const pageH = (geo.H + capH) * K;
  const box = (x, yTop, w, h) => ({ x: x * K, y: (geo.H + capH - (yTop + h)) * K, width: w * K, height: h * K });

  if (onProgress) onProgress("台紙を埋め込んでいます…");
  const doc = await PDFDocument.create();
  const page = doc.addPage([pageW, pageH]);
  if (userUnit > 1 && PDFName && PDFNumber) {
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(userUnit));
  }
  page.drawRectangle({ ...box(0, 0, geo.W, geo.H), color: rgb(1, 1, 1) });

  try {
    const [embedded] = await doc.embedPdf(boardInfo.bytes, [0]);
    page.drawPage(embedded, box(geo.pdf.x, geo.pdf.y, geo.pdf.w, geo.pdf.h));
  } catch {
    if (baseOffscreen) {
      const jpg = await doc.embedJpg(await canvasToJpegBytes(baseOffscreen, 0.88));
      page.drawImage(jpg, box(0, 0, geo.W, geo.H));
    }
  }
  page.drawRectangle({ ...box(0, 0, geo.W, geo.H), borderColor: rgb(0.6, 0.6, 0.6), borderWidth: Math.max(0.2, 0.8 / userUnit) });

  const entries = Object.entries(placed || {})
    .map(([k, p]) => ({ idx: Number(k), ...p }))
    .sort((a, b) => (a.z || 0) - (b.z || 0));

  let done = 0;
  for (const p of entries) {
    done++;
    if (onProgress) onProgress(`カードを埋め込んでいます… (${done}/${entries.length})`);
    const media = await imageCache.ensure(p.idx, cards[p.idx]);
    const img = await doc.embedJpg(media.jpgBytes);
    const b = box(p.x - CARD_W / 2, p.y - CARD_H / 2, CARD_W, CARD_H);
    page.drawImage(img, b);
    page.drawRectangle({ ...b, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: Math.max(0.15, 0.6 / userUnit) });
  }

  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const caption = `こだいらSVCs HUG訓練　${groupName ? `グループ：${groupName}　` : ""}デッキ：${deckTitle}　台紙：${boardName}（${geo.size.label} ${geo.W}×${geo.H}mm）　配置 ${entries.length}/${cards.length}枚　出力 ${stamp}`;
  const c = document.createElement("canvas");
  c.width = 2400;
  c.height = 68;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1e293b";
  ctx.font = "600 32px 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(caption, 12, 34);
  const capBlob = await new Promise((r) => c.toBlob(r, "image/png"));
  const capImg = await doc.embedPng(new Uint8Array(await capBlob.arrayBuffer()));
  c.width = 0;
  c.height = 0;
  const capDrawH = capH * 0.5 * K;
  const capDrawW = Math.min((2400 / 68) * capDrawH, pageW - 16 * K);
  page.drawImage(capImg, { x: 8 * K, y: capH * 0.25 * K, width: capDrawW, height: (capDrawW / 2400) * 68 });

  const outBytes = await doc.save();
  const blob = new Blob([outBytes], { type: "application/pdf" });
  const safeName = `${groupName || deckTitle || "hug"}_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`.replace(/[\\/:*?"<>|]/g, "_");
  await deliverPdfBlob(blob, `${safeName}.pdf`, {
    subtitle: `${entries.length}/${cards.length}枚配置`,
  });
}
