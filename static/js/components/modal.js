/**
 * 詳細モーダルおよび確認ダイアログコンポーネント (UI-06, UI-10, UI-23).
 */
import { escapeHtml } from "../util.js";
import { api } from "../api.js";
import { store } from "../store.js";

let activeEscHandler = null;

/**
 * 現在開いている詳細モーダルを閉じる.
 */
export function closeDetailModal() {
  const overlay = document.getElementById("detail-modal-overlay");
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
  if (activeEscHandler) {
    document.removeEventListener("keydown", activeEscHandler);
    activeEscHandler = null;
  }
}

/**
 * 値を表示用HTMLに整形する.
 * @param {any} val
 * @returns {string}
 */
function formatFieldValue(val) {
  if (val === null || val === undefined || val === "") {
    return '<span class="text-muted">-</span>';
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '<span class="text-muted">なし</span>';
    return val
      .map((item) => `<span class="badge">${escapeHtml(item)}</span>`)
      .join(" ");
  }
  return escapeHtml(val);
}

/**
 * 詳細モーダルを開く (UI-06).
 * @param {{
 *   kind: "event" | "household" | "member",
 *   id: string,
 *   onEdit?: (kind: "event" | "household", id: string) => void,
 *   onDelete?: (kind: "event" | "household" | "member", id: string) => void,
 *   onExcludeFromDeck?: (unitId: string, name?: string) => Promise<void> | void,
 *   onRestoreToDeck?: (unitId: string, name?: string) => Promise<void> | void,
 *   excludedIdsSet?: Set<string> | null
 * }} params
 */
export async function openDetailModal({
  kind,
  id,
  onEdit,
  onDelete,
  onExcludeFromDeck,
  onRestoreToDeck,
  excludedIdsSet = null,
}) {
  closeDetailModal();

  const overlay = document.createElement("div");
  overlay.id = "detail-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.setAttribute("data-testid", "detail-modal");

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog modal-lg";
  dialog.innerHTML = `<div class="modal-loading">読み込み中...</div>`;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  activeEscHandler = (e) => {
    if (e.key === "Escape") {
      closeDetailModal();
    }
  };
  document.addEventListener("keydown", activeEscHandler);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeDetailModal();
    }
  });

  const schema = store.schema || (await api.getSchema());

  if (kind === "event") {
    const [ev, allEvents] = await Promise.all([
      api.getEvent(id),
      api.listEvents(),
    ]);
    const dependents = (allEvents || []).filter(
      (item) => item.prerequisite_card_id === ev.card_id
    );

    const rowsHtml = (schema.events || [])
      .map((f) => {
        if (f.name === "prerequisite_card_id" && ev.prerequisite_card_id) {
          const pid = ev.prerequisite_card_id;
          return `
            <div class="detail-row">
              <div class="detail-label">${escapeHtml(f.label)} (${escapeHtml(f.name)})</div>
              <div class="detail-value">
                <button type="button" class="btn-link related-card-link" data-target-kind="event" data-target-id="${escapeHtml(pid)}" data-testid="modal-link-${escapeHtml(pid)}">
                  ${escapeHtml(pid)}
                </button>
              </div>
            </div>
          `;
        }
        return `
          <div class="detail-row">
            <div class="detail-label">${escapeHtml(f.label)} (${escapeHtml(f.name)})</div>
            <div class="detail-value">${formatFieldValue(ev[f.name])}</div>
          </div>
        `;
      })
      .join("");

    const depHtml =
      dependents.length > 0
        ? dependents
            .map(
              (d) =>
                `<button type="button" class="btn-link related-card-link" data-target-kind="event" data-target-id="${escapeHtml(d.card_id)}" data-testid="modal-link-${escapeHtml(d.card_id)}">${escapeHtml(d.card_id)}: ${escapeHtml(d.event_name)}</button>`
            )
            .join(" ")
        : '<span class="text-muted">なし</span>';

    const isDeckContext = Boolean(onExcludeFromDeck || onRestoreToDeck);
    const isExcluded = Boolean(excludedIdsSet && excludedIdsSet.has(ev.card_id));
    const footerHtml = isDeckContext
      ? `
        <div class="modal-footer modal-footer-with-note">
          <span class="modal-footer-note">※この操作は現在の訓練デッキの構成のみを変更します（データベース上のカードは削除されません）</span>
          <div class="modal-footer-actions">
            ${
              isExcluded
                ? `<button type="button" class="btn btn-primary" data-action="deck-restore" data-testid="modal-deck-restore-btn">＋ このデッキに戻す</button>`
                : `<button type="button" class="btn btn-outline-danger" data-action="deck-exclude" data-testid="modal-deck-exclude-btn">✕ このデッキから除外（DBには残す）</button>`
            }
            <button type="button" class="btn" data-action="close">閉じる (Esc)</button>
          </div>
        </div>
      `
      : `
        <div class="modal-footer modal-footer-with-note">
          <span class="modal-footer-note">※「データベースから削除」は登録データ自体を消去します（特定のデッキからのみ外す場合は「デッキ構築」タブの「デッキから除外」をご利用ください）</span>
          <div class="modal-footer-actions">
            ${onEdit ? `<button type="button" class="btn btn-secondary" data-action="edit" data-testid="modal-edit-btn">内容を編集</button>` : ""}
            ${onDelete ? `<button type="button" class="btn btn-danger" data-action="delete" data-testid="modal-delete-btn">🗑 データベースから削除</button>` : ""}
            <button type="button" class="btn" data-action="close">閉じる (Esc)</button>
          </div>
        </div>
      `;

    dialog.innerHTML = `
      <div class="modal-header">
        <div>
          <span class="type-pill pill-event">イベント</span>
          <strong class="modal-id" data-testid="modal-record-id">${escapeHtml(ev.card_id)}</strong>
          <h2 class="modal-title" data-testid="modal-title">${escapeHtml(ev.event_name)}</h2>
        </div>
        <button type="button" class="btn btn-icon modal-close-btn" data-testid="modal-close-btn" aria-label="閉じる">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-section">
          <h4>関連カード（このカードを前提としているイベント）</h4>
          <div class="detail-related">${depHtml}</div>
        </div>
        <div class="detail-grid">
          ${rowsHtml}
        </div>
      </div>
      ${footerHtml}
    `;

    bindModalEvents(dialog, {
      kind: "event",
      id: ev.card_id,
      name: ev.event_name,
      onEdit,
      onDelete,
      onExcludeFromDeck,
      onRestoreToDeck,
      excludedIdsSet,
    });
  } else {
    let groupId = id;
    let highlightMemberId = null;
    if (kind === "member") {
      highlightMemberId = id;
      const allHouseholds = await api.listHouseholds();
      const found = (allHouseholds || []).find((h) =>
        (h.members || []).some((m) => m.member_id === id)
      );
      if (found) {
        groupId = found.group.group_id;
      }
    }

    const hh = await api.getHousehold(groupId);
    const grp = hh.group;
    const members = hh.members || [];

    const grpRowsHtml = (schema.groups || [])
      .map(
        (f) => `
        <div class="detail-row">
          <div class="detail-label">${escapeHtml(f.label)} (${escapeHtml(f.name)})</div>
          <div class="detail-value">${formatFieldValue(grp[f.name])}</div>
        </div>
      `
      )
      .join("");

    const membersHtml = members
      .map((m) => {
        const isHighlighted = m.member_id === highlightMemberId;
        const mRows = (schema.members || [])
          .filter((f) => {
            if (
              m.data_type === "人物" &&
              ["pet_type", "pet_health_condition", "pet_vulnerabilities", "pet_skills"].includes(
                f.name
              )
            ) {
              return false;
            }
            return true;
          })
          .map(
            (f) => `
            <div class="detail-row">
              <div class="detail-label">${escapeHtml(f.label)}</div>
              <div class="detail-value">${formatFieldValue(m[f.name])}</div>
            </div>
          `
          )
          .join("");

        return `
          <div class="detail-member-box ${isHighlighted ? "detail-member-highlight" : ""}" id="modal-member-${escapeHtml(m.member_id)}">
            <h5>${escapeHtml(m.member_id)} (${escapeHtml(m.data_type)}) - ${escapeHtml(m.name || "(氏名自動生成)")}</h5>
            <div class="detail-grid">${mRows}</div>
          </div>
        `;
      })
      .join("");

    const isDeckContext = Boolean(onExcludeFromDeck || onRestoreToDeck);
    const isExcluded = Boolean(excludedIdsSet && excludedIdsSet.has(grp.group_id));
    const footerHtml = isDeckContext
      ? `
        <div class="modal-footer modal-footer-with-note">
          <span class="modal-footer-note">※この操作は現在の訓練デッキの構成のみを変更します（データベース上の世帯・構成員は削除されません）</span>
          <div class="modal-footer-actions">
            ${
              isExcluded
                ? `<button type="button" class="btn btn-primary" data-action="deck-restore" data-testid="modal-deck-restore-btn">＋ この世帯をデッキに戻す</button>`
                : `<button type="button" class="btn btn-outline-danger" data-action="deck-exclude" data-testid="modal-deck-exclude-btn">✕ この世帯をデッキから除外（DBには残す）</button>`
            }
            <button type="button" class="btn" data-action="close">閉じる (Esc)</button>
          </div>
        </div>
      `
      : `
        <div class="modal-footer modal-footer-with-note">
          <span class="modal-footer-note">※「世帯をデータベースから削除」は登録データ自体を消去します（特定のデッキからのみ外す場合は「デッキ構築」タブの「デッキから除外」をご利用ください）</span>
          <div class="modal-footer-actions">
            ${onEdit ? `<button type="button" class="btn btn-secondary" data-action="edit" data-testid="modal-edit-btn">世帯を編集</button>` : ""}
            ${onDelete ? `<button type="button" class="btn btn-danger" data-action="delete" data-testid="modal-delete-btn">🗑 世帯をデータベースから削除</button>` : ""}
            <button type="button" class="btn" data-action="close">閉じる (Esc)</button>
          </div>
        </div>
      `;

    dialog.innerHTML = `
      <div class="modal-header">
        <div>
          <span class="type-pill pill-household">世帯</span>
          <strong class="modal-id" data-testid="modal-record-id">${escapeHtml(grp.group_id)}</strong>
          <h2 class="modal-title" data-testid="modal-title">${escapeHtml(grp.group_name)}</h2>
        </div>
        <button type="button" class="btn btn-icon modal-close-btn" data-testid="modal-close-btn" aria-label="閉じる">✕</button>
      </div>
      <div class="modal-body">
        <h4>グループ情報</h4>
        <div class="detail-grid">${grpRowsHtml}</div>
        <h4>世帯構成員 (${members.length}件)</h4>
        <div class="detail-members-container">${membersHtml}</div>
      </div>
      ${footerHtml}
    `;

    bindModalEvents(dialog, {
      kind: "household",
      id: grp.group_id,
      name: grp.group_name,
      onEdit,
      onDelete,
      onExcludeFromDeck,
      onRestoreToDeck,
      excludedIdsSet,
    });
  }
}

function bindModalEvents(
  dialog,
  {
    kind,
    id,
    name,
    onEdit,
    onDelete,
    onExcludeFromDeck,
    onRestoreToDeck,
    excludedIdsSet,
  }
) {
  dialog.querySelectorAll("[data-action='close'], .modal-close-btn").forEach((btn) => {
    btn.addEventListener("click", () => closeDetailModal());
  });

  const editBtn = dialog.querySelector("[data-action='edit']");
  if (editBtn && onEdit) {
    editBtn.addEventListener("click", () => {
      closeDetailModal();
      onEdit(kind, id);
    });
  }

  const delBtn = dialog.querySelector("[data-action='delete']");
  if (delBtn && onDelete) {
    delBtn.addEventListener("click", () => {
      closeDetailModal();
      onDelete(kind, id);
    });
  }

  const deckExcludeBtn = dialog.querySelector("[data-action='deck-exclude']");
  if (deckExcludeBtn && onExcludeFromDeck) {
    deckExcludeBtn.addEventListener("click", async () => {
      closeDetailModal();
      await onExcludeFromDeck(id, name);
    });
  }

  const deckRestoreBtn = dialog.querySelector("[data-action='deck-restore']");
  if (deckRestoreBtn && onRestoreToDeck) {
    deckRestoreBtn.addEventListener("click", async () => {
      closeDetailModal();
      await onRestoreToDeck(id, name);
    });
  }

  dialog.querySelectorAll(".related-card-link").forEach((link) => {
    link.addEventListener("click", () => {
      const targetKind = link.dataset.targetKind || "event";
      const targetId = link.dataset.targetId;
      if (targetId) {
        openDetailModal({
          kind: targetKind,
          id: targetId,
          onEdit,
          onDelete,
          onExcludeFromDeck,
          onRestoreToDeck,
          excludedIdsSet,
        });
      }
    });
  });
}

/**
 * 確認モーダルを開く (UI-10, UI-23).
 * @param {{
 *   title: string,
 *   message: string,
 *   detailsHtml?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   danger?: boolean,
 *   onConfirm: () => Promise<void> | void
 * }} params
 */
export function openConfirmModal({
  title,
  message,
  detailsHtml = "",
  confirmLabel = "確定",
  cancelLabel = "キャンセル",
  danger = false,
  onConfirm,
}) {
  const existing = document.getElementById("confirm-modal-overlay");
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const overlay = document.createElement("div");
  overlay.id = "confirm-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.setAttribute("data-testid", "confirm-modal");

  overlay.innerHTML = `
    <div class="modal-dialog modal-sm">
      <div class="modal-header">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
      </div>
      <div class="modal-body">
        <p>${escapeHtml(message)}</p>
        ${detailsHtml ? `<div class="confirm-details" data-testid="confirm-details">${detailsHtml}</div>` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn" data-testid="confirm-cancel-btn">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-testid="confirm-ok-btn">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  overlay
    .querySelector('[data-testid="confirm-cancel-btn"]')
    .addEventListener("click", close);

  overlay
    .querySelector('[data-testid="confirm-ok-btn"]')
    .addEventListener("click", async () => {
      close();
      if (onConfirm) {
        await onConfirm();
      }
    });
}
