/**
 * 保存済みデッキの簡易訓練ページURL表示・コピー・QRコードPNGダウンロードコンポーネント.
 */
import { escapeHtml } from "../util.js";
import { downloadQrPng, renderQrToCanvas } from "../qrCode.js";
import { showToast } from "./toast.js";

export const GITHUB_PAGES_BASE_URL = "https://takahashikatsunori.github.io/k-hug2026/";

/**
 * GitHub Pages 上の簡易訓練ページURLを構築する.
 * @param {string} deckName
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function buildSimpleTrainingUrl(deckName, baseUrl = GITHUB_PAGES_BASE_URL) {
  const url = new URL("training-simple.html", baseUrl);
  url.search = "";
  url.hash = "";
  if (deckName) {
    url.searchParams.set("deck", deckName);
  }
  return url.toString();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // フォールバックへ
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/**
 * 指定コンテナに訓練URLコピー＋QRコードプレビュー＆PNGダウンロードパネルを描画する.
 * @param {HTMLElement} container
 * @param {{ deckName: string, showClose?: boolean, onClose?: () => void }} options
 */
export function renderDeckSharePanel(container, { deckName, showClose = false, onClose } = {}) {
  const initialUrl = buildSimpleTrainingUrl(deckName);

  container.innerHTML = `
    <div class="deck-share-panel" data-testid="deck-share-panel">
      <div class="deck-share-panel-head">
        <div class="deck-share-panel-title">
          <strong>🔗 簡易訓練ページ共有リンク & QRコード</strong>
          <span class="badge">${escapeHtml(deckName || "")}</span>
        </div>
        ${
          showClose
            ? `<button type="button" class="btn btn-sm deck-share-close-btn" data-testid="deck-share-close-btn" aria-label="閉じる">✕</button>`
            : ""
        }
      </div>
      <div class="deck-share-panel-body">
        <div class="deck-share-qr-col">
          <canvas
            class="deck-share-qr-canvas"
            data-testid="deck-share-qr-canvas"
            width="220"
            height="220"
          ></canvas>
          <span class="text-muted" style="font-size:0.75rem;">スマホカメラで読取可能</span>
        </div>
        <div class="deck-share-info-col">
          <label class="deck-share-label" for="deck-share-url-input-${escapeHtml(deckName)}">
            簡易訓練ページ（GitHub Pages）のURL（アクセスすると「${escapeHtml(deckName)}」を自動読込します）
          </label>
          <div class="deck-share-url-row">
            <input
              type="text"
              class="form-input deck-share-url-input"
              id="deck-share-url-input-${escapeHtml(deckName)}"
              data-testid="deck-share-url-input"
              value="${escapeHtml(initialUrl)}"
            />
            <button
              type="button"
              class="btn btn-sm btn-primary deck-share-copy-btn"
              data-testid="copy-deck-url-btn"
            >
              📋 URLをコピー
            </button>
          </div>
          <p class="deck-share-hint">
            ※ GitHub Pages 上の簡易訓練ページを開くURL・QRコードです（DBで新規作成・更新したデッキを反映するにはGitHubへプッシュしてください）。URL欄を編集するとQRコードも即時更新されます。
          </p>
          <div class="deck-share-action-row">
            <button
              type="button"
              class="btn btn-sm btn-secondary deck-share-download-btn"
              data-testid="download-deck-qr-btn"
            >
              🖼️ QRコード画像(PNG)をダウンロード
            </button>
            <a
              class="btn btn-sm btn-primary deck-share-open-link"
              data-testid="open-simple-training-link"
              href="${escapeHtml(initialUrl)}"
              target="_blank"
              rel="noopener"
            >
              🚀 簡易訓練ページを開く
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  const urlInput = container.querySelector('[data-testid="deck-share-url-input"]');
  const canvas = container.querySelector('[data-testid="deck-share-qr-canvas"]');
  const copyBtn = container.querySelector('[data-testid="copy-deck-url-btn"]');
  const dlBtn = container.querySelector('[data-testid="download-deck-qr-btn"]');
  const openLink = container.querySelector('[data-testid="open-simple-training-link"]');
  const closeBtn = container.querySelector('[data-testid="deck-share-close-btn"]');

  const redrawQr = () => {
    const curUrl = (urlInput?.value || "").trim() || initialUrl;
    if (openLink) openLink.href = curUrl;
    if (canvas) {
      try {
        renderQrToCanvas(canvas, curUrl, { targetSize: 220, quietModules: 4 });
      } catch (err) {
        console.error("QRコードの生成に失敗しました", err);
      }
    }
  };

  redrawQr();

  if (urlInput) {
    urlInput.addEventListener("input", redrawQr);
  }
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const curUrl = (urlInput?.value || "").trim() || initialUrl;
      const ok = await copyTextToClipboard(curUrl);
      if (ok) {
        showToast("訓練ページのURLをコピーしました", "success");
      } else {
        urlInput?.select();
        showToast("URLを選択しました（Ctrl+Cでコピーしてください）", "info");
      }
    });
  }
  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      const curUrl = (urlInput?.value || "").trim() || initialUrl;
      try {
        const filename = downloadQrPng(curUrl, deckName);
        showToast(`QRコード画像 (${filename}) をダウンロードしました`, "success");
      } catch (err) {
        showToast(err.message || "QRコードの生成に失敗しました", "error");
      }
    });
  }
  if (closeBtn && onClose) {
    closeBtn.addEventListener("click", onClose);
  }
}

let shareEscHandler = null;

/**
 * アクティブな共有モーダルを閉じる.
 */
export function closeDeckShareModal() {
  const overlay = document.getElementById("deck-share-modal-overlay");
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
  if (shareEscHandler) {
    document.removeEventListener("keydown", shareEscHandler);
    shareEscHandler = null;
  }
}

/**
 * 保存済みデッキのURLコピー・QRコードダウンロード用モーダルを開く.
 * @param {{ deckName: string }} params
 */
export function openDeckShareModal({ deckName }) {
  closeDeckShareModal();

  const overlay = document.createElement("div");
  overlay.id = "deck-share-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.setAttribute("data-testid", "deck-share-modal");

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog modal-lg";
  dialog.innerHTML = `
    <div class="modal-header">
      <h3>🔗 簡易訓練ページ共有 (${escapeHtml(deckName || "")})</h3>
      <button type="button" class="btn btn-sm" id="deck-share-modal-close-x" aria-label="閉じる">✕</button>
    </div>
    <div class="modal-body" id="deck-share-modal-body"></div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const body = dialog.querySelector("#deck-share-modal-body");
  renderDeckSharePanel(body, { deckName, showClose: false });

  dialog.querySelector("#deck-share-modal-close-x")?.addEventListener("click", closeDeckShareModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDeckShareModal();
  });
  shareEscHandler = (e) => {
    if (e.key === "Escape") closeDeckShareModal();
  };
  document.addEventListener("keydown", shareEscHandler);
}
