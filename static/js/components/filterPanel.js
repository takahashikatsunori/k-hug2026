/**
 * スキーマ駆動の絞り込み・検索パネルコンポーネント (UI-02, UI-03, UI-04, UI-05).
 */
import { escapeHtml } from "../util.js";
import { renderMultiSelectChips } from "./chips.js";
import { store } from "../store.js";

/**
 * 絞り込みパネルを描画する.
 * @param {HTMLElement} container
 * @param {Record<string, any>} schema
 * @param {() => void} onFilterChange
 */
export function renderFilterPanel(container, schema, onFilterChange) {
  const q = store.searchQuery;
  const training = q.training || {
    disaster_type: "",
    shelter: "",
    time_slot: "",
    infrastructure: [],
    weather: [],
    holiday_type: [],
  };
  const fieldFiltersMap = {};
  for (const f of q.fields || []) {
    fieldFiltersMap[f.field] = f;
  }

  const opts = (schema && schema.options) || {};
  const disasterOpts = opts.disaster_types || [];
  const infraOpts = opts.infrastructure || [];
  const weatherOpts = opts.weather || [];
  const holidayOpts = opts.holiday_type || [];
  const timeOpts = opts.time_slots || [];
  const shelterOpts = opts.shelters || [];
  const categoryOpts = opts.category || [];
  const timingOpts = opts.relative_timing || [];
  const phaseOpts = opts.disaster_phase || [];
  const vulnOpts = opts.vulnerabilities || [];

  container.innerHTML = `
    <div class="filter-panel" data-testid="filter-panel">
      <div class="filter-header">
        <h3>検索・絞り込み</h3>
        <button type="button" class="btn btn-sm" id="filter-clear-btn" data-testid="filter-clear-btn">条件をクリア</button>
      </div>

      <div class="filter-section">
        <label class="filter-label" for="filter-keyword-input">キーワード検索 (AND)</label>
        <input
          type="search"
          id="filter-keyword-input"
          class="form-input"
          data-testid="keyword-input"
          placeholder="例: 毛布 深夜"
          value="${escapeHtml(q.keyword || "")}"
        />
      </div>

      <div class="filter-section">
        <label class="filter-label">表示種別</label>
        <div class="view-switcher" data-testid="view-switcher">
          ${[
            ["all", "すべて"],
            ["event", "イベント"],
            ["household", "世帯"],
            ["person", "人物"],
            ["pet", "ペット"],
          ]
            .map(
              ([val, label]) => `
            <button
              type="button"
              class="btn btn-sm ${q.view === val ? "btn-primary" : ""}"
              data-view="${val}"
              data-testid="view-btn-${val}"
            >${label}</button>
          `
            )
            .join("")}
        </div>
      </div>

      <div class="filter-section">
        <label class="filter-label" for="filter-sort-select">並び順</label>
        <select id="filter-sort-select" class="form-select" data-testid="sort-select">
          <option value="deck" ${q.sort === "deck" ? "selected" : ""}>デッキ順</option>
          <option value="id" ${q.sort === "id" ? "selected" : ""}>ID順</option>
          <option value="priority" ${q.sort === "priority" ? "selected" : ""}>優先度順</option>
          <option value="updated" ${q.sort === "updated" ? "selected" : ""}>更新日順</option>
        </select>
      </div>

      <hr class="filter-divider" />

      <div class="filter-section">
        <h4 class="filter-subtitle">訓練条件で適合判定</h4>

        <label class="filter-label" for="filter-tr-disaster">想定災害</label>
        <select id="filter-tr-disaster" class="form-select" data-testid="filter-tr-disaster">
          <option value="">(指定なし)</option>
          ${disasterOpts
            .map(
              (o) =>
                `<option value="${escapeHtml(o)}" ${training.disaster_type === o ? "selected" : ""}>${escapeHtml(o)}</option>`
            )
            .join("")}
        </select>

        <label class="filter-label" for="filter-tr-shelter">避難所</label>
        <select id="filter-tr-shelter" class="form-select" data-testid="filter-tr-shelter">
          <option value="">(指定なし)</option>
          ${shelterOpts
            .map(
              (o) =>
                `<option value="${escapeHtml(o)}" ${training.shelter === o ? "selected" : ""}>${escapeHtml(o)}</option>`
            )
            .join("")}
        </select>

        <label class="filter-label" for="filter-tr-timeslot">時間帯</label>
        <select id="filter-tr-timeslot" class="form-select" data-testid="filter-tr-timeslot">
          <option value="">(指定なし)</option>
          ${timeOpts
            .map(
              (o) =>
                `<option value="${escapeHtml(o)}" ${training.time_slot === o ? "selected" : ""}>${escapeHtml(o)}</option>`
            )
            .join("")}
        </select>

        <label class="filter-label">インフラ状況（複数選択）</label>
        <div id="filter-tr-infra-chips" class="chips-wrap" data-testid="filter-tr-infra-chips"></div>

        <label class="filter-label">天候（複数選択）</label>
        <div id="filter-tr-weather-chips" class="chips-wrap" data-testid="filter-tr-weather-chips"></div>

        <label class="filter-label">休日種別（複数選択）</label>
        <div id="filter-tr-holiday-chips" class="chips-wrap" data-testid="filter-tr-holiday-chips"></div>
      </div>

      <hr class="filter-divider" />

      <div class="filter-section">
        <h4 class="filter-subtitle">項目別の絞り込み</h4>

        <label class="filter-label">イベント種別 (category)</label>
        <div id="filter-field-category" class="chips-wrap"></div>

        <label class="filter-label">相対発生時期 (relative_timing)</label>
        <div id="filter-field-timing" class="chips-wrap"></div>

        <label class="filter-label">災害進行度 (disaster_phase)</label>
        <div id="filter-field-phase" class="chips-wrap"></div>

        <label class="filter-label">要配慮特性 (vulnerabilities)</label>
        <div id="filter-field-vuln" class="chips-wrap"></div>
      </div>
    </div>
  `;

  const syncTraining = (patch) => {
    const cur = store.searchQuery.training || {
      disaster_type: "",
      shelter: "",
      time_slot: "",
      infrastructure: [],
      weather: [],
      holiday_type: [],
    };
    const next = { ...cur, ...patch };
    const hasAny =
      Boolean(next.disaster_type) ||
      Boolean(next.shelter) ||
      Boolean(next.time_slot) ||
      (next.infrastructure && next.infrastructure.length > 0) ||
      (next.weather && next.weather.length > 0) ||
      (next.holiday_type && next.holiday_type.length > 0);
    store.searchQuery.training = hasAny ? next : null;
    onFilterChange();
  };

  const syncFieldFilter = (fieldName, values) => {
    const rest = (store.searchQuery.fields || []).filter(
      (f) => f.field !== fieldName
    );
    if (values && values.length > 0) {
      rest.push({ field: fieldName, op: "any", value: values });
    }
    store.searchQuery.fields = rest;
    onFilterChange();
  };

  // キーワード
  const kwInput = container.querySelector("#filter-keyword-input");
  let kwTimer = null;
  kwInput.addEventListener("input", () => {
    store.searchQuery.keyword = kwInput.value;
    if (kwTimer) clearTimeout(kwTimer);
    kwTimer = setTimeout(() => {
      onFilterChange();
    }, 60);
  });
  kwInput.addEventListener("change", () => {
    if (kwTimer) clearTimeout(kwTimer);
    store.searchQuery.keyword = kwInput.value;
    onFilterChange();
  });

  // 表示種別
  container.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      store.searchQuery.view = btn.dataset.view;
      renderFilterPanel(container, schema, onFilterChange);
      onFilterChange();
    });
  });

  // 並び順
  const sortSel = container.querySelector("#filter-sort-select");
  sortSel.addEventListener("change", () => {
    store.searchQuery.sort = sortSel.value;
    onFilterChange();
  });

  // 訓練条件セレクト
  container
    .querySelector("#filter-tr-disaster")
    .addEventListener("change", (e) =>
      syncTraining({ disaster_type: e.target.value })
    );
  container
    .querySelector("#filter-tr-shelter")
    .addEventListener("change", (e) =>
      syncTraining({ shelter: e.target.value })
    );
  container
    .querySelector("#filter-tr-timeslot")
    .addEventListener("change", (e) =>
      syncTraining({ time_slot: e.target.value })
    );

  // 訓練条件マルチチップ
  renderMultiSelectChips(
    container.querySelector("#filter-tr-infra-chips"),
    infraOpts,
    training.infrastructure || [],
    (vals) => syncTraining({ infrastructure: vals }),
    "filter-infrastructure"
  );
  renderMultiSelectChips(
    container.querySelector("#filter-tr-weather-chips"),
    weatherOpts,
    training.weather || [],
    (vals) => syncTraining({ weather: vals }),
    "filter-weather"
  );
  renderMultiSelectChips(
    container.querySelector("#filter-tr-holiday-chips"),
    holidayOpts,
    training.holiday_type || [],
    (vals) => syncTraining({ holiday_type: vals }),
    "filter-holiday_type"
  );

  // 項目別マルチチップ
  renderMultiSelectChips(
    container.querySelector("#filter-field-category"),
    categoryOpts,
    (fieldFiltersMap.category && fieldFiltersMap.category.value) || [],
    (vals) => syncFieldFilter("category", vals),
    "field-category"
  );
  renderMultiSelectChips(
    container.querySelector("#filter-field-timing"),
    timingOpts,
    (fieldFiltersMap.relative_timing && fieldFiltersMap.relative_timing.value) ||
      [],
    (vals) => syncFieldFilter("relative_timing", vals),
    "field-relative_timing"
  );
  renderMultiSelectChips(
    container.querySelector("#filter-field-phase"),
    phaseOpts,
    (fieldFiltersMap.disaster_phase && fieldFiltersMap.disaster_phase.value) ||
      [],
    (vals) => syncFieldFilter("disaster_phase", vals),
    "field-disaster_phase"
  );
  renderMultiSelectChips(
    container.querySelector("#filter-field-vuln"),
    vulnOpts,
    (fieldFiltersMap.vulnerabilities && fieldFiltersMap.vulnerabilities.value) ||
      [],
    (vals) => syncFieldFilter("vulnerabilities", vals),
    "field-vulnerabilities"
  );

  // クリアボタン
  container.querySelector("#filter-clear-btn").addEventListener("click", () => {
    if (kwTimer) clearTimeout(kwTimer);
    store.searchQuery = {
      view: "all",
      keyword: "",
      fields: [],
      training: null,
      sort: "deck",
    };
    renderFilterPanel(container, schema, onFilterChange);
    onFilterChange();
  });
}
