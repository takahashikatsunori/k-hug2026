/**
 * 3状態チップ (未指定 -> 合致 -> 排除 -> 未指定) および複数選択チップコンポーネント (JS-01).
 */
import { escapeHtml } from "../util.js";

/**
 * 3状態チップの次の状態を返す (JS-01).
 * @param {"none" | "match" | "exclude" | undefined | null | string} current
 * @returns {"none" | "match" | "exclude"}
 */
export function nextChipState(current) {
  if (!current || current === "none") {
    return "match";
  }
  if (current === "match") {
    return "exclude";
  }
  return "none";
}

/**
 * 3状態チップ群をコンテナに描画する.
 * @param {HTMLElement} container
 * @param {string[]} options
 * @param {Record<string, "match" | "exclude" | "none">} stateMap
 * @param {(option: string, newState: "none" | "match" | "exclude", updatedMap: Record<string, "match" | "exclude">) => void} onChange
 * @param {string} [dimKey=""]
 */
export function renderTriStateChips(
  container,
  options,
  stateMap,
  onChange,
  dimKey = ""
) {
  container.innerHTML = "";
  const map = { ...(stateMap || {}) };

  for (const opt of options || []) {
    const state = map[opt] || "none";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip chip-tristate chip-${state}`;
    btn.dataset.option = opt;
    btn.dataset.state = state;
    if (dimKey) {
      btn.dataset.dimension = dimKey;
      btn.setAttribute("data-testid", `trichip-${dimKey}-${opt}`);
    }
    const prefix =
      state === "match" ? "✓ 合致: " : state === "exclude" ? "✕ 排除: " : "";
    btn.innerHTML = `<span class="chip-prefix">${escapeHtml(prefix)}</span><span class="chip-label">${escapeHtml(opt)}</span>`;

    btn.addEventListener("click", () => {
      const cur = map[opt] || "none";
      const next = nextChipState(cur);
      if (next === "none") {
        delete map[opt];
      } else {
        map[opt] = next;
      }
      renderTriStateChips(container, options, map, onChange, dimKey);
      if (onChange) {
        onChange(opt, next, { ...map });
      }
    });

    container.appendChild(btn);
  }
}

/**
 * 複数選択（ON/OFF トグル）チップ群をコンテナに描画する.
 * @param {HTMLElement} container
 * @param {string[]} options
 * @param {string[]} selectedValues
 * @param {(newSelected: string[]) => void} onChange
 * @param {string} [groupKey=""]
 */
export function renderMultiSelectChips(
  container,
  options,
  selectedValues,
  onChange,
  groupKey = ""
) {
  container.innerHTML = "";
  const selectedSet = new Set(Array.isArray(selectedValues) ? selectedValues : []);

  for (const opt of options || []) {
    const isActive = selectedSet.has(opt);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip chip-multi ${isActive ? "chip-active" : ""}`;
    btn.dataset.option = opt;
    btn.dataset.active = isActive ? "true" : "false";
    if (groupKey) {
      btn.setAttribute("data-testid", `multichip-${groupKey}-${opt}`);
    }
    btn.textContent = opt;

    btn.addEventListener("click", () => {
      if (selectedSet.has(opt)) {
        selectedSet.delete(opt);
      } else {
        selectedSet.add(opt);
      }
      const nextArr = options.filter((o) => selectedSet.has(o));
      renderMultiSelectChips(container, options, nextArr, onChange, groupKey);
      if (onChange) {
        onChange(nextArr);
      }
    });

    container.appendChild(btn);
  }
}
