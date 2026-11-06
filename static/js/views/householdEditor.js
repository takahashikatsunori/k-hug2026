/**
 * 世帯（避難者グループ＋構成員）作成・編集フォームビュー (UI-11).
 */
import { escapeHtml, computeHouseholdCounts } from "../util.js";
import { recordToFormState, formStateToRecord } from "../schema.js";
import { api, ApiError } from "../api.js";
import { store } from "../store.js";
import {
  renderTriStateChips,
  renderMultiSelectChips,
} from "../components/chips.js";
import { renderHouseholdCard } from "../components/card.js";
import { showToast } from "../components/toast.js";

/**
 * 世帯作成・編集フォームを描画する.
 * @param {HTMLElement} container
 * @param {string | null} editingGroupId
 * @param {{ onSaved: () => Promise<void> }} callbacks
 */
export async function renderHouseholdEditor(
  container,
  editingGroupId,
  callbacks
) {
  const schema = store.schema;
  const opts = (schema && schema.options) || {};
  const petTypeField = (schema.members || []).find((f) => f.name === "pet_type");
  const petTypeOpts = (petTypeField && petTypeField.options) || [
    "犬",
    "猫",
    "小型鳥類",
    "ウサギ",
    "爬虫類",
    "その他",
  ];

  let initialGroup = {
    group_name: "",
    evacuation_origin: (opts.evacuation_origin && opts.evacuation_origin[0]) || "自宅（木造・全壊）",
    urgency_level: (opts.urgency_level && opts.urgency_level[0]) || "通常",
    personal_equipment: [],
    relative_timing: ["中盤"],
    disaster_phase: ["発災直後"],
  };
  let initialMembers = [
    {
      data_type: "人物",
      name: "",
      age: 35,
      gender: "男性",
      relationship: "世帯主",
      attributes: [],
      vulnerabilities: [],
      health_condition: ["良好"],
      skills: [],
      appearance: "落ち着いた様子",
      statement: "避難してきました。よろしくお願いします。",
      training_point: "受付の基本確認を行う。",
    },
  ];

  if (editingGroupId) {
    try {
      const hh = await api.getHousehold(editingGroupId);
      initialGroup = hh.group;
      initialMembers = hh.members || [];
    } catch (err) {
      showToast(`世帯 ${editingGroupId} の取得に失敗しました`, "error");
    }
  }

  const groupFormState = recordToFormState("group", initialGroup, schema);
  /** @type {Array<Record<string, any>>} */
  const memberStates = initialMembers.map((m) => {
    const st = recordToFormState("member", m, schema);
    if (m.member_id) st.values.member_id = m.member_id;
    return st;
  });

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
    <div class="editor-grid" data-testid="household-editor">
      <div class="editor-form-pane">
        <h3>${editingGroupId ? `世帯編集: ${escapeHtml(editingGroupId)}` : "世帯・構成員 新規作成"}</h3>
        <div id="household-validation-errors" class="validation-errors-box" data-testid="household-validation-errors" style="display:none;"></div>

        <form id="household-form" novalidate>
          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label required" for="grp-name">世帯・グループ名 (group_name)</label>
              <input type="text" id="grp-name" name="group_name" class="form-input" data-testid="input-group-group_name" value="${escapeHtml(groupFormState.values.group_name)}" />
            </div>
            <div class="form-group">
              <label class="form-label">自動集計人数</label>
              <div class="counts-bar" id="household-live-counts" data-testid="household-live-counts">
                <span>人物: <strong id="live-member-count" data-testid="live-member-count">0</strong>名</span>
                <span>ペット: <strong id="live-pet-count" data-testid="live-pet-count">0</strong>匹</span>
              </div>
            </div>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label required" for="grp-origin">避難元 (evacuation_origin)</label>
              <select id="grp-origin" name="evacuation_origin" class="form-select" data-testid="input-group-evacuation_origin">
                ${makeSelectOptions(opts.evacuation_origin, groupFormState.values.evacuation_origin, true)}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label required" for="grp-urgency">到着時緊急度 (urgency_level)</label>
              <select id="grp-urgency" name="urgency_level" class="form-select" data-testid="input-group-urgency_level">
                ${makeSelectOptions(opts.urgency_level, groupFormState.values.urgency_level, true)}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">相対発生時期 (relative_timing)</label>
            <div id="grp-timing-chips" class="chips-wrap" data-testid="chips-group-relative_timing"></div>
          </div>

          <div class="form-group">
            <label class="form-label">災害進行度 (disaster_phase)</label>
            <div id="grp-phase-chips" class="chips-wrap" data-testid="chips-group-disaster_phase"></div>
          </div>

          <div class="form-group">
            <label class="form-label">私物資機材 (personal_equipment)</label>
            <div id="grp-equip-chips" class="chips-wrap" data-testid="chips-group-personal_equipment"></div>
          </div>

          <hr class="filter-divider" />
          <div class="members-header">
            <h4>世帯構成員（人物 1名以上必須 / ペット任意）</h4>
            <div class="members-add-buttons">
              <button type="button" class="btn btn-sm btn-secondary" id="add-person-row-btn" data-testid="add-person-row-btn">
                ＋ 人物を追加
              </button>
              <button type="button" class="btn btn-sm btn-secondary" id="add-pet-row-btn" data-testid="add-pet-row-btn">
                ＋ ペットを追加
              </button>
            </div>
          </div>

          <div id="member-rows-container" data-testid="member-rows-container"></div>

          <hr class="filter-divider" />
          <h4>条件設定（未指定 → 合致 → 排除）</h4>
          <div id="grp-condition-dims"></div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" data-testid="save-household-btn">
              ${editingGroupId ? "世帯の変更を保存" : "世帯を作成"}
            </button>
          </div>
        </form>
      </div>

      <div class="editor-preview-pane">
        <h4>リアルタイム・世帯カードプレビュー</h4>
        <div id="household-live-preview" data-testid="household-live-preview"></div>
      </div>
    </div>
  `;

  const previewContainer = container.querySelector("#household-live-preview");
  const memberRowsContainer = container.querySelector("#member-rows-container");
  const errorBox = container.querySelector("#household-validation-errors");

  const getCurrentPayload = () => {
    const grpRec = formStateToRecord("group", groupFormState, schema);
    if (editingGroupId) grpRec.group_id = editingGroupId;
    const memRecs = memberStates.map((ms) => {
      const mr = formStateToRecord("member", ms, schema);
      if (ms.values.member_id) mr.member_id = ms.values.member_id;
      return mr;
    });
    const counts = computeHouseholdCounts(memRecs);
    grpRec.member_count = counts.member_count;
    grpRec.pet_count = counts.pet_count;
    return { group: grpRec, members: memRecs, counts };
  };

  const updatePreviewAndCounts = () => {
    const { group, members, counts } = getCurrentPayload();
    container.querySelector("#live-member-count").textContent = String(
      counts.member_count
    );
    container.querySelector("#live-pet-count").textContent = String(
      counts.pet_count
    );
    previewContainer.innerHTML = "";
    previewContainer.appendChild(renderHouseholdCard(group, members));
  };

  const renderMemberRows = () => {
    memberRowsContainer.innerHTML = "";

    memberStates.forEach((ms, idx) => {
      const isPet = ms.values.data_type === "ペット";
      const row = document.createElement("div");
      row.className = `member-editor-row ${isPet ? "member-row-pet" : "member-row-person"}`;
      row.setAttribute("data-testid", `member-row-${idx}`);
      row.dataset.memberType = ms.values.data_type;

      row.innerHTML = `
        <div class="member-row-header">
          <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
            <span class="type-pill ${isPet ? "pill-pet" : "pill-person"}">${escapeHtml(ms.values.data_type)}</span>
            <strong>行 #${idx + 1} ${ms.values.member_id ? `(${escapeHtml(ms.values.member_id)})` : "(新規)"}</strong>
            ${
              ms.values.member_id && store.imageIds && store.imageIds.has(ms.values.member_id)
                ? `<span class="badge badge-has-image">🎨 イラスト済</span>`
                : ""
            }
          </div>
          <div style="display:flex;align-items:center;gap:0.35rem;">
            ${
              ms.values.member_id
                ? `
              <label class="btn btn-xs btn-secondary" style="margin:0;">
                画像設定
                <input type="file" class="mem-image-upload-input" data-member-id="${escapeHtml(ms.values.member_id)}" data-testid="editor-member-image-input-${idx}" accept="image/*" style="display:none;" />
              </label>
            `
                : ""
            }
            <button type="button" class="btn btn-xs btn-danger remove-member-btn" data-testid="remove-member-row-${idx}">
              行を削除
            </button>
          </div>
        </div>

        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">名前 (name, 空欄で自動生成)</label>
            <input type="text" class="form-input mem-input" data-field="name" data-testid="input-member-${idx}-name" value="${escapeHtml(ms.values.name)}" />
          </div>
          <div class="form-group">
            <label class="form-label">年齢 (age)</label>
            <input type="number" min="0" max="120" class="form-input mem-input" data-field="age" data-testid="input-member-${idx}-age" value="${escapeHtml(ms.values.age)}" />
          </div>
          <div class="form-group">
            <label class="form-label">性別 (gender)</label>
            <select class="form-select mem-input" data-field="gender" data-testid="input-member-${idx}-gender">
              ${makeSelectOptions(opts.gender, ms.values.gender, true)}
            </select>
          </div>
        </div>

        ${
          !isPet
            ? `
          <div class="person-only-section" data-testid="person-only-fields-${idx}">
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label">続柄・関係 (relationship)</label>
                <select class="form-select mem-input" data-field="relationship" data-testid="input-member-${idx}-relationship">
                  ${makeSelectOptions(opts.relationship, ms.values.relationship, true)}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label required">受付時の言葉 (statement)</label>
                <input type="text" class="form-input mem-input" data-field="statement" data-testid="input-member-${idx}-statement" value="${escapeHtml(ms.values.statement)}" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">体調・ケガ (health_condition)</label>
              <div class="chips-wrap mem-health-chips"></div>
            </div>
            <div class="form-group">
              <label class="form-label">要配慮特性 (vulnerabilities)</label>
              <div class="chips-wrap mem-vuln-chips"></div>
            </div>
            <div class="form-group">
              <label class="form-label">スキル (skills)</label>
              <div class="chips-wrap mem-skill-chips"></div>
            </div>
          </div>
        `
            : `
          <div class="pet-only-section" data-testid="pet-only-fields-${idx}">
            <div class="form-group">
              <label class="form-label">ペット種別 (pet_type)</label>
              <select class="form-select mem-input" data-field="pet_type" data-testid="input-member-${idx}-pet_type">
                ${makeSelectOptions(petTypeOpts, ms.values.pet_type, true)}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">ペット健康属性 (pet_health_condition)</label>
              <div class="chips-wrap mem-pet-health-chips"></div>
            </div>
            <div class="form-group">
              <label class="form-label">ペット配慮属性 (pet_vulnerabilities)</label>
              <div class="chips-wrap mem-pet-vuln-chips"></div>
            </div>
          </div>
        `
        }

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label required">容姿・特徴 (appearance)</label>
            <input type="text" class="form-input mem-input" data-field="appearance" data-testid="input-member-${idx}-appearance" value="${escapeHtml(ms.values.appearance)}" />
          </div>
          <div class="form-group">
            <label class="form-label required">訓練ポイント (training_point)</label>
            <input type="text" class="form-input mem-input" data-field="training_point" data-testid="input-member-${idx}-training_point" value="${escapeHtml(ms.values.training_point)}" />
          </div>
        </div>
      `;

      row.querySelectorAll(".mem-input").forEach((inp) => {
        const sync = () => {
          ms.values[inp.dataset.field] = inp.value;
          updatePreviewAndCounts();
        };
        inp.addEventListener("input", sync);
        inp.addEventListener("change", sync);
      });

      if (!isPet) {
        renderMultiSelectChips(
          row.querySelector(".mem-health-chips"),
          opts.health_condition || [],
          ms.values.health_condition || [],
          (vals) => {
            ms.values.health_condition = vals;
            updatePreviewAndCounts();
          },
          `mem-${idx}-health`
        );
        renderMultiSelectChips(
          row.querySelector(".mem-vuln-chips"),
          opts.vulnerabilities || [],
          ms.values.vulnerabilities || [],
          (vals) => {
            ms.values.vulnerabilities = vals;
            updatePreviewAndCounts();
          },
          `mem-${idx}-vuln`
        );
        renderMultiSelectChips(
          row.querySelector(".mem-skill-chips"),
          opts.skills || [],
          ms.values.skills || [],
          (vals) => {
            ms.values.skills = vals;
            updatePreviewAndCounts();
          },
          `mem-${idx}-skill`
        );
      } else {
        renderMultiSelectChips(
          row.querySelector(".mem-pet-health-chips"),
          opts.pet_health_condition || [],
          ms.values.pet_health_condition || [],
          (vals) => {
            ms.values.pet_health_condition = vals;
            updatePreviewAndCounts();
          },
          `mem-${idx}-pethealth`
        );
        renderMultiSelectChips(
          row.querySelector(".mem-pet-vuln-chips"),
          opts.pet_vulnerabilities || [],
          ms.values.pet_vulnerabilities || [],
          (vals) => {
            ms.values.pet_vulnerabilities = vals;
            updatePreviewAndCounts();
          },
          `mem-${idx}-petvuln`
        );
      }

      const imgInput = row.querySelector(".mem-image-upload-input");
      if (imgInput) {
        imgInput.addEventListener("change", async (e) => {
          const file = e.target.files && e.target.files[0];
          const mid = imgInput.dataset.memberId;
          if (!file || !mid) return;
          try {
            await api.uploadCardImage(mid, file);
            store.markImageUpdated(mid);
            renderMemberRows();
            updatePreviewAndCounts();
            showToast(`${mid} のイラストを保存しました`, "success");
          } catch (err) {
            showToast(err.detail || "イラストの保存に失敗しました", "error");
          }
        });
      }

      row.querySelector(".remove-member-btn").addEventListener("click", () => {
        memberStates.splice(idx, 1);
        renderMemberRows();
        updatePreviewAndCounts();
      });

      memberRowsContainer.appendChild(row);
    });
  };

  renderMultiSelectChips(
    container.querySelector("#grp-timing-chips"),
    opts.relative_timing || [],
    groupFormState.values.relative_timing || [],
    (vals) => {
      groupFormState.values.relative_timing = vals;
      updatePreviewAndCounts();
    },
    "group-relative_timing"
  );

  renderMultiSelectChips(
    container.querySelector("#grp-phase-chips"),
    opts.disaster_phase || [],
    groupFormState.values.disaster_phase || [],
    (vals) => {
      groupFormState.values.disaster_phase = vals;
      updatePreviewAndCounts();
    },
    "group-disaster_phase"
  );

  renderMultiSelectChips(
    container.querySelector("#grp-equip-chips"),
    opts.personal_equipment || [],
    groupFormState.values.personal_equipment || [],
    (vals) => {
      groupFormState.values.personal_equipment = vals;
      updatePreviewAndCounts();
    },
    "group-equip"
  );

  const dimsContainer = container.querySelector("#grp-condition-dims");
  for (const dim of schema.condition_dimensions || []) {
    if (dim.kind !== "multi") continue;
    const block = document.createElement("div");
    block.className = "form-group";
    block.innerHTML = `<label class="form-label">${escapeHtml(dim.label)}</label><div class="chips-wrap"></div>`;
    dimsContainer.appendChild(block);

    renderTriStateChips(
      block.querySelector(".chips-wrap"),
      dim.options || [],
      groupFormState.conditions[dim.key] || {},
      (_opt, _st, updatedMap) => {
        groupFormState.conditions[dim.key] = updatedMap;
        updatePreviewAndCounts();
      },
      `group-${dim.key}`
    );
  }

  const formEl = container.querySelector("#household-form");
  formEl
    .querySelectorAll("#grp-name, #grp-origin, #grp-urgency")
    .forEach((inp) => {
      const sync = () => {
        if (inp.name) {
          groupFormState.values[inp.name] = inp.value;
          updatePreviewAndCounts();
        }
      };
      inp.addEventListener("input", sync);
      inp.addEventListener("change", sync);
    });

  // 人物・ペット追加ボタン (UI-11)
  container
    .querySelector("#add-person-row-btn")
    .addEventListener("click", () => {
      memberStates.push(
        recordToFormState(
          "member",
          {
            data_type: "人物",
            name: "",
            age: 30,
            gender: "女性",
            relationship: "妻",
            attributes: [],
            vulnerabilities: [],
            health_condition: ["良好"],
            skills: [],
            appearance: "落ち着いた様子",
            statement: "一緒に避難してきました。",
            training_point: "家族構成を確認する。",
          },
          schema
        )
      );
      renderMemberRows();
      updatePreviewAndCounts();
    });

  container.querySelector("#add-pet-row-btn").addEventListener("click", () => {
    memberStates.push(
      recordToFormState(
        "member",
        {
          data_type: "ペット",
          name: "",
          age: 3,
          gender: null,
          pet_type: "犬",
          pet_health_condition: [],
          pet_vulnerabilities: [],
          pet_skills: [],
          pet_housing: ["中ケージ"],
          appearance: "中型犬、おとなしい",
          training_point: "ペット同行避難の案内を行う。",
        },
        schema
      )
    );
    renderMemberRows();
    updatePreviewAndCounts();
  });

  renderMemberRows();
  updatePreviewAndCounts();

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
              `<li>${escapeHtml(e.field ? `[${e.field}] ` : "")}${escapeHtml(e.message)}</li>`
          )
          .join("")}
      </ul>
    `;
  };

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { group, members, counts } = getCurrentPayload();
    const errs = [];
    if (!group.group_name)
      errs.push({ field: "group_name", message: "グループ名は必須です" });
    if (counts.member_count < 1)
      errs.push({
        field: "members",
        message: "世帯には人物の構成員が最低1名必要です",
      });
    if (errs.length > 0) {
      showValidationErrors(errs);
      return;
    }

    try {
      showValidationErrors([]);
      if (editingGroupId) {
        const updated = await api.updateHousehold(editingGroupId, {
          group,
          members,
        });
        showToast(`世帯 ${updated.group.group_id} を更新しました`, "success");
      } else {
        const created = await api.createHousehold({ group, members });
        showToast(`世帯 ${created.group.group_id} を作成しました`, "success");
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
