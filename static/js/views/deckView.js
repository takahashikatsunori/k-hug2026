/**
 * デッキ構築ビュー (UI-16, UI-17, UI-18, UI-19, UI-20, UI-21, UI-22).
 */
import { escapeHtml, triggerBlobDownload } from "../util.js";
import { api } from "../api.js";
import { store } from "../store.js";
import { renderMultiSelectChips } from "../components/chips.js";
import { renderSortableUnitList } from "../components/sortableList.js";
import { renderConflictPanel } from "./conflictPanel.js";
import { openTrainingView } from "./trainingView.js";
import { openDetailModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import {
  PRINT_SIZES,
  toCardRenderModel,
  renderCardPreviewElement,
  renderMasterListElement,
  printMasterLedger,
  exportCardsAsPdf,
  exportCardsAsZip,
} from "../cardCanvas.js";

/**
 * デッキ構築リクエスト用ペイロードを組み立てる.
 */
function buildDeckRequestPayload() {
  const dc = store.deckConditions;
  const conditions = {
    disaster_type: dc.disaster_type || null,
    shelter: dc.shelter || null,
    date: dc.date || null,
    holiday_type: Array.isArray(dc.holiday_type) ? dc.holiday_type : [],
    time_slot: dc.time_slot || null,
    infrastructure: Array.isArray(dc.infrastructure) ? dc.infrastructure : [],
    weather: Array.isArray(dc.weather) ? dc.weather : [],
    disaster_phase: Array.isArray(dc.disaster_phase) ? dc.disaster_phase : [],
    max_events:
      dc.max_events !== "" && dc.max_events !== null && dc.max_events !== undefined
        ? Number(dc.max_events)
        : null,
    max_households:
      dc.max_households !== "" &&
      dc.max_households !== null &&
      dc.max_households !== undefined
        ? Number(dc.max_households)
        : null,
    excluded_ids: Array.isArray(dc.excluded_ids) ? [...dc.excluded_ids] : [],
  };
  return {
    conditions,
    resolutions: store.deckResolutions || {},
    manual_order: store.deckManualOrder || null,
    phase_first: Boolean(store.deckPhaseFirst),
  };
}

/**
 * デッキ構築ビューを描画する.
 * @param {HTMLElement} container
 */
export async function renderDeckView(container) {
  const schema = store.schema;
  const opts = (schema && schema.options) || {};
  const dc = store.deckConditions;

  const makeSelectOptions = (list, currentVal) =>
    `<option value="">(指定なし)</option>` +
    (list || [])
      .map(
        (o) =>
          `<option value="${escapeHtml(o)}" ${currentVal === o ? "selected" : ""}>${escapeHtml(o)}</option>`
      )
      .join("");

  container.innerHTML = `
    <div class="deck-layout" data-testid="deck-view">
      <aside class="deck-sidebar">
        <h3>デッキ訓練条件</h3>

        <div class="form-group">
          <label class="form-label" for="deck-disaster-select">想定災害 (disaster_type)</label>
          <select id="deck-disaster-select" class="form-select" data-testid="deck-disaster-select">
            ${makeSelectOptions(opts.disaster_types, dc.disaster_type)}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="deck-shelter-select">避難所 (shelter)</label>
          <select id="deck-shelter-select" class="form-select" data-testid="deck-shelter-select">
            ${makeSelectOptions(opts.shelters, dc.shelter)}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="deck-date-input">訓練想定日 (date, 休日自動判定)</label>
          <input
            type="date"
            id="deck-date-input"
            class="form-input"
            data-testid="deck-date-input"
            value="${escapeHtml(dc.date || "")}"
          />
        </div>

        <div class="form-group">
          <label class="form-label">休日種別（自動入力・手動で上書き可）</label>
          <div id="deck-holiday-chips" class="chips-wrap" data-testid="deck-holiday-chips"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="deck-timeslot-select">時間帯 (time_slot)</label>
          <select id="deck-timeslot-select" class="form-select" data-testid="deck-timeslot-select">
            ${makeSelectOptions(opts.time_slots, dc.time_slot)}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">インフラ状況 (infrastructure)</label>
          <div id="deck-infra-chips" class="chips-wrap"></div>
        </div>

        <div class="form-group">
          <label class="form-label">天候 (weather)</label>
          <div id="deck-weather-chips" class="chips-wrap"></div>
        </div>

        <div class="form-group">
          <label class="form-label">対象進行度 (disaster_phase)</label>
          <div id="deck-phase-chips" class="chips-wrap"></div>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="deck-max-events">イベント上限数</label>
            <input type="number" min="0" id="deck-max-events" class="form-input" data-testid="deck-max-events" value="${escapeHtml(dc.max_events)}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="deck-max-households">世帯上限数</label>
            <input type="number" min="0" id="deck-max-households" class="form-input" data-testid="deck-max-households" value="${escapeHtml(dc.max_households)}" />
          </div>
        </div>

        <button type="button" class="btn btn-primary btn-block" id="build-deck-btn" data-testid="build-deck-btn">
          デッキを構築・再計算
        </button>
      </aside>

      <section class="deck-main">
        <div id="deck-changed-banner-wrap"></div>

        <div class="deck-toolbar">
          <div class="counts-bar" id="deck-stats" data-testid="deck-stats">
            <span class="count-badge">総カード枚数: <strong id="deck-stat-total-cards" data-testid="deck-stat-total-cards">0枚</strong></span>
            <span class="count-badge">単位数: <strong id="deck-stat-total-units" data-testid="deck-stat-total-units">0</strong></span>
            <span class="count-badge pill-event-soft">イベント: <strong id="deck-stat-events" data-testid="deck-stat-events">0</strong></span>
            <span class="count-badge pill-household-soft">世帯: <strong id="deck-stat-households" data-testid="deck-stat-households">0</strong></span>
            <span class="count-badge pill-person-soft">人物: <strong id="deck-stat-persons" data-testid="deck-stat-persons">0</strong></span>
            <span class="count-badge pill-pet-soft">ペット: <strong id="deck-stat-pets" data-testid="deck-stat-pets">0</strong></span>
          </div>

          <div class="toolbar-actions">
            <button type="button" class="btn btn-primary btn-sm" id="open-training-view-btn" data-testid="open-training-view-btn">
              閲覧モードを開始
            </button>
            <button type="button" class="btn btn-sm" id="export-deck-json-btn" data-testid="export-deck-json-btn">
              JSONダウンロード
            </button>
            <button type="button" class="btn btn-sm" id="export-deck-csv-btn" data-testid="export-deck-csv-btn">
              CSVダウンロード
            </button>
            <div class="save-search-group">
              <input
                type="text"
                id="save-deck-name-input"
                class="form-input form-input-sm"
                data-testid="save-deck-name-input"
                placeholder="デッキ保存名 (任意)"
              />
              <button type="button" class="btn btn-sm btn-secondary" id="save-deck-btn" data-testid="save-deck-btn">
                デッキ条件を保存
              </button>
            </div>
          </div>
        </div>

        <div class="deck-toolbar deck-output-toolbar" data-testid="deck-output-toolbar">
          <div class="view-switcher">
            <button
              type="button"
              class="btn btn-sm ${(!store.deckViewSubMode || store.deckViewSubMode === "units") ? "btn-primary" : ""}"
              id="deck-submode-units"
              data-testid="deck-submode-units"
            >
              単位一覧（並べ替え）
            </button>
            <button
              type="button"
              class="btn btn-sm ${store.deckViewSubMode === "cards" ? "btn-primary" : ""}"
              id="deck-submode-cards"
              data-testid="deck-submode-cards"
            >
              完成カードプレビュー
            </button>
            <button
              type="button"
              class="btn btn-sm ${store.deckViewSubMode === "ledger" ? "btn-primary" : ""}"
              id="deck-submode-ledger"
              data-testid="deck-submode-ledger"
            >
              避難者台帳
            </button>
          </div>

          <div class="toolbar-actions">
            <span class="badge" data-testid="deck-fixed-card-spec">標準デザイン / 名刺サイズ (5.5×9.1cm)</span>
            <button type="button" class="btn btn-sm btn-primary" id="export-deck-pdf-btn" data-testid="export-deck-pdf-btn">
              カードPDF保存
            </button>
            <button type="button" class="btn btn-sm btn-secondary" id="export-deck-zip-btn" data-testid="export-deck-zip-btn">
              一括画像保存(ZIP)
            </button>
            <button type="button" class="btn btn-sm" id="print-deck-ledger-btn" data-testid="print-deck-ledger-btn">
              台帳を印刷
            </button>
            <span id="deck-export-progress-wrap" data-testid="deck-export-progress-wrap" style="display:none;align-items:center;gap:0.4rem;">
              <strong id="deck-export-progress-text" data-testid="deck-export-progress-text">0 / 0</strong>
              <button type="button" class="btn btn-xs btn-danger" id="cancel-deck-export-btn" data-testid="cancel-deck-export-btn">
                中断
              </button>
            </span>
          </div>
        </div>

        <div id="deck-conflict-container"></div>
        <div id="deck-reorder-error" class="validation-errors-box" data-testid="deck-reorder-error" style="display:none;"></div>

        <div class="deck-operation-guide" data-testid="deck-operation-guide">
          <span>💡 <strong>操作ヒント:</strong> ここでの「↑↓・ドラッグでの順番入れ替え」や「✕ デッキから除外」は、<strong>この訓練デッキの構成のみを変更します（データベース上の元カードは削除されません）</strong>。除外したカードは右側の「除外された単位」からいつでもデッキに戻せます。</span>
        </div>

        <div class="deck-lists-grid" id="deck-units-grid-wrap">
          <div class="deck-units-section">
            <h4>カード提出順（単位一覧: ↑↓・ドラッグで並べ替え ／ 「✕ デッキから除外」でデッキから外す）</h4>
            <div id="deck-units-container"></div>
          </div>
          <div class="deck-excluded-section">
            <div class="deck-excluded-header">
              <h4>除外された単位 (<span id="deck-excluded-count">0</span>件)</h4>
              <button
                type="button"
                class="btn btn-xs btn-secondary"
                id="restore-all-excluded-btn"
                data-testid="restore-all-excluded-btn"
                style="display:none;"
              >
                手動除外をすべて戻す
              </button>
            </div>
            <ul id="deck-excluded-list" class="excluded-list" data-testid="deck-excluded-list"></ul>
          </div>
        </div>

        <div id="deck-cards-preview-section" data-testid="deck-cards-preview-section" style="display:none;"></div>
        <div id="deck-ledger-section" data-testid="deck-ledger-section" style="display:none;"></div>
      </section>
    </div>
  `;

  const holidayChipsContainer = container.querySelector("#deck-holiday-chips");
  const conflictContainer = container.querySelector("#deck-conflict-container");
  const unitsContainer = container.querySelector("#deck-units-container");
  const excludedList = container.querySelector("#deck-excluded-list");
  const restoreAllExcludedBtn = container.querySelector("#restore-all-excluded-btn");
  const reorderErrorBox = container.querySelector("#deck-reorder-error");
  const changedBannerWrap = container.querySelector("#deck-changed-banner-wrap");

  const getExcludedIdsSet = () =>
    new Set(
      Array.isArray(store.deckConditions.excluded_ids)
        ? store.deckConditions.excluded_ids
        : []
    );

  const excludeUnitFromDeck = async (unitId, unitName = "") => {
    if (!unitId) return;
    const set = getExcludedIdsSet();
    set.add(unitId);
    store.deckConditions.excluded_ids = Array.from(set);
    if (Array.isArray(store.deckManualOrder)) {
      store.deckManualOrder = store.deckManualOrder.filter((id) => id !== unitId);
    }
    await runBuildDeck();
    const label = unitName ? `${unitId} (${unitName})` : unitId;
    showToast(
      `${label} をこのデッキから除外しました（DB上のカードは削除されません）`,
      "info"
    );
  };

  const restoreUnitToDeck = async (unitId, unitName = "") => {
    if (!unitId) return;
    const set = getExcludedIdsSet();
    set.delete(unitId);
    store.deckConditions.excluded_ids = Array.from(set);
    await runBuildDeck();
    const label = unitName ? `${unitId} (${unitName})` : unitId;
    showToast(`${label} をデッキに戻しました`, "success");
  };

  const restoreAllExcludedUnits = async () => {
    store.deckConditions.excluded_ids = [];
    await runBuildDeck();
    showToast("手動除外したカードをすべてデッキに戻しました", "success");
  };

  if (restoreAllExcludedBtn) {
    restoreAllExcludedBtn.addEventListener("click", () => {
      restoreAllExcludedUnits();
    });
  }

  const openDeckDetailModal = (kind, id) => {
    openDetailModal({
      kind,
      id,
      onExcludeFromDeck: excludeUnitFromDeck,
      onRestoreToDeck: restoreUnitToDeck,
      excludedIdsSet: getExcludedIdsSet(),
    });
  };

  const renderHolidayChips = () => {
    renderMultiSelectChips(
      holidayChipsContainer,
      opts.holiday_type || [],
      store.deckConditions.holiday_type || [],
      (vals) => {
        store.deckConditions.holiday_type = vals;
        runBuildDeck();
      },
      "deck-holiday_type"
    );
  };

  renderHolidayChips();

  renderMultiSelectChips(
    container.querySelector("#deck-infra-chips"),
    opts.infrastructure || [],
    dc.infrastructure || [],
    (vals) => {
      store.deckConditions.infrastructure = vals;
      runBuildDeck();
    },
    "deck-infrastructure"
  );

  renderMultiSelectChips(
    container.querySelector("#deck-weather-chips"),
    opts.weather || [],
    dc.weather || [],
    (vals) => {
      store.deckConditions.weather = vals;
      runBuildDeck();
    },
    "deck-weather"
  );

  renderMultiSelectChips(
    container.querySelector("#deck-phase-chips"),
    opts.disaster_phase || [],
    dc.disaster_phase || [],
    (vals) => {
      store.deckConditions.disaster_phase = vals;
      runBuildDeck();
    },
    "deck-disaster_phase"
  );

  container
    .querySelector("#deck-disaster-select")
    .addEventListener("change", (e) => {
      store.deckConditions.disaster_type = e.target.value;
      runBuildDeck();
    });
  container
    .querySelector("#deck-shelter-select")
    .addEventListener("change", (e) => {
      store.deckConditions.shelter = e.target.value;
      runBuildDeck();
    });
  container
    .querySelector("#deck-timeslot-select")
    .addEventListener("change", (e) => {
      store.deckConditions.time_slot = e.target.value;
      runBuildDeck();
    });
  container
    .querySelector("#deck-max-events")
    .addEventListener("change", (e) => {
      store.deckConditions.max_events = e.target.value;
      runBuildDeck();
    });
  container
    .querySelector("#deck-max-households")
    .addEventListener("change", (e) => {
      store.deckConditions.max_households = e.target.value;
      runBuildDeck();
    });

  // 日付変更時の休日種別自動入力 (UI-16)
  container
    .querySelector("#deck-date-input")
    .addEventListener("change", async (e) => {
      const dateVal = e.target.value;
      store.deckConditions.date = dateVal;
      if (dateVal) {
        try {
          const res = await api.getHolidayTypes(dateVal);
          store.deckConditions.holiday_type = res.holiday_types || [];
          renderHolidayChips();
        } catch (err) {
          showToast(err.detail || "休日判定に失敗しました", "warning");
        }
      } else {
        store.deckConditions.holiday_type = [];
        renderHolidayChips();
      }
      await runBuildDeck();
    });

  container.querySelector("#build-deck-btn").addEventListener("click", () => {
    runBuildDeck();
  });

  // 保存済みデッキの再計算通知バナー (UI-20)
  const renderChangedNotice = () => {
    changedBannerWrap.innerHTML = "";
    const notice = store.loadedSavedDeckNotice;
    if (!notice || !notice.changed) return;

    changedBannerWrap.innerHTML = `
      <div class="deck-changed-banner" data-testid="deck-changed-banner">
        <div>
          <strong>再計算しました:</strong>
          <span>保存時以降にカードが編集されたため、デッキを再計算しました。保存時の手動調整を再適用しますか？</span>
        </div>
        <div class="deck-changed-actions">
          <button type="button" class="btn btn-sm btn-primary" id="reapply-saved-adjustments-btn" data-testid="reapply-saved-adjustments-btn">
            手動調整を再適用
          </button>
          <button type="button" class="btn btn-sm" id="dismiss-saved-adjustments-btn" data-testid="dismiss-saved-adjustments-btn">
            新しい計算結果のままにする
          </button>
        </div>
      </div>
    `;

    changedBannerWrap
      .querySelector("#reapply-saved-adjustments-btn")
      .addEventListener("click", async () => {
        store.deckResolutions = { ...(notice.resolutions || {}) };
        store.deckManualOrder = notice.manual_order
          ? [...notice.manual_order]
          : null;
        store.loadedSavedDeckNotice = null;
        renderChangedNotice();
        await runBuildDeck();
        showToast("保存時の手動調整を再適用しました", "success");
      });

    changedBannerWrap
      .querySelector("#dismiss-saved-adjustments-btn")
      .addEventListener("click", async () => {
        store.deckResolutions = {};
        store.deckManualOrder = null;
        store.loadedSavedDeckNotice = null;
        renderChangedNotice();
        await runBuildDeck();
      });
  };

  renderChangedNotice();

  async function runBuildDeck() {
    reorderErrorBox.style.display = "none";
    reorderErrorBox.textContent = "";
    try {
      const payload = buildDeckRequestPayload();
      const deck = await api.buildDeck(payload);
      store.currentDeck = deck;

      const st = deck.stats || {};
      container.querySelector("#deck-stat-total-cards").textContent = `${st.total_cards ?? 0}枚`;
      container.querySelector("#deck-stat-total-units").textContent = String(
        st.total_units ?? 0
      );
      container.querySelector("#deck-stat-events").textContent = String(
        st.events ?? 0
      );
      container.querySelector("#deck-stat-households").textContent = String(
        st.households ?? 0
      );
      container.querySelector("#deck-stat-persons").textContent = String(
        st.persons ?? 0
      );
      container.querySelector("#deck-stat-pets").textContent = String(
        st.pets ?? 0
      );

      // 矛盾パネル (UI-17, UI-18)
      renderConflictPanel(
        conflictContainer,
        deck.conflicts || [],
        store.deckResolutions || {},
        {
          onResolveSingle: async (culpritId, action) => {
            store.deckPhaseFirst = false;
            store.deckResolutions = {
              ...(store.deckResolutions || {}),
              [culpritId]: action,
            };
            await runBuildDeck();
          },
          onResolveAllPhaseFirst: async () => {
            store.deckPhaseFirst = true;
            store.deckManualOrder = null;
            await runBuildDeck();
            showToast("すべて進行度を優先して並べ直しました", "success");
          },
          onResetResolutions: async () => {
            store.deckPhaseFirst = false;
            store.deckResolutions = {};
            store.deckManualOrder = null;
            await runBuildDeck();
          },
        }
      );

      // 単位一覧 (UI-19)
      renderSortableUnitList(
        unitsContainer,
        deck.units || [],
        async (newUnitIds) => {
          try {
            reorderErrorBox.style.display = "none";
            const verifyPayload = {
              ...buildDeckRequestPayload(),
              manual_order: newUnitIds,
            };
            await api.reorderDeck(verifyPayload);
            store.deckManualOrder = newUnitIds;
            await runBuildDeck();
          } catch (err) {
            const msg =
              err.detail ||
              err.message ||
              "前提カードの制約に反するため移動できません";
            reorderErrorBox.style.display = "block";
            reorderErrorBox.textContent = msg;
            showToast(msg, "error");
          }
        },
        (unit) => {
          openDeckDetailModal(
            unit.kind === "event" ? "event" : "household",
            unit.id
          );
        },
        (unit) => {
          excludeUnitFromDeck(unit.id, unit.name);
        }
      );

      // 除外一覧
      const exc = deck.excluded || [];
      const manualExcludedSet = getExcludedIdsSet();
      const manualExcCount = exc.filter(
        (item) => item.manual || manualExcludedSet.has(item.id)
      ).length;
      if (restoreAllExcludedBtn) {
        if (manualExcCount > 0) {
          restoreAllExcludedBtn.style.display = "inline-flex";
          restoreAllExcludedBtn.textContent = `手動除外をすべて戻す (${manualExcCount}件)`;
        } else {
          restoreAllExcludedBtn.style.display = "none";
        }
      }
      container.querySelector("#deck-excluded-count").textContent = String(
        exc.length
      );
      excludedList.innerHTML = exc
        .map((item) => {
          const isManual = Boolean(item.manual || manualExcludedSet.has(item.id));
          const kindLabel = item.kind === "event" ? "イベント" : "世帯";
          return `
            <li class="excluded-unit-item ${isManual ? "excluded-unit-manual" : ""}" data-unit-id="${escapeHtml(item.id)}" data-unit-kind="${escapeHtml(item.kind)}" data-testid="excluded-unit-${escapeHtml(item.id)}">
              <div class="excluded-unit-info">
                <span class="type-pill ${item.kind === "event" ? "pill-event" : "pill-household"}">${kindLabel}</span>
                <strong>${escapeHtml(item.id)}</strong>
                <span>${escapeHtml(item.name || "")}</span>
                <span class="text-muted">（${escapeHtml((item.reasons || []).join(", "))}）</span>
              </div>
              ${
                isManual
                  ? `<button
                      type="button"
                      class="btn btn-xs btn-primary unit-restore-btn"
                      data-unit-id="${escapeHtml(item.id)}"
                      data-unit-name="${escapeHtml(item.name || "")}"
                      data-testid="unit-restore-${escapeHtml(item.id)}"
                    >＋ デッキに戻す</button>`
                  : ""
              }
            </li>
          `;
        })
        .join("");

      excludedList.querySelectorAll(".excluded-unit-item").forEach((li) => {
        li.addEventListener("click", (e) => {
          if (e.target.closest(".unit-restore-btn")) return;
          const uid = li.dataset.unitId;
          const ukind = li.dataset.unitKind === "event" ? "event" : "household";
          if (uid) openDeckDetailModal(ukind, uid);
        });
      });

      excludedList.querySelectorAll(".unit-restore-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          restoreUnitToDeck(btn.dataset.unitId, btn.dataset.unitName);
        });
      });

      renderDeckSubView();
    } catch (err) {
      const msg = err.detail || err.message || "デッキの構築に失敗しました";
      reorderErrorBox.style.display = "block";
      reorderErrorBox.textContent = msg;
      showToast(msg, "error");
    }
  }

  const unitsGridWrap = container.querySelector("#deck-units-grid-wrap");
  const cardsPreviewSection = container.querySelector("#deck-cards-preview-section");
  const ledgerSection = container.querySelector("#deck-ledger-section");
  const subUnitsBtn = container.querySelector("#deck-submode-units");
  const subCardsBtn = container.querySelector("#deck-submode-cards");
  const subLedgerBtn = container.querySelector("#deck-submode-ledger");

  function getDeckRenderCards() {
    const rawCards = (store.currentDeck && store.currentDeck.cards) || [];
    return rawCards
      .map((dc) => toCardRenderModel(dc))
      .filter(Boolean);
  }

  function renderDeckSubView() {
    const subMode = store.deckViewSubMode || "units";
    if (subUnitsBtn) subUnitsBtn.classList.toggle("btn-primary", subMode === "units");
    if (subCardsBtn) subCardsBtn.classList.toggle("btn-primary", subMode === "cards");
    if (subLedgerBtn) subLedgerBtn.classList.toggle("btn-primary", subMode === "ledger");

    if (subMode === "units") {
      if (unitsGridWrap) unitsGridWrap.style.display = "";
      if (cardsPreviewSection) cardsPreviewSection.style.display = "none";
      if (ledgerSection) ledgerSection.style.display = "none";
    } else if (subMode === "cards") {
      if (unitsGridWrap) unitsGridWrap.style.display = "none";
      if (cardsPreviewSection) {
        cardsPreviewSection.style.display = "block";
        cardsPreviewSection.innerHTML = "";
        const renderCards = getDeckRenderCards();
        if (renderCards.length === 0) {
          cardsPreviewSection.innerHTML = `<div class="empty-banner"><p>デッキにカードがありません</p></div>`;
        } else {
          const grid = document.createElement("div");
          grid.className = "gen-cards-preview-grid";
          grid.setAttribute("data-testid", "deck-gen-cards-grid");
          for (const rc of renderCards) {
            const unitId = rc.type === "イベント" ? rc.original_id : rc.group_id || rc.original_id;
            const unitLabel = rc.type === "イベント" ? rc.name : rc.group_name || unitId;
            const excludeBtnLabel =
              rc.type === "イベント"
                ? "✕ このデッキから除外"
                : `✕ 世帯(${escapeHtml(unitId)})ごとデッキから除外`;
            const el = renderCardPreviewElement(rc, {
              designMode: "standard",
              showNumber: true,
              actionsHtml: `
                <div class="gen-card-deck-actions">
                  <button
                    type="button"
                    class="btn btn-xs btn-outline-danger preview-card-exclude-btn"
                    data-unit-id="${escapeHtml(unitId)}"
                    data-unit-name="${escapeHtml(unitLabel)}"
                    data-testid="preview-exclude-${escapeHtml(rc.id)}"
                    title="この訓練デッキから除外します（データベース上の元カードは削除されません）"
                  >
                    ${excludeBtnLabel}
                  </button>
                </div>
              `,
              onClick: (card) => {
                const orig = card.original_id || card.id;
                openDeckDetailModal(
                  card.type === "イベント" ? "event" : "member",
                  orig
                );
              },
            });
            const exBtn = el.querySelector(".preview-card-exclude-btn");
            if (exBtn) {
              exBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                excludeUnitFromDeck(exBtn.dataset.unitId, exBtn.dataset.unitName);
              });
            }
            grid.appendChild(el);
          }
          cardsPreviewSection.appendChild(grid);
        }
      }
      if (ledgerSection) ledgerSection.style.display = "none";
    } else if (subMode === "ledger") {
      if (unitsGridWrap) unitsGridWrap.style.display = "none";
      if (cardsPreviewSection) cardsPreviewSection.style.display = "none";
      if (ledgerSection) {
        ledgerSection.style.display = "block";
        ledgerSection.innerHTML = "";
        const renderCards = getDeckRenderCards();
        ledgerSection.appendChild(renderMasterListElement(renderCards));
      }
    }
  }

  if (subUnitsBtn) {
    subUnitsBtn.addEventListener("click", () => {
      store.deckViewSubMode = "units";
      renderDeckSubView();
    });
  }
  if (subCardsBtn) {
    subCardsBtn.addEventListener("click", () => {
      store.deckViewSubMode = "cards";
      renderDeckSubView();
    });
  }
  if (subLedgerBtn) {
    subLedgerBtn.addEventListener("click", () => {
      store.deckViewSubMode = "ledger";
      renderDeckSubView();
    });
  }

  let activeExportSignal = null;
  const exportProgressWrap = container.querySelector("#deck-export-progress-wrap");
  const exportProgressText = container.querySelector("#deck-export-progress-text");
  const cancelExportBtn = container.querySelector("#cancel-deck-export-btn");

  if (cancelExportBtn) {
    cancelExportBtn.addEventListener("click", () => {
      if (activeExportSignal) {
        activeExportSignal.cancelled = true;
      }
    });
  }

  container
    .querySelector("#export-deck-pdf-btn")
    .addEventListener("click", async () => {
      const renderCards = getDeckRenderCards();
      if (renderCards.length === 0) {
        showToast("出力するカードがありません", "warning");
        return;
      }
      activeExportSignal = { cancelled: false };
      if (exportProgressWrap) exportProgressWrap.style.display = "inline-flex";
      if (exportProgressText) exportProgressText.textContent = `0 / ${renderCards.length}`;
      try {
        await exportCardsAsPdf(
          renderCards,
          "business",
          "standard",
          {
            download: true,
            filename: "hug-cards.pdf",
            signal: activeExportSignal,
            onProgress: (c, t) => {
              if (exportProgressText) exportProgressText.textContent = `${c} / ${t}`;
            },
          }
        );
        showToast("カードPDFを出力しました", "success");
      } catch (err) {
        if (err && err.message === "CANCELLED") {
          showToast("カードPDF生成を中断しました", "info");
        } else {
          showToast((err && err.message) || "PDF出力に失敗しました", "error");
        }
      } finally {
        activeExportSignal = null;
        if (exportProgressWrap) exportProgressWrap.style.display = "none";
      }
    });

  container
    .querySelector("#export-deck-zip-btn")
    .addEventListener("click", async () => {
      const renderCards = getDeckRenderCards();
      if (renderCards.length === 0) {
        showToast("出力するカードがありません", "warning");
        return;
      }
      activeExportSignal = { cancelled: false };
      if (exportProgressWrap) exportProgressWrap.style.display = "inline-flex";
      if (exportProgressText) exportProgressText.textContent = `0 / ${renderCards.length}`;
      try {
        await exportCardsAsZip(
          renderCards,
          "standard",
          {
            download: true,
            filename: "hug-cards.zip",
            signal: activeExportSignal,
            onProgress: (c, t) => {
              if (exportProgressText) exportProgressText.textContent = `${c} / ${t}`;
            },
          }
        );
        showToast("完成カード画像ZIPを出力しました", "success");
      } catch (err) {
        if (err && err.message === "CANCELLED") {
          showToast("一括画像生成を中断しました", "info");
        } else {
          showToast((err && err.message) || "ZIP出力に失敗しました", "error");
        }
      } finally {
        activeExportSignal = null;
        if (exportProgressWrap) exportProgressWrap.style.display = "none";
      }
    });

  container
    .querySelector("#print-deck-ledger-btn")
    .addEventListener("click", () => {
      const renderCards = getDeckRenderCards();
      if (renderCards.length === 0) {
        showToast("印刷するカードがありません", "warning");
        return;
      }
      printMasterLedger(renderCards);
    });

  // 閲覧モード起動 (UI-21)
  container
    .querySelector("#open-training-view-btn")
    .addEventListener("click", () => {
      if (
        !store.currentDeck ||
        !Array.isArray(store.currentDeck.cards) ||
        store.currentDeck.cards.length === 0
      ) {
        showToast("表示するカードがありません", "warning");
        return;
      }
      openTrainingView(store.currentDeck.cards);
    });

  // デッキ出力 (UI-22)
  container
    .querySelector("#export-deck-json-btn")
    .addEventListener("click", async () => {
      try {
        const blob = await api.exportDeck("json", buildDeckRequestPayload());
        triggerBlobDownload(blob, "hug_deck.json");
      } catch (err) {
        showToast(err.detail || "JSON出力に失敗しました", "error");
      }
    });

  container
    .querySelector("#export-deck-csv-btn")
    .addEventListener("click", async () => {
      try {
        const blob = await api.exportDeck("cardcsv", buildDeckRequestPayload());
        triggerBlobDownload(blob, "hug_deck_cards.csv");
      } catch (err) {
        showToast(err.detail || "CSV出力に失敗しました", "error");
      }
    });

  // デッキ条件保存 (UI-20)
  container
    .querySelector("#save-deck-btn")
    .addEventListener("click", async () => {
      const nameInput = container.querySelector("#save-deck-name-input");
      const rawName = nameInput.value.trim();
      const name =
        rawName ||
        `デッキ_${store.deckConditions.disaster_type || "標準"}_${store.deckConditions.shelter || "避難所"}`;
      try {
        const payload = buildDeckRequestPayload();
        await api.createSavedDeck({
          name,
          conditions: payload.conditions,
          resolutions: payload.resolutions,
          manual_order: payload.manual_order || [],
        });
        nameInput.value = "";
        showToast(`デッキ条件「${name}」を保存しました`, "success");
      } catch (err) {
        showToast(err.detail || "デッキ条件の保存に失敗しました", "error");
      }
    });

  await runBuildDeck();
}
