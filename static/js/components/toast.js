/**
 * トースト通知コンポーネント.
 */
import { escapeHtml } from "../util.js";

/**
 * 画面右下にトースト通知を表示する.
 * @param {string} message
 * @param {"info" | "success" | "warning" | "error"} [type="info"]
 * @param {number} [durationMs=4000]
 */
export function showToast(message, type = "info", durationMs = 4000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("data-testid", `toast-${type}`);
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="toast-message">${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, durationMs);
}
