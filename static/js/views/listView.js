/**
 * カード一覧ビュー (UI-01..06, UI-10, UI-12, UI-13, UI-14).
 */
import { escapeHtml, triggerBlobDownload } from "../util.js";
import { api, ApiError } from "../api.js";
import { store } from "../store.js";
import { renderFilterPanel } from "../components/filterPanel.js";
import {
  renderEventCard,
  renderHouseholdCard,
  renderMemberCard,
} from "../components/card.js";
import { openDetailModal, openConfirmModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";

/**
 * カード一覧ビューを描画・初期化する.
 * @param {HTMLElement} container
 * @param {{
 *   onNavigateEditor: (mode: "event" | "household", id: string | null) => void,
 *   onDataChanged: () => Promise<void>
 * }} callbacks
 */
export async function renderListView(container, callbacks) {
  container.innerHTML = `
    <div class="list-layout">
      <aside id="list-filter-sidebar" class="list-sidebar"></aside>
      <section class="list-main">
        <div class="list-toolbar">
          <div class="counts-bar" data-testid="counts-bar">
            <span class="count-badge">単位合計: <strong id="cnt-units" data-testid="count-units">0</strong></span>
            <span class="count-badge pill-event-soft">イベント: <strong id="cnt-events" data-testid="count-events">0</strong></span>
            <span class="count-badge pill-household-soft">世帯: <strong id="cnt-households" data-testid="count-households">0</strong></span>
            <span class="count-badge pill-person-soft">人物: <strong id="cnt-persons" data-testid="count-persons">0</strong></span>
            <span class="count-badge pill-pet-soft">ペット: <strong id="cnt-pets" data-testid="count-pets">0</strong></span>
          </div>
          <div class="toolbar-actions">
            <div class="save-search-group">
              <input
                type="text"
                id="save-search-name-input"
                class="form-input form-input-sm"
                data-testid="save-search-name-input"
                placeholder="検索保存名 (任意)"
              />
              <button type="button" class="btn btn-sm btn-secondary" id="save-search-btn" data-testid="save-search-btn">
                検索結果を保存
              </button>
            </div>
            <button type="button" class="btn btn-sm" id="export-search-json-btn" data-testid="export-search-json-btn">
              JSON出力
            </button>
            <button type="button" class="btn btn-sm" id="export-search-cardcsv-btn" data-testid="export-search-cardcsv-btn">
              CSV出力
            </button>
            <button type="button" class="btn btn-sm" id="export-search-fullcsv-btn" data-testid="export-search-fullcsv-btn">
              全項目CSV(ZIP)
            </button>
          </div>
        </div>
        <div id="list-empty-banner" class="empty-banner" style="display:none;">
          <p>現在データベースにカードが登録されていません。</p>
          <button type="button" class="btn btn-primary" id="load-demo-btn" data-testid="load-demo-btn">
            デモデータを読み込む
          </button>
        </div>
        <div id="card-grid" class="card-grid" data-testid="card-grid"></div>
      </section>
    </div>
  `;

  const sidebar = container.querySelector("#list-filter-sidebar");
  const grid = container.querySelector("#card-grid");
  const emptyBanner = container.querySelector("#list-empty-banner");

  const handleEdit = (kind, id) => {
    callbacks.onNavigateEditor(kind === "event" ? "event" : "household", id);
  };

  const handleDelete = async (kind, id) => {
    try {
      if (kind === "event") {
        try {
          await api.deleteEvent(id, false);
          showToast(`イベント ${id} を削除しました`, "success");
          await callbacks.onDataChanged();
          await runSearch();
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            const deps = err.dependents || [];
            openConfirmModal({
              title: "前提カードになっているイベントの削除確認",
              message: `${id} は以下のカードの前提カードとして設定されています。削除すると、これらのカードの前提設定が解除（null）されます。本当に削除しますか？`,
              detailsHtml: `<p>依存しているカード: <strong>${escapeHtml(deps.join(", "))}</strong></p>`,
              confirmLabel: "強制削除する",
              danger: true,
              onConfirm: async () => {
                await api.deleteEvent(id, true);
                showToast(`イベント ${id} を削除しました`, "success");
                await callbacks.onDataChanged();
                await runSearch();
              },
            });
          } else {
            throw err;
          }
        }
      } else if (kind === "household") {
        await api.deleteHousehold(id);
        showToast(`世帯 ${id} を削除しました`, "success");
        await callbacks.onDataChanged();
        await runSearch();
      } else if (kind === "member") {
        await api.deleteMember(id);
        showToast(`構成員 ${id} を削除しました`, "success");
        await callbacks.onDataChanged();
        await runSearch();
      }
    } catch (err) {
      showToast(err.detail || err.message || "削除に失敗しました", "error");
    }
  };

  const openModalFor = (kind, id) => {
    openDetailModal({
      kind,
      id,
      onEdit: handleEdit,
      onDelete: handleDelete,
    });
  };

  let searchSeq = 0;

  async function runSearch() {
    const mySeq = ++searchSeq;
    try {
      const querySnapshot = JSON.parse(JSON.stringify(store.searchQuery));
      const res = await api.search(querySnapshot);
      if (mySeq !== searchSeq) return;
      store.lastSearchResult = res;
      const c = res.counts || {
        events: 0,
        households: 0,
        persons: 0,
        pets: 0,
        units: 0,
      };

      container.querySelector("#cnt-units").textContent = String(c.units ?? 0);
      container.querySelector("#cnt-events").textContent = String(c.events ?? 0);
      container.querySelector("#cnt-households").textContent = String(
        c.households ?? 0
      );
      container.querySelector("#cnt-persons").textContent = String(
        c.persons ?? 0
      );
      container.querySelector("#cnt-pets").textContent = String(c.pets ?? 0);

      const isFilterEmpty =
        !store.searchQuery.keyword &&
        (!store.searchQuery.fields || store.searchQuery.fields.length === 0) &&
        !store.searchQuery.training &&
        store.searchQuery.view === "all";

      if (isFilterEmpty) {
        store.totalCounts = { ...c };
        store.notify("counts");
      }

      if (isFilterEmpty && c.events === 0 && c.households === 0) {
        emptyBanner.style.display = "block";
      } else {
        emptyBanner.style.display = "none";
      }

      grid.innerHTML = "";
      const view = store.searchQuery.view || "all";

      const grpMap = {};
      for (const h of res.households || []) {
        if (h.group && h.group.group_id) {
          grpMap[h.group.group_id] = h;
        }
      }
      const fallbackGroupMap = res.group_map || {};
      const memberPositions = res.member_positions || {};

      if (view === "all") {
        if (
          store.searchQuery.sort === "deck" &&
          Array.isArray(res.ordered_units) &&
          res.ordered_units.length > 0
        ) {
          for (const u of res.ordered_units) {
            if (u.kind === "event" && u.event) {
              grid.appendChild(
                renderEventCard(u.event, {
                  onClick: (ev) => openModalFor("event", ev.card_id),
                })
              );
            } else if ((u.kind === "household" || u.kind === "group") && u.group) {
              grid.appendChild(
                renderHouseholdCard(u.group, u.members || [], {
                  onClick: (grp) => openModalFor("household", grp.group_id),
                })
              );
            }
          }
        } else {
          for (const ev of res.events || []) {
            grid.appendChild(
              renderEventCard(ev, {
                onClick: (e) => openModalFor("event", e.card_id),
              })
            );
          }
          for (const h of res.households || []) {
            grid.appendChild(
              renderHouseholdCard(h.group, h.members || [], {
                onClick: (grp) => openModalFor("household", grp.group_id),
              })
            );
          }
        }
      } else if (view === "event") {
        for (const ev of res.events || []) {
          grid.appendChild(
            renderEventCard(ev, {
              onClick: (e) => openModalFor("event", e.card_id),
            })
          );
        }
      } else if (view === "household") {
        for (const h of res.households || []) {
          grid.appendChild(
            renderHouseholdCard(h.group, h.members || [], {
              onClick: (grp) => openModalFor("household", grp.group_id),
            })
          );
        }
      } else if (view === "person") {
        for (const p of res.persons || []) {
          const hh = grpMap[p.group_id];
          const grp = (hh && hh.group) || fallbackGroupMap[p.group_id] || {};
          const pos = memberPositions[p.member_id] || {};
          grid.appendChild(
            renderMemberCard(p, grp, {
              groupIndex: pos.group_index,
              groupTotal: pos.group_total,
              onClick: (m) => openModalFor("member", m.member_id),
            })
          );
        }
      } else if (view === "pet") {
        for (const pt of res.pets || []) {
          const hh = grpMap[pt.group_id];
          const grp = (hh && hh.group) || fallbackGroupMap[pt.group_id] || {};
          const pos = memberPositions[pt.member_id] || {};
          grid.appendChild(
            renderMemberCard(pt, grp, {
              groupIndex: pos.group_index,
              groupTotal: pos.group_total,
              onClick: (m) => openModalFor("member", m.member_id),
            })
          );
        }
      }
    } catch (err) {
      showToast(err.detail || err.message || "検索に失敗しました", "error");
    }
  }

  renderFilterPanel(sidebar, store.schema, runSearch);

  // デモデータ読み込み (UI-01)
  container
    .querySelector("#load-demo-btn")
    .addEventListener("click", async () => {
      try {
        await api.importDemo("replace");
        showToast("デモデータを読み込みました", "success");
        await callbacks.onDataChanged();
        await runSearch();
      } catch (err) {
        showToast(err.detail || "デモデータの読み込みに失敗しました", "error");
      }
    });

  // 検索結果の保存 (UI-13)
  container
    .querySelector("#save-search-btn")
    .addEventListener("click", async () => {
      const nameInput = container.querySelector("#save-search-name-input");
      const rawName = nameInput.value.trim();
      const name =
        rawName ||
        `検索_${store.searchQuery.keyword || store.searchQuery.view || "全件"}`;
      try {
        await api.createSavedSearch({
          name,
          filters: store.searchQuery,
        });
        nameInput.value = "";
        showToast(`検索結果「${name}」を保存しました`, "success");
      } catch (err) {
        showToast(err.detail || "検索結果の保存に失敗しました", "error");
      }
    });

  // エクスポート (UI-14)
  container
    .querySelector("#export-search-json-btn")
    .addEventListener("click", async () => {
      try {
        const blob = await api.exportSearch("json", store.searchQuery);
        triggerBlobDownload(blob, "hug_search_export.json");
      } catch (err) {
        showToast(err.detail || "JSON出力に失敗しました", "error");
      }
    });

  container
    .querySelector("#export-search-cardcsv-btn")
    .addEventListener("click", async () => {
      try {
        const blob = await api.exportSearch("cardcsv", store.searchQuery);
        triggerBlobDownload(blob, "hug_search_cards.csv");
      } catch (err) {
        showToast(err.detail || "CSV出力に失敗しました", "error");
      }
    });

  container
    .querySelector("#export-search-fullcsv-btn")
    .addEventListener("click", async () => {
      try {
        const blob = await api.exportSearch("fullcsv", store.searchQuery);
        triggerBlobDownload(blob, "hug_search_full_csv.zip");
      } catch (err) {
        showToast(err.detail || "ZIP出力に失敗しました", "error");
      }
    });

  await runSearch();
}
