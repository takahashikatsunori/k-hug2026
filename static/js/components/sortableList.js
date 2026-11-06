/**
 * デッキ単位の並べ替え可能リストコンポーネント (↑ / ↓ ボタン + HTML5 Drag & Drop, UI-19).
 */
import { escapeHtml } from "../util.js";

/**
 * 単位一覧を描画し、↑↓ボタンまたはドラッグ＆ドロップで順番変更を通知する.
 * @param {HTMLElement} container
 * @param {Array<Record<string, any>>} units
 * @param {(newUnitIds: string[]) => Promise<void> | void} onReorder
 * @param {(unit: Record<string, any>) => void} [onSelectUnit]
 */
export function renderSortableUnitList(
  container,
  units,
  onReorder,
  onSelectUnit
) {
  container.innerHTML = "";
  const listEl = document.createElement("ul");
  listEl.className = "sortable-unit-list";
  listEl.setAttribute("data-testid", "deck-unit-list");

  const unitIds = (units || []).map((u) => u.id);
  let dragSourceIndex = null;

  (units || []).forEach((u, idx) => {
    const li = document.createElement("li");
    li.className = `sortable-unit-item unit-kind-${u.kind}`;
    li.draggable = true;
    li.dataset.unitId = u.id;
    li.dataset.index = String(idx);
    li.setAttribute("data-testid", `deck-unit-${u.id}`);

    const isEvent = u.kind === "event";
    const title = u.name || u.id;
    const prereq = u.prerequisite_card_id || null;

    li.innerHTML = `
      <div class="unit-left">
        <span class="unit-order-num" data-testid="unit-pos-${u.id}">#${idx + 1}</span>
        <span class="type-pill ${isEvent ? "pill-event" : "pill-household"}">${isEvent ? "イベント" : "世帯"}</span>
        <strong class="unit-id">${escapeHtml(u.id)}</strong>
        <span class="unit-title">${escapeHtml(title)}</span>
      </div>
      <div class="unit-right">
        <span class="badge badge-priority">${escapeHtml(isEvent ? `P:${u.priority ?? "-"}` : u.urgency_level || "-")}</span>
        <span class="badge badge-timing">${escapeHtml(u.timing || "-")}</span>
        <span class="badge badge-phase">${escapeHtml(u.phase || "-")}</span>
        ${prereq ? `<span class="badge badge-prereq">前提:${escapeHtml(prereq)}</span>` : ""}
        <button
          type="button"
          class="btn btn-xs unit-up-btn"
          data-testid="unit-up-${u.id}"
          ${idx === 0 ? "disabled" : ""}
          title="上へ移動"
        >↑</button>
        <button
          type="button"
          class="btn btn-xs unit-down-btn"
          data-testid="unit-down-${u.id}"
          ${idx === units.length - 1 ? "disabled" : ""}
          title="下へ移動"
        >↓</button>
      </div>
    `;

    const upBtn = li.querySelector(".unit-up-btn");
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (idx <= 0) return;
      const next = [...unitIds];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      onReorder(next);
    });

    const downBtn = li.querySelector(".unit-down-btn");
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (idx >= units.length - 1) return;
      const next = [...unitIds];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      onReorder(next);
    });

    li.addEventListener("click", () => {
      if (onSelectUnit) onSelectUnit(u);
    });

    // HTML5 Drag & Drop
    li.addEventListener("dragstart", (e) => {
      dragSourceIndex = idx;
      li.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", u.id);
      }
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      listEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      li.classList.add("drag-over");
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      let fromIdx = dragSourceIndex;
      if (fromIdx === null && e.dataTransfer) {
        const draggedId = e.dataTransfer.getData("text/plain");
        fromIdx = unitIds.indexOf(draggedId);
      }
      if (fromIdx === null || fromIdx < 0 || fromIdx === idx) return;
      const next = [...unitIds];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(idx, 0, moved);
      dragSourceIndex = null;
      onReorder(next);
    });

    listEl.appendChild(li);
  });

  container.appendChild(listEl);
}
