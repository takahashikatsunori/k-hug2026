/**
 * 保存済み検索・保存済みデッキ条件一覧ビュー (UI-13, UI-20).
 */
import { escapeHtml, formatDateTime } from "../util.js";
import { api } from "../api.js";
import { store } from "../store.js";
import { showToast } from "../components/toast.js";

/**
 * 保存済みビューを描画する.
 * @param {HTMLElement} container
 * @param {{
 *   onSwitchTab: (tab: string) => Promise<void>
 * }} callbacks
 */
export async function renderSavedView(container, callbacks) {
  container.innerHTML = `
    <div class="saved-layout" data-testid="saved-view">
      <section class="saved-section">
        <h3>保存済み検索</h3>
        <div id="saved-searches-list" class="saved-list" data-testid="saved-searches-list">読み込み中...</div>
      </section>

      <section class="saved-section">
        <h3>保存済みデッキ条件</h3>
        <div id="saved-decks-list" class="saved-list" data-testid="saved-decks-list">読み込み中...</div>
      </section>
    </div>
  `;

  const searchesBox = container.querySelector("#saved-searches-list");
  const decksBox = container.querySelector("#saved-decks-list");

  async function loadLists() {
    const [searches, decks] = await Promise.all([
      api.listSavedSearches(),
      api.listSavedDecks(),
    ]);

    if (!searches || searches.length === 0) {
      searchesBox.innerHTML = `<p class="text-muted">保存された検索結果はありません。</p>`;
    } else {
      searchesBox.innerHTML = searches
        .map(
          (s) => `
          <div class="saved-card" data-testid="saved-search-item-${s.id}">
            <div class="saved-card-info">
              <strong class="saved-title">${escapeHtml(s.name)}</strong>
              <span class="text-muted">${escapeHtml(formatDateTime(s.created_at))}</span>
              <span class="badge">条件: ${escapeHtml(s.filters?.keyword || "キーワードなし")} / 種別: ${escapeHtml(s.filters?.view || "all")}</span>
            </div>
            <div class="saved-card-actions">
              <button
                type="button"
                class="btn btn-sm btn-primary open-saved-search-btn"
                data-id="${s.id}"
                data-testid="open-saved-search-${s.id}"
              >再表示する</button>
              <button
                type="button"
                class="btn btn-sm btn-danger delete-saved-search-btn"
                data-id="${s.id}"
                data-testid="delete-saved-search-${s.id}"
              >削除</button>
            </div>
          </div>
        `
        )
        .join("");

      searchesBox.querySelectorAll(".open-saved-search-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.id);
          try {
            const detail = await api.getSavedSearch(id);
            const flt = detail.filters || {};
            store.searchQuery = {
              view: flt.view || "all",
              keyword: flt.keyword || "",
              fields: flt.fields || [],
              training: flt.training || null,
              sort: flt.sort || "deck",
            };
            showToast(`保存済み検索「${detail.name}」を読み込みました`, "info");
            await callbacks.onSwitchTab("list");
          } catch (err) {
            showToast(err.detail || "保存済み検索の取得に失敗しました", "error");
          }
        });
      });

      searchesBox.querySelectorAll(".delete-saved-search-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.id);
          await api.deleteSavedSearch(id);
          showToast("保存済み検索を削除しました", "info");
          await loadLists();
        });
      });
    }

    if (!decks || decks.length === 0) {
      decksBox.innerHTML = `<p class="text-muted">保存されたデッキ条件はありません。</p>`;
    } else {
      decksBox.innerHTML = decks
        .map(
          (d) => `
          <div class="saved-card" data-testid="saved-deck-item-${d.id}">
            <div class="saved-card-info">
              <strong class="saved-title">${escapeHtml(d.name)}</strong>
              <span class="text-muted">${escapeHtml(formatDateTime(d.updated_at))}</span>
              <span class="badge">災害: ${escapeHtml(d.conditions?.disaster_type || "未指定")} / 避難所: ${escapeHtml(d.conditions?.shelter || "未指定")}</span>
            </div>
            <div class="saved-card-actions">
              <button
                type="button"
                class="btn btn-sm btn-primary open-saved-deck-btn"
                data-id="${d.id}"
                data-testid="open-saved-deck-${d.id}"
              >デッキを開く</button>
              <button
                type="button"
                class="btn btn-sm btn-danger delete-saved-deck-btn"
                data-id="${d.id}"
                data-testid="delete-saved-deck-${d.id}"
              >削除</button>
            </div>
          </div>
        `
        )
        .join("");

      decksBox.querySelectorAll(".open-saved-deck-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.id);
          try {
            const detail = await api.getSavedDeck(id);
            const cond = detail.conditions || {};
            store.deckConditions = {
              disaster_type: cond.disaster_type || "",
              shelter: cond.shelter || "",
              date: cond.date || "",
              holiday_type: cond.holiday_type || [],
              time_slot: cond.time_slot || "",
              infrastructure: cond.infrastructure || [],
              weather: cond.weather || [],
              disaster_phase: cond.disaster_phase || [],
              max_events: cond.max_events ?? "",
              max_households: cond.max_households ?? "",
              excluded_ids: Array.isArray(cond.excluded_ids)
                ? [...cond.excluded_ids]
                : [],
            };
            store.deckPhaseFirst = false;

            if (detail.changed) {
              store.deckResolutions = {};
              store.deckManualOrder = null;
              store.loadedSavedDeckNotice = detail;
            } else {
              store.deckResolutions = detail.resolutions || {};
              store.deckManualOrder =
                detail.manual_order && detail.manual_order.length > 0
                  ? detail.manual_order
                  : null;
              store.loadedSavedDeckNotice = null;
            }

            await callbacks.onSwitchTab("deck");
          } catch (err) {
            showToast(err.detail || "保存済みデッキの取得に失敗しました", "error");
          }
        });
      });

      decksBox.querySelectorAll(".delete-saved-deck-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.id);
          await api.deleteSavedDeck(id);
          showToast("保存済みデッキ条件を削除しました", "info");
          await loadLists();
        });
      });
    }
  }

  await loadLists();
}
