/**
 * 進行度の矛盾解決パネル・ダイアログ (UI-17, UI-18).
 */
import { escapeHtml } from "../util.js";

/**
 * 矛盾パネルを描画する.
 * @param {HTMLElement} container
 * @param {Array<Record<string, any>>} conflicts
 * @param {Record<string, string>} resolutions
 * @param {{
 *   onResolveSingle: (culpritId: string, action: "keep" | "move") => void,
 *   onResolveAllPhaseFirst: () => void,
 *   onResetResolutions: () => void
 * }} callbacks
 */
export function renderConflictPanel(
  container,
  conflicts,
  resolutions,
  callbacks
) {
  const list = conflicts || [];
  const unackCount = list.filter((c) => !c.acknowledged).length;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="conflict-panel conflict-panel-clean" data-testid="conflict-panel">
        <div class="conflict-header">
          <span class="badge badge-match" data-testid="conflict-count-badge">進行度の矛盾 0件</span>
          <span>すべてのカードが災害進行度の順序に沿って並んでいます。</span>
          ${
            Object.keys(resolutions || {}).length > 0
              ? `<button type="button" class="btn btn-xs" id="conflict-reset-btn" data-testid="conflict-reset-btn">調整をリセット</button>`
              : ""
          }
        </div>
      </div>
    `;
    const resetBtn = container.querySelector("#conflict-reset-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => callbacks.onResetResolutions());
    }
    return;
  }

  container.innerHTML = `
    <div class="conflict-panel conflict-panel-warn" role="dialog" aria-label="進行度の矛盾" data-testid="conflict-panel">
      <div class="conflict-header">
        <div>
          <span class="badge badge-exclude" data-testid="conflict-count-badge">進行度の矛盾 ${list.length}件</span>
          <span class="conflict-sub">（未確認: ${unackCount}件）提示時期を優先したため、後ろにあるカードより進行度が先のカードがあります。</span>
        </div>
        <div class="conflict-header-actions">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            id="resolve-all-phase-first-btn"
            data-testid="resolve-all-phase-first-btn"
          >
            すべて進行度を優先
          </button>
          ${
            Object.keys(resolutions || {}).length > 0
              ? `<button type="button" class="btn btn-xs" id="conflict-reset-btn" data-testid="conflict-reset-btn">調整をリセット</button>`
              : ""
          }
        </div>
      </div>
      <div class="conflict-list">
        ${list
          .map((c) => {
            const curAction = (resolutions && resolutions[c.culprit_id]) || "";
            const affectedStr = (c.affected_ids || []).join(", ");
            return `
              <div class="conflict-item ${c.acknowledged ? "conflict-item-ack" : ""}" data-testid="conflict-item-${escapeHtml(c.culprit_id)}">
                <div class="conflict-info">
                  <strong>原因カード: ${escapeHtml(c.culprit_id)}</strong>
                  <span class="badge badge-timing">時期: ${escapeHtml(c.culprit_timing)}</span>
                  <span class="badge badge-phase">進行度: ${escapeHtml(c.culprit_phase)}</span>
                  <span class="conflict-affected">影響を受ける後続カード (${(c.affected_ids || []).length}件): ${escapeHtml(affectedStr)}</span>
                </div>
                <div class="conflict-actions">
                  <button
                    type="button"
                    class="btn btn-xs ${curAction === "keep" ? "btn-primary" : ""}"
                    data-culprit="${escapeHtml(c.culprit_id)}"
                    data-action="keep"
                    data-testid="conflict-keep-${escapeHtml(c.culprit_id)}"
                  >このままにする</button>
                  <button
                    type="button"
                    class="btn btn-xs ${curAction === "move" ? "btn-primary" : ""}"
                    data-culprit="${escapeHtml(c.culprit_id)}"
                    data-action="move"
                    data-testid="conflict-move-${escapeHtml(c.culprit_id)}"
                  >進行度に合わせて移動</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;

  container
    .querySelector("#resolve-all-phase-first-btn")
    .addEventListener("click", () => {
      callbacks.onResolveAllPhaseFirst();
    });

  const resetBtn = container.querySelector("#conflict-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => callbacks.onResetResolutions());
  }

  container.querySelectorAll("[data-culprit][data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      callbacks.onResolveSingle(btn.dataset.culprit, btn.dataset.action);
    });
  });
}
