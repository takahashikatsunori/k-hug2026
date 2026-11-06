/**
 * データ入出力・全件削除ビュー (UI-15, UI-25).
 */
import { escapeHtml, triggerBlobDownload } from "../util.js";
import { api } from "../api.js";
import { showToast } from "../components/toast.js";

/**
 * データ入出力ビューを描画する.
 * @param {HTMLElement} container
 * @param {{ onDataChanged: () => Promise<void> }} callbacks
 */
export async function renderIoView(container, callbacks) {
  /** @type {File[]} */
  let selectedFiles = [];

  container.innerHTML = `
    <div class="io-layout" data-testid="io-view">
      <section class="io-card">
        <h3>JSONファイルのインポート（複数ファイル統合・ドライラン対応）</h3>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="import-mode-select">取り込みモード</label>
            <select id="import-mode-select" class="form-select" data-testid="import-mode-select">
              <option value="replace">入れ替え (replace: 既存データを置き換え)</option>
              <option value="append">追加 (append: 既存データの末尾にIDを振り直して追加)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="import-file-input">JSONファイルを選択（複数選択可）</label>
            <input
              type="file"
              id="import-file-input"
              class="form-input"
              multiple
              accept=".json,application/json"
              data-testid="import-file-input"
            />
          </div>
        </div>

        <div id="import-dropzone" class="dropzone" data-testid="import-dropzone">
          ここに JSON ファイルをドラッグ＆ドロップするか、上のファイル選択から選んでください
        </div>

        <div class="io-actions">
          <button type="button" class="btn btn-secondary" id="import-preview-btn" data-testid="import-preview-btn">
            プレビューを確認
          </button>
          <button type="button" class="btn btn-primary" id="import-commit-btn" data-testid="import-commit-btn" disabled>
            インポートを確定して反映
          </button>
        </div>

        <div id="import-preview-box" class="import-preview-box" data-testid="import-preview-box" style="display:none;"></div>
      </section>

      <section class="io-card">
        <h3>デモデータ & 全件エクスポート</h3>
        <div class="io-actions">
          <button type="button" class="btn btn-secondary" id="io-load-demo-btn" data-testid="io-load-demo-btn">
            デモデータ (sample_format2) を読み込む
          </button>
          <button type="button" class="btn" id="io-export-json-btn" data-testid="io-export-json-btn">
            全件 JSON 出力
          </button>
          <button type="button" class="btn" id="io-export-cardcsv-btn" data-testid="io-export-cardcsv-btn">
            全件 カード画像用CSV出力
          </button>
          <button type="button" class="btn" id="io-export-fullcsv-btn" data-testid="io-export-fullcsv-btn">
            全件 全項目CSV (ZIP) 出力
          </button>
        </div>
      </section>

      <section class="io-card io-card-danger">
        <h3>データベースの全件削除</h3>
        <p>カードデータ（イベント・世帯・構成員）をすべて削除します。実行前に自動でバックアップバージョン (<code>auto_clear</code>) が作成されます。</p>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="clear-include-saved-checkbox" data-testid="clear-include-saved-checkbox" />
            保存済み検索・保存済みデッキ条件も同時に削除する
          </label>
        </div>
        <div class="clear-confirm-row">
          <label for="clear-confirm-input">確認のため「<strong>削除</strong>」と入力してください:</label>
          <input
            type="text"
            id="clear-confirm-input"
            class="form-input form-input-sm"
            placeholder="削除"
            data-testid="clear-confirm-input"
          />
          <button
            type="button"
            class="btn btn-danger"
            id="clear-submit-btn"
            data-testid="clear-submit-btn"
            disabled
          >
            全件削除を実行
          </button>
        </div>
      </section>
    </div>
  `;

  const fileInput = container.querySelector("#import-file-input");
  const modeSelect = container.querySelector("#import-mode-select");
  const dropzone = container.querySelector("#import-dropzone");
  const previewBtn = container.querySelector("#import-preview-btn");
  const commitBtn = container.querySelector("#import-commit-btn");
  const previewBox = container.querySelector("#import-preview-box");

  const runDryRun = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      showToast("JSONファイルを選択してください", "warning");
      return;
    }
    try {
      const mode = modeSelect.value;
      const res = await api.importFiles(selectedFiles, mode, true);
      previewBox.style.display = "block";
      commitBtn.disabled = !res.ok;

      const c = res.counts || { events: 0, groups: 0, members: 0 };
      const idMapEntries = Object.entries(res.id_map || {});
      const idMapHtml =
        idMapEntries.length > 0
          ? `<div class="preview-id-map" data-testid="import-preview-id-map">
              <h5>ID対応表 (${idMapEntries.length}件)</h5>
              <div class="id-map-chips">
                ${idMapEntries
                  .map(
                    ([oldId, newId]) =>
                      `<span class="badge">${escapeHtml(oldId)} → ${escapeHtml(newId)}</span>`
                  )
                  .join(" ")}
              </div>
            </div>`
          : `<div data-testid="import-preview-id-map">ID変換なし（そのまま使用）</div>`;

      const formatIssueItem = (item) => {
        if (item && typeof item === "object") {
          const recPart = item.record_id ? `[${escapeHtml(item.record_id)}] ` : "";
          const fieldPart = item.field ? `${escapeHtml(item.field)}: ` : "";
          return `<li>${recPart}${fieldPart}${escapeHtml(item.message || "")}</li>`;
        }
        return `<li>${escapeHtml(item)}</li>`;
      };

      const warningsHtml =
        Array.isArray(res.warnings) && res.warnings.length > 0
          ? `<div class="preview-warnings" data-testid="import-preview-warnings">
              <h5>警告 (${res.warnings.length}件)</h5>
              <ul>${res.warnings.map(formatIssueItem).join("")}</ul>
            </div>`
          : `<div data-testid="import-preview-warnings">警告なし</div>`;

      const errorsHtml =
        Array.isArray(res.errors) && res.errors.length > 0
          ? `<div class="validation-errors-box" data-testid="import-preview-errors">
              <h5>エラー (${res.errors.length}件)</h5>
              <ul>${res.errors.map(formatIssueItem).join("")}</ul>
            </div>`
          : "";

      previewBox.innerHTML = `
        <h4>インポート・プレビュー (${res.ok ? "取り込み可能" : "エラーあり"})</h4>
        <div class="counts-bar" data-testid="import-preview-counts">
          <span class="count-badge">イベント: <strong>${c.events}</strong>件</span>
          <span class="count-badge">グループ: <strong>${c.groups}</strong>件</span>
          <span class="count-badge">構成員: <strong>${c.members}</strong>件</span>
        </div>
        ${idMapHtml}
        ${warningsHtml}
        ${errorsHtml}
      `;
    } catch (err) {
      previewBox.style.display = "block";
      previewBox.innerHTML = `<div class="validation-errors-box">${escapeHtml(err.detail || err.message)}</div>`;
      commitBtn.disabled = true;
    }
  };

  fileInput.addEventListener("change", async () => {
    selectedFiles = Array.from(fileInput.files || []);
    if (selectedFiles.length > 0) {
      dropzone.textContent = `選択中: ${selectedFiles.map((f) => f.name).join(", ")}`;
      await runDryRun();
    }
  });

  modeSelect.addEventListener("change", async () => {
    if (selectedFiles.length > 0) {
      await runDryRun();
    }
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dropzone-active");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dropzone-active");
  });
  dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone-active");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectedFiles = Array.from(e.dataTransfer.files);
      dropzone.textContent = `選択中: ${selectedFiles.map((f) => f.name).join(", ")}`;
      await runDryRun();
    }
  });

  previewBtn.addEventListener("click", runDryRun);

  commitBtn.addEventListener("click", async () => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    try {
      const mode = modeSelect.value;
      const res = await api.importFiles(selectedFiles, mode, false);
      showToast(
        `インポート完了: イベント${res.counts.events}件 / 世帯${res.counts.groups}件 / 構成員${res.counts.members}件`,
        "success"
      );
      commitBtn.disabled = true;
      await callbacks.onDataChanged();
    } catch (err) {
      showToast(err.detail || "インポートに失敗しました", "error");
    }
  });

  // デモ・エクスポート
  container
    .querySelector("#io-load-demo-btn")
    .addEventListener("click", async () => {
      await api.importDemo("replace");
      showToast("デモデータを読み込みました", "success");
      await callbacks.onDataChanged();
    });

  container
    .querySelector("#io-export-json-btn")
    .addEventListener("click", async () => {
      const blob = await api.exportAllJson();
      triggerBlobDownload(blob, "hug_database_all.json");
    });

  container
    .querySelector("#io-export-cardcsv-btn")
    .addEventListener("click", async () => {
      const blob = await api.exportAllCsv("cardcsv");
      triggerBlobDownload(blob, "hug_cards_all.csv");
    });

  container
    .querySelector("#io-export-fullcsv-btn")
    .addEventListener("click", async () => {
      const blob = await api.exportAllCsv("fullcsv");
      triggerBlobDownload(blob, "hug_full_csv_all.zip");
    });

  // 全件削除 (UI-25)
  const clearInput = container.querySelector("#clear-confirm-input");
  const clearBtn = container.querySelector("#clear-submit-btn");
  const includeSavedChk = container.querySelector(
    "#clear-include-saved-checkbox"
  );

  const syncClearButton = () => {
    clearBtn.disabled = clearInput.value !== "削除";
  };
  clearInput.addEventListener("input", syncClearButton);
  clearInput.addEventListener("change", syncClearButton);

  clearBtn.addEventListener("click", async () => {
    if (clearInput.value !== "削除") return;
    try {
      await api.clearAll(clearInput.value, includeSavedChk.checked);
      clearInput.value = "";
      clearBtn.disabled = true;
      showToast("全件削除を実行しました", "success");
      await callbacks.onDataChanged();
    } catch (err) {
      showToast(err.detail || "全件削除に失敗しました", "error");
    }
  });
}
