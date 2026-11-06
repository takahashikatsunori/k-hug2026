/**
 * バージョン管理ビュー (UI-23, UI-24).
 */
import { escapeHtml, formatDateTime, triggerBlobDownload } from "../util.js";
import { api } from "../api.js";
import { openConfirmModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";

/**
 * バージョン管理ビューを描画する.
 * @param {HTMLElement} container
 * @param {{ onDataChanged: () => Promise<void> }} callbacks
 */
export async function renderVersionView(container, callbacks) {
  let currentKindFilter = "";

  container.innerHTML = `
    <div class="version-layout" data-testid="version-view">
      <section class="version-create-card">
        <h3>手動バージョンの作成</h3>
        <div class="version-create-row">
          <input
            type="text"
            id="version-label-input"
            class="form-input"
            placeholder="バージョン名（例: 春季訓練確定版）"
            data-testid="version-label-input"
          />
          <input
            type="text"
            id="version-note-input"
            class="form-input"
            placeholder="メモ（任意）"
            data-testid="version-note-input"
          />
          <button type="button" class="btn btn-primary" id="create-version-btn" data-testid="create-version-btn">
            バージョンを作成
          </button>
        </div>
      </section>

      <div id="version-diff-panel" class="version-diff-panel" data-testid="version-diff-panel" style="display:none;"></div>

      <section class="version-list-card">
        <div class="version-list-header">
          <h3>バージョン履歴一覧</h3>
          <div>
            <label for="version-kind-filter">種別絞り込み:</label>
            <select id="version-kind-filter" class="form-select form-input-sm" data-testid="version-kind-filter">
              <option value="">すべて</option>
              <option value="manual">手動 (manual)</option>
              <option value="auto_import">インポート前 (auto_import)</option>
              <option value="auto_restore">復元前 (auto_restore)</option>
              <option value="auto_clear">全件削除前 (auto_clear)</option>
            </select>
          </div>
        </div>
        <div id="version-list" class="version-list" data-testid="version-list">読み込み中...</div>
      </section>
    </div>
  `;

  const listBox = container.querySelector("#version-list");
  const diffPanel = container.querySelector("#version-diff-panel");
  const kindSelect = container.querySelector("#version-kind-filter");

  async function loadVersions() {
    const versions = await api.listVersions(currentKindFilter);
    if (!versions || versions.length === 0) {
      listBox.innerHTML = `<p class="text-muted">記録されているバージョンはありません。</p>`;
      return;
    }

    listBox.innerHTML = versions
      .map((v) => {
        const c = v.counts || { events: 0, groups: 0, members: 0 };
        return `
          <div class="version-row" data-version-id="${v.id}" data-version-kind="${escapeHtml(v.kind)}" data-testid="version-row-${v.id}">
            <div class="version-info">
              <span class="badge badge-kind-${escapeHtml(v.kind)}" data-testid="version-kind-${v.id}">${escapeHtml(v.kind)}</span>
              <strong class="version-label" data-testid="version-label-${v.id}">${escapeHtml(v.label)}</strong>
              <span class="text-muted">${escapeHtml(formatDateTime(v.created_at))}</span>
              <span class="badge">イベント:${c.events} / 世帯:${c.groups} / 構成員:${c.members}</span>
              ${v.note ? `<p class="version-note">${escapeHtml(v.note)}</p>` : ""}
            </div>
            <div class="version-actions">
              <button type="button" class="btn btn-sm version-diff-btn" data-id="${v.id}" data-testid="version-diff-btn-${v.id}">
                差分を表示
              </button>
              <button type="button" class="btn btn-sm btn-primary version-restore-btn" data-id="${v.id}" data-label="${escapeHtml(v.label)}" data-testid="version-restore-btn-${v.id}">
                復元
              </button>
              <button type="button" class="btn btn-sm version-export-btn" data-id="${v.id}" data-testid="version-export-btn-${v.id}">
                JSON出力
              </button>
              <button type="button" class="btn btn-sm btn-danger version-delete-btn" data-id="${v.id}" data-testid="version-delete-btn-${v.id}">
                削除
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    // 差分表示 (UI-24)
    listBox.querySelectorAll(".version-diff-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        try {
          const diff = await api.diffVersion(id);
          renderDiff(id, diff);
        } catch (err) {
          showToast(err.detail || "差分の取得に失敗しました", "error");
        }
      });
    });

    // 復元 (UI-23)
    listBox.querySelectorAll(".version-restore-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const label = btn.dataset.label || `#${id}`;
        openConfirmModal({
          title: "バージョンの復元確認",
          message: `バージョン「${label}」の状態にデータベースを復元しますか？（現在の状態は auto_restore として自動保存されます）`,
          confirmLabel: "復元を実行",
          onConfirm: async () => {
            try {
              await api.restoreVersion(id);
              showToast(`バージョン「${label}」に復元しました`, "success");
              await callbacks.onDataChanged();
              await loadVersions();
            } catch (err) {
              showToast(err.detail || "復元に失敗しました", "error");
            }
          },
        });
      });
    });

    // JSON出力
    listBox.querySelectorAll(".version-export-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const blob = await api.exportVersion(id);
        triggerBlobDownload(blob, `hug_version_${id}.json`);
      });
    });

    // 削除
    listBox.querySelectorAll(".version-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        await api.deleteVersion(id);
        showToast(`バージョン #${id} を削除しました`, "info");
        await loadVersions();
      });
    });
  }

  function renderDiff(versionId, diff) {
    diffPanel.style.display = "block";
    const renderSection = (title, sec) => {
      if (!sec) return "";
      const added = sec.added || [];
      const removed = sec.deleted || sec.removed || [];
      const modified = sec.modified || [];
      return `
        <div class="diff-section">
          <h5>${escapeHtml(title)}</h5>
          <div>
            <span class="badge badge-match">現在のDBで追加 (${added.length}): ${escapeHtml(added.join(", ") || "なし")}</span>
            <span class="badge badge-exclude">現在のDBで削除 (${removed.length}): ${escapeHtml(removed.join(", ") || "なし")}</span>
            <span class="badge badge-timing">変更 (${modified.length}): ${escapeHtml(
              modified.map((m) => `${m.id}[${(m.fields || []).join(",")}]`).join(", ") ||
                "なし"
            )}</span>
          </div>
        </div>
      `;
    };

    diffPanel.innerHTML = `
      <div class="diff-header">
        <h4>バージョン #${versionId} と現在の状態の差分</h4>
        <button type="button" class="btn btn-xs" id="close-diff-btn">閉じる</button>
      </div>
      ${renderSection("イベント (cards_event)", diff.cards_event)}
      ${renderSection("世帯 (evacuee_groups)", diff.evacuee_groups)}
      ${renderSection("構成員 (group_members)", diff.group_members)}
    `;

    diffPanel.querySelector("#close-diff-btn").addEventListener("click", () => {
      diffPanel.style.display = "none";
    });
  }

  container
    .querySelector("#create-version-btn")
    .addEventListener("click", async () => {
      const labelInp = container.querySelector("#version-label-input");
      const noteInp = container.querySelector("#version-note-input");
      const label = labelInp.value.trim() || "手動スナップショット";
      const note = noteInp.value.trim();
      try {
        await api.createVersion(label, note);
        labelInp.value = "";
        noteInp.value = "";
        showToast(`バージョン「${label}」を作成しました`, "success");
        await loadVersions();
      } catch (err) {
        showToast(err.detail || "バージョン作成に失敗しました", "error");
      }
    });

  kindSelect.addEventListener("change", async () => {
    currentKindFilter = kindSelect.value;
    await loadVersions();
  });

  await loadVersions();
}
