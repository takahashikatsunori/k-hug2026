/**
 * イラスト一括生成（バッチプロンプト出力＆グリッド自動分割）・個別イラスト管理ビュー.
 */
import { escapeHtml, triggerBlobDownload } from "../util.js";
import { api } from "../api.js";
import { store } from "../store.js";
import {
  sliceGridImage,
  renderCardPreviewElement,
  clearCardImageCache,
} from "../cardCanvas.js";
import { showToast } from "../components/toast.js";

/**
 * ファイルを Data URL (`data:image/...;base64,...`) として読み込む.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result || ""));
    };
    reader.onerror = () =>
      reject(new Error("画像ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

/**
 * イラスト管理ビューを描画する.
 * @param {HTMLElement} container
 */
export async function renderImageView(container) {
  let subMode = "batch"; // "batch" | "cards"
  let activeType = "避難者"; // "避難者" | "ペット" | "イベント"
  let cardFilterType = "all";
  let cardFilterStatus = "all"; // "all" | "missing" | "has_image"
  let statusData = null;

  /**
   * クライアント側でグリッド分割した一時プレビュー状態:
   * batchId -> { fileName, slices: Array<{ dataUrl: string, enabled: boolean, targetId: string }> }
   * @type {Record<string, { fileName: string, slices: Array<{ dataUrl: string, enabled: boolean, targetId: string }> }>}
   */
  const localBatchSlices = {};

  async function loadStatus() {
    statusData = await api.getImagesStatus();
    store.updateImageStatus(statusData);
  }

  await loadStatus();

  function render() {
    const counts = (statusData && statusData.counts) || {
      避難者: { total: 0, with_image: 0, without_image: 0 },
      ペット: { total: 0, with_image: 0, without_image: 0 },
      イベント: { total: 0, with_image: 0, without_image: 0 },
    };
    const allCards = (statusData && statusData.cards) || [];
    const batchesByType = (statusData && statusData.batches_by_type) || {
      避難者: [],
      ペット: [],
      イベント: [],
    };
    const currentBatches = batchesByType[activeType] || [];

    const readyBatchesCount = currentBatches.filter((b) => {
      const loc = localBatchSlices[b.id];
      return loc && loc.slices && loc.slices.length > 0 && !b.isAdopted;
    }).length;

    container.innerHTML = `
      <div class="image-mgmt-layout" data-testid="image-view">
        <div class="image-mgmt-header">
          <div class="image-counts-summary" data-testid="image-counts-summary">
            <span class="count-badge pill-person-soft">
              避難者イラスト: <strong data-testid="img-cnt-person">${counts["避難者"]?.with_image ?? 0}/${counts["避難者"]?.total ?? 0}</strong>
              (未設定: <strong data-testid="img-missing-person">${counts["避難者"]?.without_image ?? 0}</strong>)
            </span>
            <span class="count-badge pill-pet-soft">
              ペットイラスト: <strong data-testid="img-cnt-pet">${counts["ペット"]?.with_image ?? 0}/${counts["ペット"]?.total ?? 0}</strong>
              (未設定: <strong data-testid="img-missing-pet">${counts["ペット"]?.without_image ?? 0}</strong>)
            </span>
            <span class="count-badge pill-event-soft">
              イベントイラスト: <strong data-testid="img-cnt-event">${counts["イベント"]?.with_image ?? 0}/${counts["イベント"]?.total ?? 0}</strong>
              (未設定: <strong data-testid="img-missing-event">${counts["イベント"]?.without_image ?? 0}</strong>)
            </span>
          </div>

          <div class="toolbar-actions">
            <button type="button" class="btn btn-sm btn-secondary" id="sync-images-btn" data-testid="sync-images-btn" title="data/images/ フォルダと SQLite DB を双方向同期します">
              🔄 フォルダ同期 (data/images/)
            </button>
            <button type="button" class="btn btn-sm" id="export-images-zip-btn" data-testid="export-images-zip-btn" title="全個別イラスト (EV-001.png, M-0001.png...) をZIP出力します">
              ⬇ イラストZIP出力
            </button>
            <label class="btn btn-sm" style="cursor:pointer; margin:0;">
              ⬆ イラストZIP取込
              <input type="file" id="import-images-zip-input" data-testid="import-images-zip-input" accept=".zip" style="display:none;" />
            </label>
          </div>
        </div>

        <div class="image-submode-bar">
          <div class="editor-mode-buttons">
            <button
              type="button"
              class="btn ${subMode === "batch" ? "btn-primary" : ""}"
              id="image-submode-batch"
              data-testid="image-submode-batch"
            >
              ① バッチ一括プロンプト出力 ＆ グリッド画像分割
            </button>
            <button
              type="button"
              class="btn ${subMode === "cards" ? "btn-primary" : ""}"
              id="image-submode-cards"
              data-testid="image-submode-cards"
            >
              ② 個別カードイラスト管理 ＆ 完成カード一覧
            </button>
          </div>
        </div>

        <div id="image-submode-body"></div>
      </div>
    `;

    const bodyEl = container.querySelector("#image-submode-body");

    if (subMode === "batch") {
      renderBatchSubMode(bodyEl, {
        counts,
        allCards,
        currentBatches,
        readyBatchesCount,
      });
    } else {
      renderCardsSubMode(bodyEl, { allCards });
    }

    bindTopToolbarEvents();
  }

  function renderBatchSubMode(
    bodyEl,
    { counts, allCards, currentBatches, readyBatchesCount }
  ) {
    const typedCards = allCards.filter((c) => c.type === activeType);

    const batchesHtml =
      currentBatches.length === 0
        ? `
          <div class="empty-banner" data-testid="batch-empty-state">
            <p><strong>${escapeHtml(activeType)}カード</strong>には現在、対象となるバッチがありません（未設定: ${counts[activeType]?.without_image ?? 0}枚）。</p>
            <div style="display:flex; gap:8px; justify-content:center; margin-top:8px;">
              <button type="button" class="btn btn-sm btn-primary" id="empty-regen-missing-btn">
                未設定カードからバッチを作成
              </button>
              <button type="button" class="btn btn-sm" id="empty-regen-all-btn">
                設定済みも含めて全カードからバッチを作成
              </button>
            </div>
          </div>
        `
        : currentBatches
            .map((batch) => {
              const firstCard = batch.targetCards[0];
              const lastCard =
                batch.targetCards[batch.targetCards.length - 1];
              const localSliceObj = localBatchSlices[batch.id];
              const hasSlices =
                localSliceObj &&
                Array.isArray(localSliceObj.slices) &&
                localSliceObj.slices.length > 0;

              const chipsHtml = (batch.targetCards || [])
                .map(
                  (tc) =>
                    `<span class="badge ${tc.hasImage ? "badge-match" : ""}" title="${escapeHtml(tc.original_id)}: ${escapeHtml(tc.name)}">
                      ${escapeHtml(tc.original_id)} ${escapeHtml(tc.name)} ${tc.hasImage ? "✓" : ""}
                    </span>`
                )
                .join(" ");

              let slicesPreviewHtml = "";
              if (hasSlices) {
                const gridColsCls =
                  batch.cols === 3 ? "slice-grid-3" : "slice-grid-4";
                const cellItemsHtml = localSliceObj.slices
                  .map((sItem, idx) => {
                    const optionsHtml =
                      `<option value="">(割当なし)</option>` +
                      typedCards
                        .map(
                          (tc) =>
                            `<option value="${escapeHtml(tc.original_id)}" ${sItem.targetId === tc.original_id ? "selected" : ""}>${escapeHtml(tc.original_id)}: ${escapeHtml(tc.name)}</option>`
                        )
                        .join("");

                    return `
                      <div class="slice-cell-card ${sItem.enabled ? "" : "slice-cell-disabled"}" data-testid="slice-cell-${escapeHtml(batch.id)}-${idx}">
                        <div class="slice-cell-top">
                          <label class="slice-cell-check-label">
                            <input
                              type="checkbox"
                              class="slice-enable-checkbox"
                              data-batch-id="${escapeHtml(batch.id)}"
                              data-slice-idx="${idx}"
                              data-testid="slice-enable-${escapeHtml(batch.id)}-${idx}"
                              ${sItem.enabled ? "checked" : ""}
                            />
                            <span>セル${idx + 1}を採用</span>
                          </label>
                        </div>
                        <div class="slice-img-wrap">
                          <img src="${escapeHtml(sItem.dataUrl)}" alt="セル${idx + 1}" class="slice-img" />
                        </div>
                        <div class="slice-cell-bottom">
                          <select
                            class="form-select form-input-sm slice-target-select"
                            data-batch-id="${escapeHtml(batch.id)}"
                            data-slice-idx="${idx}"
                            data-testid="slice-target-${escapeHtml(batch.id)}-${idx}"
                          >
                            ${optionsHtml}
                          </select>
                        </div>
                      </div>
                    `;
                  })
                  .join("");

                slicesPreviewHtml = `
                  <div class="batch-slices-container" data-testid="batch-slices-grid-${escapeHtml(batch.id)}">
                    <div class="slice-preview-grid ${gridColsCls}">
                      ${cellItemsHtml}
                    </div>
                    <div class="batch-slice-actions">
                      <label class="btn btn-sm" style="cursor:pointer;">
                        🔄 グリッド画像を再選択 (${escapeHtml(localSliceObj.fileName || "")})
                        <input
                          type="file"
                          accept="image/*"
                          class="batch-file-input"
                          data-batch-id="${escapeHtml(batch.id)}"
                          style="display:none;"
                        />
                      </label>
                      <button
                        type="button"
                        class="btn btn-primary adopt-batch-btn"
                        data-batch-id="${escapeHtml(batch.id)}"
                        data-testid="adopt-batch-btn-${escapeHtml(batch.id)}"
                      >
                        ✓ このバッチの選択セルをDB＆フォルダに保存反映
                      </button>
                    </div>
                  </div>
                `;
              } else {
                slicesPreviewHtml = `
                  <label class="batch-dropzone" data-batch-id="${escapeHtml(batch.id)}" data-testid="batch-dropzone-${escapeHtml(batch.id)}">
                    <input
                      type="file"
                      accept="image/*"
                      class="batch-file-input"
                      data-batch-id="${escapeHtml(batch.id)}"
                      data-testid="batch-file-input-${escapeHtml(batch.id)}"
                      style="display:none;"
                    />
                    <div class="dropzone-text">
                      <strong>⬆ バッチ #${batch.batchNumber} の生成グリッド画像をここに添付（ドラッグ＆ドロップ または クリックして選択）</strong>
                      <span>${batch.cols}列 × ${batch.rows}行のグリッド画像を白線検出で自動分割し、セルごとに採用ON/OFF・割当先カードIDを調整できます</span>
                    </div>
                  </label>
                `;
              }

              return `
                <div class="batch-card ${batch.isAdopted ? "batch-adopted" : ""}" data-testid="batch-card-${escapeHtml(batch.id)}">
                  <div class="batch-card-header">
                    <div class="batch-card-title-group">
                      <span class="type-pill ${batch.type === "イベント" ? "pill-event" : batch.type === "ペット" ? "pill-pet" : "pill-person"}">
                        バッチ #${batch.batchNumber}
                      </span>
                      <strong>対象 ${batch.targetCards.length}枚</strong>
                      <span class="text-muted">(${escapeHtml(firstCard?.original_id || "")} 〜 ${escapeHtml(lastCard?.original_id || "")})</span>
                    </div>
                    <div class="batch-status-group">
                      ${
                        batch.isAdopted
                          ? `<span class="badge badge-match" data-testid="batch-status-${escapeHtml(batch.id)}">✓ 反映済み</span>`
                          : hasSlices
                            ? `<span class="badge badge-timing" data-testid="batch-status-${escapeHtml(batch.id)}">分割プレビュー中 (${localSliceObj.slices.length}セル)</span>`
                            : `<span class="badge" data-testid="batch-status-${escapeHtml(batch.id)}">画像未添付</span>`
                      }
                    </div>
                  </div>

                  <div class="batch-target-chips">${chipsHtml}</div>

                  <div class="batch-prompt-section">
                    <div class="batch-prompt-bar">
                      <strong>1. AI画像生成プロンプト（${batch.cols}列×${batch.rows}行グリッド）</strong>
                      <div style="display:flex; gap:8px; align-items:center;">
                        <a
                          href="/static/templates/${escapeHtml(batch.templateFileName)}"
                          download="${escapeHtml(batch.templateFileName)}"
                          class="btn btn-sm"
                          data-testid="template-link-${escapeHtml(batch.id)}"
                        >
                          🖼 テンプレート画像 (${escapeHtml(batch.templateFileName)}) を保存
                        </a>
                        <button
                          type="button"
                          class="btn btn-sm btn-secondary copy-batch-prompt-btn"
                          data-batch-id="${escapeHtml(batch.id)}"
                          data-testid="copy-batch-prompt-${escapeHtml(batch.id)}"
                        >
                          📋 プロンプトをコピー
                        </button>
                      </div>
                    </div>
                    <textarea
                      readonly
                      class="form-textarea batch-prompt-textarea"
                      rows="5"
                      data-testid="batch-prompt-${escapeHtml(batch.id)}"
                    >${escapeHtml(batch.prompt)}</textarea>
                  </div>

                  <div class="batch-upload-section">
                    <strong>2. 生成グリッド画像の添付・自動分割・マスタIDへの保存</strong>
                    ${slicesPreviewHtml}
                  </div>
                </div>
              `;
            })
            .join("");

    bodyEl.innerHTML = `
      <div class="batch-mode-container">
        <div class="batch-guide-box">
          <strong>マスタDB段階でのAIイラスト一括作成・管理</strong>
          <p>
            カードの並び順やデッキ構成に左右されないよう、ここで分割したイラストは各カードの不変マスタID（<code>EV-xxx</code> / <code>M-xxxx</code>）に紐づけて
            SQLite データベースおよび <code>data/images/</code> フォルダの両方に永続保存されます。
            外で作ったグリッド画像の一部だけを採用したい場合や、別のカードIDへ割り当てたい場合も、分割プレビュー上でセルごとに自由に変更できます。
          </p>
        </div>

        <div class="batch-type-tabs">
          <button
            type="button"
            class="btn ${activeType === "避難者" ? "btn-primary" : ""}"
            data-batch-type="避難者"
            data-testid="batch-tab-person"
          >
            避難者カード (12枚 / 4×3) — 未設定 ${counts["避難者"]?.without_image ?? 0}枚
          </button>
          <button
            type="button"
            class="btn ${activeType === "ペット" ? "btn-primary" : ""}"
            data-batch-type="ペット"
            data-testid="batch-tab-pet"
          >
            ペットカード (12枚 / 4×3) — 未設定 ${counts["ペット"]?.without_image ?? 0}枚
          </button>
          <button
            type="button"
            class="btn ${activeType === "イベント" ? "btn-primary" : ""}"
            data-batch-type="イベント"
            data-testid="batch-tab-event"
          >
            イベントカード (9枚 / 3×3) — 未設定 ${counts["イベント"]?.without_image ?? 0}枚
          </button>
        </div>

        <div class="batch-controls-toolbar">
          <div>
            <strong>${escapeHtml(activeType)}カード: 全 ${currentBatches.length} バッチ</strong>
          </div>
          <div class="toolbar-actions">
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              id="copy-all-prompts-btn"
              data-testid="copy-all-prompts-btn"
              ${currentBatches.length === 0 ? "disabled" : ""}
            >
              📋 全バッチのプロンプトを一括コピー
            </button>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              id="adopt-all-batches-btn"
              data-testid="adopt-all-batches-btn"
              ${readyBatchesCount === 0 ? "disabled" : ""}
            >
              ✓ アップロード済みを一括反映 (${readyBatchesCount}件)
            </button>
            <button
              type="button"
              class="btn btn-sm"
              id="regenerate-batches-btn"
              data-testid="regenerate-batches-btn"
              title="現在イラスト未設定のカードのみを抽出してバッチを再作成します"
            >
              🔄 未設定カードから再抽出
            </button>
            <button
              type="button"
              class="btn btn-sm"
              id="regenerate-all-cards-batches-btn"
              data-testid="regenerate-all-cards-batches-btn"
              title="すでにイラストがあるカードも含め、全カードからバッチを作成します"
            >
              全カード対象でバッチ作成
            </button>
          </div>
        </div>

        <div class="batches-list">
          ${batchesHtml}
        </div>
      </div>
    `;

    // 種別タブ切替
    bodyEl.querySelectorAll("[data-batch-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeType = btn.dataset.batchType;
        render();
      });
    });

    // バッチ再抽出 (未設定のみ / 全件)
    const handleRegen = async (onlyMissing) => {
      try {
        const res = await api.generateImageBatches({
          type: activeType,
          only_missing: onlyMissing,
        });
        statusData = res.status;
        store.updateImageStatus(statusData);
        render();
        showToast(
          `${activeType}カードのバッチを再作成しました`,
          "success"
        );
      } catch (err) {
        showToast(err.detail || "バッチ生成に失敗しました", "error");
      }
    };

    const regenMissingBtn = bodyEl.querySelector("#regenerate-batches-btn");
    if (regenMissingBtn) {
      regenMissingBtn.addEventListener("click", () => handleRegen(true));
    }
    const regenAllBtn = bodyEl.querySelector("#regenerate-all-cards-batches-btn");
    if (regenAllBtn) {
      regenAllBtn.addEventListener("click", () => handleRegen(false));
    }
    const emptyRegenMissing = bodyEl.querySelector("#empty-regen-missing-btn");
    if (emptyRegenMissing) {
      emptyRegenMissing.addEventListener("click", () => handleRegen(true));
    }
    const emptyRegenAll = bodyEl.querySelector("#empty-regen-all-btn");
    if (emptyRegenAll) {
      emptyRegenAll.addEventListener("click", () => handleRegen(false));
    }

    // 個別プロンプトコピー
    bodyEl.querySelectorAll(".copy-batch-prompt-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bid = btn.dataset.batchId;
        const batch = currentBatches.find((b) => b.id === bid);
        if (!batch) return;
        try {
          await navigator.clipboard.writeText(batch.prompt);
        } catch {
          // クリップボード非対応環境用フォールバック
        }
        showToast(`バッチ #${batch.batchNumber} のプロンプトをコピーしました`, "success");
      });
    });

    // 全バッチプロンプト一括コピー
    const copyAllBtn = bodyEl.querySelector("#copy-all-prompts-btn");
    if (copyAllBtn) {
      copyAllBtn.addEventListener("click", async () => {
        if (currentBatches.length === 0) return;
        const combined = currentBatches
          .map((b) => {
            const summary = (b.targetCards || [])
              .map((c) => `No.${c.original_id} ${c.name}`)
              .join("、");
            return `==================================================\n【${b.type} バッチ #${b.batchNumber} / 全${currentBatches.length}バッチ】\n対象カード (${b.targetCards.length}枚): ${summary}\n添付必須テンプレート画像: ${b.templateFileName}\n==================================================\n${b.prompt}`;
          })
          .join("\n\n\n");
        try {
          await navigator.clipboard.writeText(combined);
        } catch {
          // フォールバック
        }
        showToast("全バッチのプロンプトを一括コピーしました", "success");
      });
    }

    // グリッド画像添付 → 自動分割（ファイル選択＆ドラッグ＆ドロップ共通）
    const processBatchGridFile = async (bid, file) => {
      const batch = currentBatches.find((b) => b.id === bid);
      if (!file || !batch) return;

      try {
        const dataUrl = await readFileAsBase64(file);
        const rawSlices = await sliceGridImage(dataUrl, batch.cols, batch.rows);
        localBatchSlices[bid] = {
          fileName: file.name,
          slices: rawSlices.map((sliceDataUrl, i) => {
            const tc = batch.targetCards[i];
            return {
              dataUrl: sliceDataUrl,
              enabled: Boolean(tc && tc.original_id),
              targetId: tc ? tc.original_id : "",
            };
          }),
        };
        batch.isAdopted = false;
        render();
        showToast(
          `バッチ #${batch.batchNumber} の画像を ${rawSlices.length} セルに分割しました`,
          "success"
        );
      } catch (err) {
        showToast(
          (err && err.message) || "グリッド画像の分割処理に失敗しました",
          "error"
        );
      }
    };

    bodyEl.querySelectorAll(".batch-file-input").forEach((input) => {
      input.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        const bid = input.dataset.batchId;
        await processBatchGridFile(bid, file);
      });
    });

    bodyEl.querySelectorAll(".batch-dropzone").forEach((dropzone) => {
      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("drag-over");
      });
      dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("drag-over");
      });
      dropzone.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("drag-over");
        const file =
          e.dataTransfer &&
          e.dataTransfer.files &&
          e.dataTransfer.files[0];
        const bid = dropzone.dataset.batchId;
        await processBatchGridFile(bid, file);
      });
    });

    // セル採用チェックボックス変更
    bodyEl.querySelectorAll(".slice-enable-checkbox").forEach((chk) => {
      chk.addEventListener("change", () => {
        const bid = chk.dataset.batchId;
        const idx = Number(chk.dataset.sliceIdx);
        if (localBatchSlices[bid] && localBatchSlices[bid].slices[idx]) {
          localBatchSlices[bid].slices[idx].enabled = chk.checked;
          render();
        }
      });
    });

    // セル割当先カードIDドロップダウン変更
    bodyEl.querySelectorAll(".slice-target-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const bid = sel.dataset.batchId;
        const idx = Number(sel.dataset.sliceIdx);
        if (localBatchSlices[bid] && localBatchSlices[bid].slices[idx]) {
          localBatchSlices[bid].slices[idx].targetId = sel.value;
          localBatchSlices[bid].slices[idx].enabled = Boolean(sel.value);
          render();
        }
      });
    });

    // 個別バッチ反映
    bodyEl.querySelectorAll(".adopt-batch-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bid = btn.dataset.batchId;
        const loc = localBatchSlices[bid];
        if (!loc || !loc.slices) return;

        const payloadSlices = loc.slices.map((s) => ({
          target_id: s.targetId,
          image_base64: s.dataUrl,
          enabled: Boolean(s.enabled && s.targetId),
        }));

        try {
          const res = await api.applyImageBatch(bid, payloadSlices);
          clearCardImageCache();
          statusData = res.status;
          store.updateImageStatus(statusData);
          render();
          showToast(
            `${res.saved_count}枚のイラストをDBおよび data/images/ に保存しました`,
            "success"
          );
        } catch (err) {
          showToast(err.detail || "イラストの保存に失敗しました", "error");
        }
      });
    });

    // アップロード済み全バッチ一括反映
    const adoptAllBtn = bodyEl.querySelector("#adopt-all-batches-btn");
    if (adoptAllBtn) {
      adoptAllBtn.addEventListener("click", async () => {
        let totalSaved = 0;
        for (const b of currentBatches) {
          const loc = localBatchSlices[b.id];
          if (loc && loc.slices && !b.isAdopted) {
            const payloadSlices = loc.slices.map((s) => ({
              target_id: s.targetId,
              image_base64: s.dataUrl,
              enabled: Boolean(s.enabled && s.targetId),
            }));
            const res = await api.applyImageBatch(b.id, payloadSlices);
            totalSaved += res.saved_count || 0;
            statusData = res.status;
          }
        }
        clearCardImageCache();
        store.updateImageStatus(statusData);
        render();
        showToast(
          `合計 ${totalSaved} 枚のイラストを一括保存しました`,
          "success"
        );
      });
    }
  }

  function renderCardsSubMode(bodyEl, { allCards }) {
    const filtered = allCards.filter((c) => {
      if (cardFilterType !== "all" && c.type !== cardFilterType) return false;
      if (cardFilterStatus === "missing" && c.hasImage) return false;
      if (cardFilterStatus === "has_image" && !c.hasImage) return false;
      return true;
    });

    bodyEl.innerHTML = `
      <div class="cards-image-mode-container">
        <div class="list-toolbar" style="margin-bottom:12px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <label>種別:</label>
            <select id="img-card-filter-type" class="form-select form-input-sm" data-testid="img-card-filter-type">
              <option value="all" ${cardFilterType === "all" ? "selected" : ""}>すべて (${allCards.length})</option>
              <option value="避難者" ${cardFilterType === "避難者" ? "selected" : ""}>避難者</option>
              <option value="ペット" ${cardFilterType === "ペット" ? "selected" : ""}>ペット</option>
              <option value="イベント" ${cardFilterType === "イベント" ? "selected" : ""}>イベント</option>
            </select>

            <label>イラスト状態:</label>
            <select id="img-card-filter-status" class="form-select form-input-sm" data-testid="img-card-filter-status">
              <option value="all" ${cardFilterStatus === "all" ? "selected" : ""}>すべて</option>
              <option value="missing" ${cardFilterStatus === "missing" ? "selected" : ""}>未設定のみ</option>
              <option value="has_image" ${cardFilterStatus === "has_image" ? "selected" : ""}>設定済みのみ</option>
            </select>

            <label>カードデザイン:</label>
            <select id="img-card-design-mode" class="form-select form-input-sm" data-testid="img-card-design-mode">
              <option value="standard" ${store.cardDesignMode === "standard" ? "selected" : ""}>標準サイズ</option>
              <option value="largeText" ${store.cardDesignMode === "largeText" ? "selected" : ""}>文字拡大</option>
            </select>
          </div>
          <div>
            <span class="count-badge">表示中: <strong>${filtered.length}枚</strong></span>
          </div>
        </div>

        <div id="img-cards-preview-grid" class="gen-cards-grid" data-testid="img-cards-preview-grid"></div>
      </div>
    `;

    const gridEl = bodyEl.querySelector("#img-cards-preview-grid");
    for (const card of filtered) {
      const itemWrap = document.createElement("div");
      itemWrap.className = "img-card-manage-item";
      const previewEl = renderCardPreviewElement(card, {
        designMode: store.cardDesignMode,
      });
      itemWrap.appendChild(previewEl);

      const controls = document.createElement("div");
      controls.className = "img-card-manage-controls";
      controls.innerHTML = `
        <label class="btn btn-sm btn-secondary" style="cursor:pointer; margin:0;">
          🖼 ${card.hasImage ? "イラスト差替" : "イラスト登録"}
          <input
            type="file"
            accept="image/*"
            class="single-card-img-input"
            data-target-id="${escapeHtml(card.original_id)}"
            data-testid="single-upload-input-${escapeHtml(card.original_id)}"
            style="display:none;"
          />
        </label>
        ${
          card.hasImage
            ? `<button
                type="button"
                class="btn btn-sm btn-danger single-card-img-del"
                data-target-id="${escapeHtml(card.original_id)}"
                data-testid="single-delete-btn-${escapeHtml(card.original_id)}"
              >
                削除
              </button>`
            : ""
        }
      `;
      itemWrap.appendChild(controls);
      gridEl.appendChild(itemWrap);
    }

    bodyEl
      .querySelector("#img-card-filter-type")
      .addEventListener("change", (e) => {
        cardFilterType = e.target.value;
        render();
      });
    bodyEl
      .querySelector("#img-card-filter-status")
      .addEventListener("change", (e) => {
        cardFilterStatus = e.target.value;
        render();
      });
    bodyEl
      .querySelector("#img-card-design-mode")
      .addEventListener("change", (e) => {
        store.cardDesignMode = e.target.value;
        render();
      });

    gridEl.querySelectorAll(".single-card-img-input").forEach((inp) => {
      inp.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        const tid = inp.dataset.targetId;
        if (!file || !tid) return;
        try {
          await api.uploadCardImage(tid, file);
          clearCardImageCache();
          await loadStatus();
          render();
          showToast(`${tid} のイラストを保存しました`, "success");
        } catch (err) {
          showToast(err.detail || "イラストの登録に失敗しました", "error");
        }
      });
    });

    gridEl.querySelectorAll(".single-card-img-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.dataset.targetId;
        if (!tid) return;
        try {
          await api.deleteCardImage(tid);
          clearCardImageCache();
          await loadStatus();
          render();
          showToast(`${tid} のイラストを削除しました`, "success");
        } catch (err) {
          showToast(err.detail || "イラストの削除に失敗しました", "error");
        }
      });
    });
  }

  function bindTopToolbarEvents() {
    container
      .querySelector("#image-submode-batch")
      .addEventListener("click", () => {
        subMode = "batch";
        render();
      });
    container
      .querySelector("#image-submode-cards")
      .addEventListener("click", () => {
        subMode = "cards";
        render();
      });

    container
      .querySelector("#sync-images-btn")
      .addEventListener("click", async () => {
        try {
          statusData = await api.syncImages();
          clearCardImageCache();
          store.updateImageStatus(statusData);
          render();
          const s = statusData.sync || {};
          showToast(
            `フォルダ同期完了 (総数: ${s.total_images ?? 0}件, フォルダ取込: ${s.imported_from_disk ?? 0}件, フォルダ復元: ${s.restored_to_disk ?? 0}件)`,
            "success"
          );
        } catch (err) {
          showToast(err.detail || "同期に失敗しました", "error");
        }
      });

    container
      .querySelector("#export-images-zip-btn")
      .addEventListener("click", async () => {
        try {
          const blob = await api.exportImagesZip();
          triggerBlobDownload(blob, "hug_card_images.zip");
        } catch (err) {
          showToast(err.detail || "イラストZIP出力に失敗しました", "error");
        }
      });

    container
      .querySelector("#import-images-zip-input")
      .addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const res = await api.importImagesZip(file);
          clearCardImageCache();
          statusData = res.status;
          store.updateImageStatus(statusData);
          render();
          showToast(
            `ZIPから ${res.imported_count} 枚のイラストを取り込みました`,
            "success"
          );
        } catch (err) {
          showToast(err.detail || "イラストZIPの取込に失敗しました", "error");
        }
      });
  }

  render();
}
