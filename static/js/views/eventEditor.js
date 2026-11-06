/**
 * イベント作成・編集フォームビュー (UI-07, UI-08, UI-09).
 */
import { escapeHtml } from "../util.js";
import { recordToFormState, formStateToRecord } from "../schema.js";
import { api, ApiError } from "../api.js";
import { store } from "../store.js";
import {
  renderTriStateChips,
  renderMultiSelectChips,
} from "../components/chips.js";
import { renderEventCard } from "../components/card.js";
import { showToast } from "../components/toast.js";
import { toCardRenderModel, renderCardPreviewElement } from "../cardCanvas.js";

/**
 * 循環参照になる候補を除外した前提カード選択肢を計算する.
 * @param {Array<Record<string, any>>} allEvents
 * @param {string | null} currentId
 * @returns {Array<Record<string, any>>}
 */
function getEligiblePrerequisites(allEvents, currentId) {
  if (!currentId) return allEvents || [];
  const forbidden = new Set([currentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ev of allEvents || []) {
      if (
        !forbidden.has(ev.card_id) &&
        ev.prerequisite_card_id &&
        forbidden.has(ev.prerequisite_card_id)
      ) {
        forbidden.add(ev.card_id);
        changed = true;
      }
    }
  }
  return (allEvents || []).filter((ev) => !forbidden.has(ev.card_id));
}

/**
 * イベント編集フォームを描画する.
 * @param {HTMLElement} container
 * @param {string | null} editingId
 * @param {{ onSaved: () => Promise<void> }} callbacks
 */
export async function renderEventEditor(container, editingId, callbacks) {
  const schema = store.schema;
  const opts = (schema && schema.options) || {};
  const allEvents = await api.listEvents();

  let initialRecord = {
    event_name: "",
    category: [],
    priority: 5,
    difficulty: "中級",
    must_respond: "なし",
    source: "",
    content: "",
    relative_timing: ["中盤"],
    disaster_phase: ["発災直後"],
  };
  if (editingId) {
    try {
      initialRecord = await api.getEvent(editingId);
    } catch (err) {
      showToast(`イベント ${editingId} の取得に失敗しました`, "error");
    }
  }

  const formState = recordToFormState("event", initialRecord, schema);
  const eligiblePrereqs = getEligiblePrerequisites(allEvents, editingId);

  const makeSelectOptions = (list, currentVal, allowEmpty = true) => {
    const emptyOpt = allowEmpty ? `<option value="">(未選択)</option>` : "";
    return (
      emptyOpt +
      (list || [])
        .map(
          (o) =>
            `<option value="${escapeHtml(o)}" ${currentVal === o ? "selected" : ""}>${escapeHtml(o)}</option>`
        )
        .join("")
    );
  };

  container.innerHTML = `
    <div class="editor-grid" data-testid="event-editor">
      <div class="editor-form-pane">
        <h3>${editingId ? `イベント編集: ${escapeHtml(editingId)}` : "イベント新規作成"}</h3>
        <div id="event-validation-errors" class="validation-errors-box" data-testid="event-validation-errors" style="display:none;"></div>

        <form id="event-form" novalidate>
          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label required" for="ev-name">イベント名 (event_name)</label>
              <input type="text" id="ev-name" name="event_name" class="form-input" data-testid="input-event-event_name" value="${escapeHtml(formState.values.event_name)}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ev-source">発生源 (source)</label>
              <input type="text" id="ev-source" name="source" class="form-input" data-testid="input-event-source" value="${escapeHtml(formState.values.source)}" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label required">イベント種別 (category, 1つ以上選択)</label>
            <div id="ev-category-chips" class="chips-wrap" data-testid="chips-event-category"></div>
          </div>

          <div class="form-group">
            <label class="form-label required" for="ev-content">イベント内容 (content)</label>
            <textarea id="ev-content" name="content" class="form-textarea" rows="3" data-testid="input-event-content">${escapeHtml(formState.values.content)}</textarea>
          </div>

          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label required" for="ev-priority">優先度 (0〜10)</label>
              <input type="number" id="ev-priority" name="priority" min="0" max="10" class="form-input" data-testid="input-event-priority" value="${escapeHtml(formState.values.priority)}" />
            </div>
            <div class="form-group">
              <label class="form-label required" for="ev-difficulty">対応難易度 (difficulty)</label>
              <select id="ev-difficulty" name="difficulty" class="form-select" data-testid="input-event-difficulty">
                ${makeSelectOptions(opts.difficulty, formState.values.difficulty, true)}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label required" for="ev-must-respond">対応必須フラグ (must_respond)</label>
              <select id="ev-must-respond" name="must_respond" class="form-select" data-testid="input-event-must_respond">
                ${makeSelectOptions(opts.must_respond, formState.values.must_respond, true)}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">相対発生時期 (relative_timing)</label>
            <div id="ev-timing-chips" class="chips-wrap" data-testid="chips-event-relative_timing"></div>
          </div>

          <div class="form-group">
            <label class="form-label">災害進行度 (disaster_phase)</label>
            <div id="ev-phase-chips" class="chips-wrap" data-testid="chips-event-disaster_phase"></div>
          </div>

          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label" for="ev-prereq">前提カード (prerequisite_card_id)</label>
              <select id="ev-prereq" name="prerequisite_card_id" class="form-select" data-testid="input-event-prerequisite_card_id">
                <option value="">(なし)</option>
                ${eligiblePrereqs
                  .map(
                    (ev) =>
                      `<option value="${escapeHtml(ev.card_id)}" ${formState.values.prerequisite_card_id === ev.card_id ? "selected" : ""}>${escapeHtml(ev.card_id)}: ${escapeHtml(ev.event_name)}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="ev-equip">追加資機材 (additional_equipment)</label>
              <input type="text" id="ev-equip" name="additional_equipment" class="form-input" data-testid="input-event-additional_equipment" value="${escapeHtml(formState.values.additional_equipment)}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ev-req-people">必要人数 (required_people)</label>
              <input type="number" min="0" id="ev-req-people" name="required_people" class="form-input" data-testid="input-event-required_people" value="${escapeHtml(formState.values.required_people)}" />
            </div>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label" for="ev-scene">情景・読み上げ (scene_description)</label>
              <textarea id="ev-scene" name="scene_description" class="form-textarea" rows="2" data-testid="input-event-scene_description">${escapeHtml(formState.values.scene_description)}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label" for="ev-tp">訓練ポイント (training_point)</label>
              <textarea id="ev-tp" name="training_point" class="form-textarea" rows="2" data-testid="input-event-training_point">${escapeHtml(formState.values.training_point)}</textarea>
            </div>
          </div>

          <hr class="filter-divider" />
          <h4>条件設定（クリックで 未指定 → 合致[緑] → 排除[赤] を切替）</h4>
          <div id="ev-condition-dims"></div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label" for="ev-match-dates">合致・日付期間 (match_dates)</label>
              <input type="text" id="ev-match-dates" name="match_dates" class="form-input" placeholder="例: 12/01-02/28" data-testid="input-event-match_dates" value="${escapeHtml(formState.values.match_dates)}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ev-exclude-dates">排除・日付期間 (exclude_dates)</label>
              <input type="text" id="ev-exclude-dates" name="exclude_dates" class="form-input" placeholder="例: 07/01-08/31" data-testid="input-event-exclude_dates" value="${escapeHtml(formState.values.exclude_dates)}" />
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" data-testid="save-event-btn">
              ${editingId ? "変更を保存" : "イベントを作成"}
            </button>
          </div>
        </form>
      </div>

      <div class="editor-preview-pane">
        <h4>リアルタイム・カードプレビュー</h4>
        <div id="event-live-preview" data-testid="event-live-preview"></div>
        ${
          editingId
            ? `
          <div class="editor-image-box" data-testid="editor-event-image-panel">
            <h5>イラスト画像 (${escapeHtml(editingId)})</h5>
            <div class="editor-image-actions">
              <label class="btn btn-xs btn-secondary">
                画像を選択
                <input type="file" id="editor-event-image-input" data-testid="editor-event-image-input" accept="image/*" style="display:none;" />
              </label>
              <button type="button" class="btn btn-xs btn-danger" id="editor-event-image-delete-btn" data-testid="editor-event-image-delete-btn">
                画像を削除
              </button>
            </div>
          </div>
        `
            : ""
        }
        <h4 style="margin-top:1rem;">完成カードプレビュー</h4>
        <div id="event-gen-card-preview" data-testid="event-gen-card-preview"></div>
      </div>
    </div>
  `;

  const previewContainer = container.querySelector("#event-live-preview");
  const genPreviewContainer = container.querySelector("#event-gen-card-preview");
  const errorBox = container.querySelector("#event-validation-errors");

  const updatePreview = () => {
    const rec = formStateToRecord("event", formState, schema);
    if (editingId) rec.card_id = editingId;
    previewContainer.innerHTML = "";
    previewContainer.appendChild(renderEventCard(rec));
    if (genPreviewContainer) {
      genPreviewContainer.innerHTML = "";
      const cardModel = toCardRenderModel(rec);
      if (cardModel) {
        genPreviewContainer.appendChild(
          renderCardPreviewElement(cardModel, {
            designMode: store.cardDesignMode || "standard",
          })
        );
      }
    }
  };

  if (editingId) {
    const imgInput = container.querySelector("#editor-event-image-input");
    const imgDelBtn = container.querySelector("#editor-event-image-delete-btn");
    if (imgInput) {
      imgInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          await api.uploadCardImage(editingId, file);
          store.markImageUpdated(editingId);
          updatePreview();
          showToast(`${editingId} のイラストを保存しました`, "success");
        } catch (err) {
          showToast(err.detail || "イラストの保存に失敗しました", "error");
        }
      });
    }
    if (imgDelBtn) {
      imgDelBtn.addEventListener("click", async () => {
        try {
          await api.deleteCardImage(editingId);
          store.markImageDeleted(editingId);
          updatePreview();
          showToast(`${editingId} のイラストを削除しました`, "success");
        } catch (err) {
          showToast(err.detail || "イラストの削除に失敗しました", "error");
        }
      });
    }
  }

  renderMultiSelectChips(
    container.querySelector("#ev-category-chips"),
    opts.category || [],
    formState.values.category || [],
    (vals) => {
      formState.values.category = vals;
      updatePreview();
    },
    "event-category"
  );

  renderMultiSelectChips(
    container.querySelector("#ev-timing-chips"),
    opts.relative_timing || [],
    formState.values.relative_timing || [],
    (vals) => {
      formState.values.relative_timing = vals;
      updatePreview();
    },
    "event-relative_timing"
  );

  renderMultiSelectChips(
    container.querySelector("#ev-phase-chips"),
    opts.disaster_phase || [],
    formState.values.disaster_phase || [],
    (vals) => {
      formState.values.disaster_phase = vals;
      updatePreview();
    },
    "event-disaster_phase"
  );

  // 条件 3状態チップ
  const dimsContainer = container.querySelector("#ev-condition-dims");
  for (const dim of schema.condition_dimensions || []) {
    if (dim.kind !== "multi") continue;
    const block = document.createElement("div");
    block.className = "form-group";
    block.innerHTML = `<label class="form-label">${escapeHtml(dim.label)} (${escapeHtml(dim.key)})</label><div class="chips-wrap" id="ev-dim-${escapeHtml(dim.key)}"></div>`;
    dimsContainer.appendChild(block);

    const chipBox = block.querySelector(".chips-wrap");
    renderTriStateChips(
      chipBox,
      dim.options || [],
      formState.conditions[dim.key] || {},
      (_opt, _st, updatedMap) => {
        formState.conditions[dim.key] = updatedMap;
        updatePreview();
      },
      dim.key
    );
  }

  // テキスト・セレクト入力の同期
  const formEl = container.querySelector("#event-form");
  formEl.querySelectorAll("input, select, textarea").forEach((inp) => {
    const sync = () => {
      if (inp.name) {
        formState.values[inp.name] = inp.value;
        updatePreview();
      }
    };
    inp.addEventListener("input", sync);
    inp.addEventListener("change", sync);
  });

  updatePreview();

  const showValidationErrors = (errors) => {
    if (!errors || errors.length === 0) {
      errorBox.style.display = "none";
      errorBox.innerHTML = "";
      return;
    }
    errorBox.style.display = "block";
    errorBox.innerHTML = `
      <strong>入力エラーがあります:</strong>
      <ul>
        ${errors
          .map(
            (e) =>
              `<li data-field="${escapeHtml(e.field || "")}">${escapeHtml(e.field ? `[${e.field}] ` : "")}${escapeHtml(e.message)}</li>`
          )
          .join("")}
      </ul>
    `;
  };

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const record = formStateToRecord("event", formState, schema);

    const clientErrors = [];
    if (!record.event_name)
      clientErrors.push({ field: "event_name", message: "イベント名は必須です" });
    if (!Array.isArray(record.category) || record.category.length === 0)
      clientErrors.push({
        field: "category",
        message: "イベント種別を1つ以上選択してください",
      });
    if (record.priority === null || record.priority === undefined)
      clientErrors.push({ field: "priority", message: "優先度は必須です" });
    if (!record.difficulty)
      clientErrors.push({ field: "difficulty", message: "対応難易度は必須です" });
    if (!record.must_respond)
      clientErrors.push({
        field: "must_respond",
        message: "対応必須フラグは必須です",
      });
    if (!record.content)
      clientErrors.push({ field: "content", message: "イベント内容は必須です" });

    if (clientErrors.length > 0) {
      showValidationErrors(clientErrors);
      return;
    }

    try {
      showValidationErrors([]);
      if (editingId) {
        const updated = await api.updateEvent(editingId, record);
        showToast(`イベント ${updated.card_id} を更新しました`, "success");
      } else {
        const created = await api.createEvent(record);
        showToast(`イベント ${created.card_id} を作成しました`, "success");
      }
      if (callbacks.onSaved) {
        await callbacks.onSaved();
      }
    } catch (err) {
      if (err instanceof ApiError && err.errors && err.errors.length > 0) {
        showValidationErrors(err.errors);
      } else {
        showValidationErrors([
          { field: "", message: err.detail || err.message || "保存に失敗しました" },
        ]);
      }
    }
  });
}
