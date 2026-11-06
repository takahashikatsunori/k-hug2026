/**
 * 全画面1枚ずつカード閲覧モード（訓練モード, UI-21）.
 */
import { escapeHtml } from "../util.js";
import { store } from "../store.js";

let activeTrainingKeyHandler = null;

/**
 * 閲覧モードを閉じる.
 */
export function closeTrainingView() {
  const el = document.getElementById("training-view-overlay");
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
  if (activeTrainingKeyHandler) {
    document.removeEventListener("keydown", activeTrainingKeyHandler);
    activeTrainingKeyHandler = null;
  }
}

/**
 * 閲覧モードを全画面で開く (UI-21).
 * @param {Array<Record<string, any>>} cards
 */
export function openTrainingView(cards) {
  closeTrainingView();
  if (!Array.isArray(cards) || cards.length === 0) {
    return;
  }

  let currentIndex = 0;
  let showTrainingPoint = false;

  const overlay = document.createElement("div");
  overlay.id = "training-view-overlay";
  overlay.className = "training-overlay";
  overlay.setAttribute("data-testid", "training-view");

  document.body.appendChild(overlay);

  const renderSlide = () => {
    const card = cards[currentIndex];
    const total = cards.length;
    const rec = card.data || card.record || {};
    const grp = card.group || null;
    const isEvent = card.kind === "event";
    const isPet = card.kind === "pet";
    const trainingPoint =
      rec.training_point || "（訓練ポイントの記載なし）";

    const jumpOptions = cards
      .map(
        (c, idx) =>
          `<option value="${idx}" ${idx === currentIndex ? "selected" : ""}>No.${c.card_number} (${escapeHtml(c.original_id)})</option>`
      )
      .join("");

    const householdHeaderHtml = !isEvent && grp
      ? `
        <div class="training-household-banner" data-testid="training-household-header">
          <span class="type-pill pill-household">世帯見出し</span>
          <strong>${escapeHtml(card.group_id || grp.group_id || "")}: ${escapeHtml(card.group_name || grp.group_name || "")}</strong>
          <span>（人物 ${escapeHtml(grp.member_count ?? 0)}名 / ペット ${escapeHtml(grp.pet_count ?? 0)}匹 ・ 避難元: ${escapeHtml(grp.evacuation_origin || "-")}）</span>
        </div>
      `
      : "";

    const origId = String(card.original_id || "");
    const hasImg = Boolean(origId && store.imageIds && store.imageIds.has(origId));
    const ver = (store.imageCacheBust && store.imageCacheBust[origId]) || "";
    const imgUrl = hasImg ? `/api/images/${encodeURIComponent(origId)}${ver ? `?v=${ver}` : ""}` : "";
    const illustHtml = hasImg
      ? `<div class="training-illust-wrap"><img src="${escapeHtml(imgUrl)}" alt="" class="training-card-illust" data-testid="training-card-image" /></div>`
      : "";

    const bodyHtml = isEvent
      ? `
        <div class="training-card-box training-card-event">
          <div class="training-card-top">
            <span class="type-pill pill-event">イベント</span>
            <span class="training-orig-id">${escapeHtml(card.original_id)}</span>
            <span class="badge badge-timing">${escapeHtml((rec.relative_timing || []).join("・") || "-")}</span>
            <span class="badge badge-phase">${escapeHtml((rec.disaster_phase || []).join("・") || "-")}</span>
          </div>
          <h2 class="training-card-title" data-testid="training-card-title">${escapeHtml(rec.event_name || card.title || "")}</h2>
          ${illustHtml}
          <div class="training-meta-row">
            <span>発生源: <strong>${escapeHtml(rec.source || "-")}</strong></span>
            <span>種別: ${escapeHtml((rec.category || []).join(" / "))}</span>
          </div>
          ${rec.scene_description ? `<p class="training-scene">${escapeHtml(rec.scene_description)}</p>` : ""}
          <div class="training-main-statement" data-testid="training-card-content">
            ${escapeHtml(rec.content || "")}
          </div>
        </div>
      `
      : `
        <div class="training-card-box ${isPet ? "training-card-pet" : "training-card-person"}">
          <div class="training-card-top">
            <span class="type-pill ${isPet ? "pill-pet" : "pill-person"}">${escapeHtml(rec.data_type || "人物")}</span>
            <span class="training-orig-id">${escapeHtml(card.original_id)}</span>
            <span class="badge">${escapeHtml(rec.relationship || "ペット")}</span>
            <span class="badge">${escapeHtml(rec.age ?? "-")}歳</span>
            <span class="badge">${escapeHtml(rec.gender || "-")}</span>
          </div>
          <h2 class="training-card-title" data-testid="training-card-title">${escapeHtml(rec.name || card.title || "")}</h2>
          ${illustHtml}
          <div class="training-meta-row">
            ${
              isPet
                ? `<span>種別: ${escapeHtml(rec.pet_type || "-")}</span>
                   <span>健康: ${escapeHtml((rec.pet_health_condition || []).join("、") || "-")}</span>
                   <span>配慮: ${escapeHtml((rec.pet_vulnerabilities || []).join("、") || "なし")}</span>`
                : `<span>体調: ${escapeHtml((rec.health_condition || []).join("、") || "-")}</span>
                   <span>配慮特性: ${escapeHtml((rec.vulnerabilities || []).join("、") || "なし")}</span>
                   <span>スキル: ${escapeHtml((rec.skills || []).join("、") || "なし")}</span>`
            }
          </div>
          ${rec.appearance ? `<p class="training-scene">様子: ${escapeHtml(rec.appearance)}</p>` : ""}
          <div class="training-main-statement" data-testid="training-card-content">
            ${escapeHtml(rec.statement || rec.appearance || "")}
          </div>
        </div>
      `;

    overlay.innerHTML = `
      <div class="training-topbar">
        <div class="training-progress-info">
          <strong class="training-counter" data-testid="training-counter">${currentIndex + 1} / ${total}</strong>
          <progress
            class="training-progress"
            data-testid="training-progress-bar"
            value="${currentIndex + 1}"
            max="${total}"
          ></progress>
        </div>
        <div class="training-controls">
          <label for="training-jump-select">カード移動:</label>
          <select id="training-jump-select" class="form-select form-input-sm" data-testid="training-jump-select">
            ${jumpOptions}
          </select>
          <button type="button" class="btn btn-sm" id="training-close-btn" data-testid="training-close-btn">
            閲覧モードを終了
          </button>
        </div>
      </div>

      <div class="training-stage">
        ${householdHeaderHtml}
        ${bodyHtml}

        <div class="training-point-section">
          <button
            type="button"
            class="btn btn-secondary"
            id="training-point-toggle-btn"
            data-testid="training-point-toggle-btn"
          >
            ${showTrainingPoint ? "訓練ポイントを隠す" : "訓練ポイントを表示"}
          </button>
          ${
            showTrainingPoint
              ? `<div class="training-point-box" data-testid="training-point-content">${escapeHtml(trainingPoint)}</div>`
              : ""
          }
        </div>
      </div>

      <div class="training-bottombar">
        <button
          type="button"
          class="btn btn-lg"
          id="training-prev-btn"
          data-testid="training-prev-btn"
          ${currentIndex === 0 ? "disabled" : ""}
        >
          ← 前のカード
        </button>
        <span class="training-hint">キーボードの ← / → キーでも移動できます</span>
        <button
          type="button"
          class="btn btn-lg btn-primary"
          id="training-next-btn"
          data-testid="training-next-btn"
          ${currentIndex === total - 1 ? "disabled" : ""}
        >
          次のカード →
        </button>
      </div>
    `;

    overlay
      .querySelector("#training-close-btn")
      .addEventListener("click", closeTrainingView);

    overlay
      .querySelector("#training-prev-btn")
      .addEventListener("click", () => {
        if (currentIndex > 0) {
          currentIndex -= 1;
          showTrainingPoint = false;
          renderSlide();
        }
      });

    overlay
      .querySelector("#training-next-btn")
      .addEventListener("click", () => {
        if (currentIndex < total - 1) {
          currentIndex += 1;
          showTrainingPoint = false;
          renderSlide();
        }
      });

    overlay
      .querySelector("#training-jump-select")
      .addEventListener("change", (e) => {
        const idx = Number(e.target.value);
        if (!Number.isNaN(idx) && idx >= 0 && idx < total) {
          currentIndex = idx;
          showTrainingPoint = false;
          renderSlide();
        }
      });

    overlay
      .querySelector("#training-point-toggle-btn")
      .addEventListener("click", () => {
        showTrainingPoint = !showTrainingPoint;
        renderSlide();
      });
  };

  activeTrainingKeyHandler = (e) => {
    if (e.key === "ArrowRight") {
      if (currentIndex < cards.length - 1) {
        currentIndex += 1;
        showTrainingPoint = false;
        renderSlide();
      }
    } else if (e.key === "ArrowLeft") {
      if (currentIndex > 0) {
        currentIndex -= 1;
        showTrainingPoint = false;
        renderSlide();
      }
    } else if (e.key === "Escape") {
      closeTrainingView();
    }
  };
  document.addEventListener("keydown", activeTrainingKeyHandler);

  renderSlide();
}
