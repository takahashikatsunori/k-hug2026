/**
 * デッキ構築ビュー (UI-16, UI-17, UI-18, UI-19, UI-20, UI-21, UI-22).
 */
import { escapeHtml, triggerBlobDownload, formatDateTime } from "../util.js";
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
import { importDeckFromJsonText } from "../webDeckEngine.js";

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
    origin_overrides: dc.origin_overrides || {},
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

        <div class="deck-saved-toolbar" data-testid="deck-saved-toolbar" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;background:#f8fafc;padding:0.65rem 0.95rem;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:0.75rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <label style="font-size:0.86rem;font-weight:700;color:#334155;display:flex;align-items:center;gap:0.3rem;">
              📂 保存済みデッキ:
            </label>
            <select id="deck-saved-list-select" class="form-select form-input-sm" style="min-width:240px;max-width:360px;" data-testid="deck-saved-list-select">
              <option value="">-- 保存済みデッキを選択 --</option>
            </select>
            <button type="button" class="btn btn-sm btn-primary" id="load-saved-deck-btn" data-testid="load-saved-deck-btn" disabled>
              呼び出し
            </button>
            <button type="button" class="btn btn-sm btn-danger" id="delete-saved-deck-btn" data-testid="delete-saved-deck-btn" disabled>
              削除
            </button>
          </div>

          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="import-deck-json-btn" data-testid="import-deck-json-btn" title="Web版等でエクスポートしたデッキJSONを取り込みます">
              📥 デッキJSON読込
            </button>
            <input type="file" id="deck-json-file-input" data-testid="deck-json-file-input" accept=".json,application/json" style="display:none;" />
          </div>
        </div>

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

  const renderInfraChips = () => {
    renderMultiSelectChips(
      container.querySelector("#deck-infra-chips"),
      opts.infrastructure || [],
      store.deckConditions.infrastructure || [],
      (vals) => {
        store.deckConditions.infrastructure = vals;
        runBuildDeck();
      },
      "deck-infrastructure"
    );
  };

  const renderWeatherChips = () => {
    renderMultiSelectChips(
      container.querySelector("#deck-weather-chips"),
      opts.weather || [],
      store.deckConditions.weather || [],
      (vals) => {
        store.deckConditions.weather = vals;
        runBuildDeck();
      },
      "deck-weather"
    );
  };

  const renderPhaseChips = () => {
    renderMultiSelectChips(
      container.querySelector("#deck-phase-chips"),
      opts.disaster_phase || [],
      store.deckConditions.disaster_phase || [],
      (vals) => {
        store.deckConditions.disaster_phase = vals;
        runBuildDeck();
      },
      "deck-disaster_phase"
    );
  };

  function syncSidebarInputsFromStore() {
    const dcNow = store.deckConditions || {};
    const dSelect = container.querySelector("#deck-disaster-select");
    if (dSelect) dSelect.value = dcNow.disaster_type || "";
    const sSelect = container.querySelector("#deck-shelter-select");
    if (sSelect) sSelect.value = dcNow.shelter || "";
    const dInput = container.querySelector("#deck-date-input");
    if (dInput) dInput.value = dcNow.date || "";
    const tSelect = container.querySelector("#deck-timeslot-select");
    if (tSelect) tSelect.value = dcNow.time_slot || "";
    const maxEv = container.querySelector("#deck-max-events");
    if (maxEv) maxEv.value = dcNow.max_events ?? "";
    const maxHh = container.querySelector("#deck-max-households");
    if (maxHh) maxHh.value = dcNow.max_households ?? "";

    renderHolidayChips();
    renderInfraChips();
    renderWeatherChips();
    renderPhaseChips();
  }

  renderHolidayChips();
  renderInfraChips();
  renderWeatherChips();
  renderPhaseChips();

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

  // 保存済みデッキ操作（一覧取得・呼び出し・削除）
  const savedSelect = container.querySelector("#deck-saved-list-select");
  const loadSavedBtn = container.querySelector("#load-saved-deck-btn");
  const delSavedBtn = container.querySelector("#delete-saved-deck-btn");
  const importJsonBtn = container.querySelector("#import-deck-json-btn");
  const jsonFileInput = container.querySelector("#deck-json-file-input");

  async function refreshSavedDecksList(selectedId = null) {
    if (!savedSelect) return;
    try {
      const list = await api.listSavedDecks();
      savedSelect.innerHTML = '<option value="">-- 保存済みデッキを選択 --</option>';
      if (!list || list.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.disabled = true;
        opt.textContent = "（保存されたデッキはありません）";
        savedSelect.appendChild(opt);
        if (loadSavedBtn) loadSavedBtn.disabled = true;
        if (delSavedBtn) delSavedBtn.disabled = true;
        return;
      }

      list.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = String(d.id);
        const updated = d.updated_at ? formatDateTime(d.updated_at) : "";
        opt.textContent = `${d.name} (${updated})`;
        if (selectedId && String(d.id) === String(selectedId)) {
          opt.selected = true;
        }
        savedSelect.appendChild(opt);
      });

      const hasVal = Boolean(savedSelect.value);
      if (loadSavedBtn) loadSavedBtn.disabled = !hasVal;
      if (delSavedBtn) delSavedBtn.disabled = !hasVal;
    } catch (err) {
      console.error("保存済みデッキ一覧の取得に失敗しました", err);
    }
  }

  if (savedSelect) {
    savedSelect.addEventListener("change", () => {
      const hasVal = Boolean(savedSelect.value);
      if (loadSavedBtn) loadSavedBtn.disabled = !hasVal;
      if (delSavedBtn) delSavedBtn.disabled = !hasVal;
    });
  }

  if (loadSavedBtn) {
    loadSavedBtn.addEventListener("click", async () => {
      const id = Number(savedSelect.value);
      if (!id) return;
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
          origin_overrides: cond.origin_overrides || cond.originOverrides || {},
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

        const nameInput = container.querySelector("#save-deck-name-input");
        if (nameInput) {
          nameInput.value = detail.name || "";
        }

        syncSidebarInputsFromStore();
        await runBuildDeck();
        showToast(`保存済みデッキ「${detail.name}」を呼び出しました`, "success");
      } catch (err) {
        showToast(err.detail || "保存済みデッキの取得に失敗しました", "error");
      }
    });
  }

  if (delSavedBtn) {
    delSavedBtn.addEventListener("click", async () => {
      const id = Number(savedSelect.value);
      if (!id) return;
      const selText = savedSelect.options[savedSelect.selectedIndex]?.text || "このデッキ";
      if (!confirm(`保存済みデッキ「${selText}」を削除してもよろしいですか？`)) return;

      try {
        await api.deleteSavedDeck(id);
        showToast("保存済みデッキを削除しました", "info");
        await refreshSavedDecksList();
      } catch (err) {
        showToast(err.detail || "保存済みデッキの削除に失敗しました", "error");
      }
    });
  }

  // デッキJSON読込（Webエクスポート・標準JSON両対応：JSONで指定されたカードのみを厳密に復元）
  if (importJsonBtn && jsonFileInput) {
    importJsonBtn.addEventListener("click", () => jsonFileInput.click());
    jsonFileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        // 現在のDB全イベント・全世帯を取得してJSON内のカードと照合
        const [allEvents, allHouseholds] = await Promise.all([
          api.listEvents(),
          api.listHouseholds(),
        ]);
        const allGroups = [];
        const allMembers = [];
        for (const hh of allHouseholds || []) {
          const grp = hh.group ? hh.group : { ...hh };
          delete grp.members;
          if (grp.group_id) allGroups.push(grp);
          if (Array.isArray(hh.members)) {
            allMembers.push(...hh.members);
          }
        }

        const unitOrder = [];
        const seenUnits = new Set();
        const originOverrides = {
          ...(parsed._web_deck_meta?.origin_overrides || {}),
          ...(parsed._web_deck_meta?.conditions?.origin_overrides || {}),
          ...(parsed._web_deck_meta?.conditions?.originOverrides || {}),
        };
        if (Object.keys(originOverrides).length === 0 && Array.isArray(parsed.evacuee_groups)) {
          for (const g of parsed.evacuee_groups) {
            if (g.group_id && g.evacuation_origin) {
              originOverrides[String(g.group_id)] = g.evacuation_origin;
            }
          }
        }

        const cardSeq = parsed._web_deck_meta?.card_sequence;
        if (Array.isArray(cardSeq) && cardSeq.length > 0) {
          for (const item of cardSeq) {
            const uid = item.kind === "event" ? item.original_id : item.group_id || item.original_id;
            if (uid && !seenUnits.has(String(uid))) {
              seenUnits.add(String(uid));
              unitOrder.push(String(uid));
            }
            if (item.group_id && item.evacuation_origin) {
              originOverrides[String(item.group_id)] = item.evacuation_origin;
            }
          }
        } else {
          const dbObj = {
            cards_event: allEvents || [],
            evacuee_groups: allGroups,
            group_members: allMembers,
          };
          const imported = importDeckFromJsonText(text, dbObj);
          Object.assign(originOverrides, imported.restoredConditions?.origin_overrides || {});
          for (const dc of imported.deckCards || []) {
            const uid = dc.kind === "event" ? dc.original_id : dc.group_id;
            if (uid && !seenUnits.has(String(uid))) {
              seenUnits.add(String(uid));
              unitOrder.push(String(uid));
            }
            if (dc.group_id && dc.group && dc.group.evacuation_origin) {
              originOverrides[String(dc.group_id)] = dc.group.evacuation_origin;
            }
          }
        }

        // DB上の全単位IDのうち、読み込んだJSONに含まれていない単位はすべて除外リスト(excluded_ids)に入れる
        // （後からDBに追加されたカード等が勝手に混入するのを防ぎ、JSONの指定カードのみで構成する）
        const allDbUnitIds = [
          ...(allEvents || []).map((ev) => String(ev.card_id)),
          ...allGroups.map((g) => String(g.group_id)),
        ].filter(Boolean);
        const strictExcludedIds = allDbUnitIds.filter((id) => !seenUnits.has(id));

        const metaConditions = parsed._web_deck_meta?.conditions || null;
        store.deckConditions = {
          disaster_type: (metaConditions && metaConditions.disaster_type) || "",
          shelter: (metaConditions && metaConditions.shelter) || "",
          date: (metaConditions && metaConditions.date) || "",
          holiday_type: (metaConditions && metaConditions.holiday_type) || [],
          time_slot: (metaConditions && metaConditions.time_slot) || "",
          infrastructure: (metaConditions && metaConditions.infrastructure) || [],
          weather: (metaConditions && metaConditions.weather) || [],
          disaster_phase: (metaConditions && metaConditions.disaster_phase) || [],
          // 上限数による意図しない切り捨てを防ぎ、JSON内のカード指定を優先
          max_events: "",
          max_households: "",
          excluded_ids: strictExcludedIds,
          origin_overrides: originOverrides,
        };

        store.deckManualOrder = unitOrder.length > 0 ? unitOrder : null;
        store.deckResolutions = {};
        store.deckPhaseFirst = false;
        store.loadedSavedDeckNotice = null;

        const baseName = file.name.replace(/\.[^/.]+$/, "");
        const nameInput = container.querySelector("#save-deck-name-input");
        if (nameInput) {
          nameInput.value = baseName || "Web取込デッキ";
        }

        syncSidebarInputsFromStore();
        await runBuildDeck();

        // 万が一、条件フィルタによりJSON内の手動追加カードが弾かれた場合は、条件フィルタを緩めてJSON指定カードを100%復元する
        if (
          unitOrder.length > 0 &&
          store.currentDeck &&
          Array.isArray(store.currentDeck.unit_ids) &&
          store.currentDeck.unit_ids.length < unitOrder.length
        ) {
          store.deckConditions = {
            disaster_type: "",
            shelter: "",
            date: "",
            holiday_type: [],
            time_slot: "",
            infrastructure: [],
            weather: [],
            disaster_phase: [],
            max_events: "",
            max_households: "",
            excluded_ids: strictExcludedIds,
            origin_overrides: originOverrides,
          };
          syncSidebarInputsFromStore();
          await runBuildDeck();
        }

        const loadedTotal = (store.currentDeck && store.currentDeck.stats && store.currentDeck.stats.total_cards) || 0;
        showToast(
          `「${file.name}」から指定された ${loadedTotal}枚（${unitOrder.length}単位）のデッキを取り込みました`,
          "success"
        );
      } catch (err) {
        showToast(
          (err && err.message) || "デッキJSONの解析に失敗しました",
          "error"
        );
      } finally {
        jsonFileInput.value = "";
      }
    });
  }

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
        const currentUnitIds =
          (store.currentDeck && Array.isArray(store.currentDeck.unit_ids) && store.currentDeck.unit_ids) || [];
        const saved = await api.createSavedDeck({
          name,
          conditions: payload.conditions,
          resolutions: payload.resolutions,
          manual_order:
            payload.manual_order && payload.manual_order.length > 0
              ? payload.manual_order
              : currentUnitIds,
        });
        nameInput.value = "";
        showToast(`デッキ条件「${name}」を保存しました`, "success");
        await refreshSavedDecksList(saved.id);
      } catch (err) {
        showToast(err.detail || "デッキ条件の保存に失敗しました", "error");
      }
    });

  await refreshSavedDecksList();
  await runBuildDeck();
}
