/**
 * 全画面カード閲覧モード（訓練モード, UI-21）.
 * 1枚ずつの送り、および「1世帯分を横並び（横スクロール）でまとめて表示」に対応.
 */
import { escapeHtml } from "../util.js";
import { toCardRenderModel, bindCardCanvasImage } from "../cardCanvas.js";

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
 * カード配列をスライド（イベント1枚、または同一世帯の連続カードまとめ）に分割する.
 * @param {Array<Record<string, any>>} cards
 * @returns {Array<{ isHousehold: boolean, groupId: string|null, group: any, cards: Array<any>, startNo: number, endNo: number }>}
 */
function buildHouseholdSlides(cards) {
  const slides = [];
  for (const card of cards) {
    const isHH = card.kind !== "event" && Boolean(card.group_id);
    const last = slides[slides.length - 1];
    if (isHH && last && last.isHousehold && last.groupId === card.group_id) {
      last.cards.push(card);
      last.endNo = card.card_number;
    } else {
      slides.push({
        isHousehold: isHH,
        groupId: isHH ? card.group_id : null,
        group: card.group || null,
        cards: [card],
        startNo: card.card_number,
        endNo: card.card_number,
      });
    }
  }
  return slides;
}

/**
 * 閲覧モードを全画面で開く.
 * @param {Array<Record<string, any>>} cards
 * @param {{ groupByHousehold?: boolean, initialCardIndex?: number }} [options]
 */
export function openTrainingView(cards, options = {}) {
  closeTrainingView();
  if (!Array.isArray(cards) || cards.length === 0) {
    return;
  }

  // デフォルトで世帯まとめて表示（options で明示的に指定可能）
  let groupByHousehold =
    options.groupByHousehold !== undefined ? Boolean(options.groupByHousehold) : true;

  const slides = groupByHousehold
    ? buildHouseholdSlides(cards)
    : cards.map((c) => ({
        isHousehold: c.kind !== "event" && Boolean(c.group_id),
        groupId: c.group_id || null,
        group: c.group || null,
        cards: [c],
        startNo: c.card_number,
        endNo: c.card_number,
      }));

  let currentSlideIdx = 0;
  if (options.initialCardIndex && options.initialCardIndex > 0) {
    const foundIdx = slides.findIndex(
      (s) => options.initialCardIndex >= s.startNo && options.initialCardIndex <= s.endNo
    );
    if (foundIdx >= 0) currentSlideIdx = foundIdx;
  }

  let showTrainingPoint = false;
  let alwaysShowTrainingPoint = false;

  const overlay = document.createElement("div");
  overlay.id = "training-view-overlay";
  overlay.className = "training-overlay";
  overlay.setAttribute("data-testid", "training-view");

  document.body.appendChild(overlay);

  // スマホ用タッチスワイプ (左右スワイプでスライド送り)
  let touchStartX = null;
  let touchStartY = null;
  overlay.addEventListener(
    "touchstart",
    (e) => {
      // 横スクロール領域内のタッチ操作時はスワイプ送りを抑制
      if (e.target.closest(".training-household-scroll")) return;
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    },
    { passive: true }
  );
  overlay.addEventListener(
    "touchend",
    (e) => {
      if (touchStartX === null || !e.changedTouches || e.changedTouches.length === 0) {
        return;
      }
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - (touchStartY || 0);
      touchStartX = null;
      touchStartY = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0 && currentSlideIdx < slides.length - 1) {
          currentSlideIdx += 1;
          showTrainingPoint = alwaysShowTrainingPoint;
          renderSlide();
        } else if (dx > 0 && currentSlideIdx > 0) {
          currentSlideIdx -= 1;
          showTrainingPoint = alwaysShowTrainingPoint;
          renderSlide();
        }
      }
    },
    { passive: true }
  );

  const renderSlide = () => {
    const slide = slides[currentSlideIdx];
    const totalCards = cards.length;
    const isHH = slide.isHousehold;
    const firstCard = slide.cards[0];
    const rec = firstCard.data || firstCard.record || {};
    const grp = slide.group || firstCard.group || null;

    // ジャンプ先セレクタ
    const jumpOptions = slides
      .map((s, idx) => {
        const noText = s.startNo === s.endNo ? `No.${s.startNo}` : `No.${s.startNo}〜${s.endNo}`;
        const titleText = s.isHousehold
          ? `世帯 ${s.groupId} ${(s.group && s.group.group_name) || ""} (${s.cards.length}名)`
          : (firstCard.data && firstCard.data.event_name) || firstCard.title || "";
        return `<option value="${idx}" ${idx === currentSlideIdx ? "selected" : ""}>${noText}: ${escapeHtml(titleText)}</option>`;
      })
      .join("");

    // 見出し帯（固定高さでカード画像の位置をぶらさない）
    const timingText = Array.isArray(rec.relative_timing) ? rec.relative_timing.join("・") : "";
    const originText = (grp && grp.evacuation_origin) || rec.evacuation_origin || "-";
    const householdTitle = isHH && grp
      ? `${firstCard.group_id || grp.group_id || ""}: ${firstCard.group_name || grp.group_name || ""}（避難元: ${originText} ／ 人物 ${grp.member_count ?? slide.cards.filter(c => c.kind !== "pet").length}名 🐾ペット ${grp.pet_count ?? slide.cards.filter(c => c.kind === "pet").length}匹）`
      : "";

    const householdHeaderHtml = isHH && grp
      ? `
        <div class="training-info-bar training-household-banner" data-testid="training-household-header" title="${escapeHtml(householdTitle)}">
          <span class="type-pill pill-household">世帯一括表示</span>
          <strong>${escapeHtml(firstCard.group_id || grp.group_id || "")}: ${escapeHtml(firstCard.group_name || grp.group_name || "")}</strong>
          <span>（避難元: <strong>${escapeHtml(originText)}</strong> ／ 人物 ${escapeHtml(grp.member_count ?? slide.cards.filter(c => c.kind !== "pet").length)}名 🐾ペット ${escapeHtml(grp.pet_count ?? slide.cards.filter(c => c.kind === "pet").length)}匹）</span>
        </div>
      `
      : `
        <div class="training-info-bar training-event-banner">
          <span class="type-pill">イベント</span>
          <strong>${escapeHtml(rec.event_name || firstCard.title || "")}</strong>
          ${timingText ? `<span>（発生時期: ${escapeHtml(timingText)}）</span>` : ""}
        </div>
      `;

    // カード画像表示エリア: 単一カードまたは世帯複数カードの横並び（横スクロール）
    let stageHtml = "";
    if (slide.cards.length === 1) {
      const c = slide.cards[0];
      const cRec = c.data || c.record || {};
      const titleStr = c.kind === "event" ? cRec.event_name || c.title || "" : cRec.name || c.title || "";
      const contentStr = c.kind === "event" ? cRec.content || "" : cRec.statement || cRec.appearance || "";
      stageHtml = `
        <div class="training-card-box ${c.kind === "event" ? "training-card-event" : c.kind === "pet" ? "training-card-pet" : "training-card-person"} training-card-image-stage">
          <h2 class="training-card-title sr-only" data-testid="training-card-title">${escapeHtml(titleStr)}</h2>
          <div class="training-main-statement sr-only" data-testid="training-card-content">${escapeHtml(contentStr)}</div>
          <div class="training-rendered-card-wrap">
            <img
              alt="${escapeHtml(titleStr || c.original_id)}"
              class="training-rendered-card-img"
              data-testid="training-card-image"
              data-orig-id="${escapeHtml(c.original_id)}"
            />
          </div>
        </div>
      `;
    } else {
      // 1世帯分を横並びでまとめて表示（横スクロール可能）
      const memberCardsHtml = slide.cards
        .map((c) => {
          const cd = c.data || c.record || {};
          const isPet = c.kind === "pet";
          const nameStr = cd.name || c.title || c.original_id;
          return `
            <div class="training-hh-member-col" data-card-no="${c.card_number}">
              <div class="training-hh-member-label">
                <span class="badge" style="background:#0f172a;color:#fff;font-weight:800;font-size:0.75rem;">No.${c.card_number}</span>
                <strong>${isPet ? "🐾" : "👤"} ${escapeHtml(nameStr)}</strong>
                ${cd.relationship ? `<small>（${escapeHtml(cd.relationship)}）</small>` : ""}
              </div>
              <div class="training-hh-card-wrap">
                <img
                  alt="${escapeHtml(nameStr)}"
                  class="training-rendered-card-img training-hh-member-img"
                  data-orig-id="${escapeHtml(c.original_id)}"
                />
              </div>
            </div>
          `;
        })
        .join("");

      stageHtml = `
        <div class="training-rendered-card-wrap training-hh-container">
          <div class="training-household-scroll" id="training-hh-scroll">
            ${memberCardsHtml}
          </div>
        </div>
      `;
    }

    // 訓練ポイント表示
    let pointsHtml = "";
    if (slide.cards.length === 1) {
      const pointStr = rec.training_point || "（訓練ポイントの記載なし）";
      pointsHtml = `<div class="training-point-box" data-testid="training-point-content">${escapeHtml(pointStr)}</div>`;
    } else {
      pointsHtml = `
        <div class="training-point-box training-hh-points-box" data-testid="training-point-content">
          ${slide.cards
            .map((c) => {
              const cd = c.data || c.record || {};
              const pt = cd.training_point || "（記載なし）";
              const isPet = c.kind === "pet";
              return `
                <div class="training-hh-point-row">
                  <span class="training-hh-point-tag">No.${c.card_number} ${isPet ? "🐾" : "👤"}${escapeHtml(cd.name || c.title || "")}:</span>
                  <span class="training-hh-point-body">${escapeHtml(pt)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    // カウンター表記（テストとの互換性のためカード先頭番号を含め、世帯まとめ時は範囲も表示）
    const counterText =
      slide.startNo === slide.endNo
        ? `${slide.startNo} / ${totalCards}`
        : `${slide.startNo}〜${slide.endNo} / ${totalCards} (${currentSlideIdx + 1}/${slides.length}組)`;

    overlay.innerHTML = `
      <div class="training-topbar">
        <div class="training-progress-info">
          <strong class="training-counter" data-testid="training-counter">${escapeHtml(counterText)}</strong>
          <progress
            class="training-progress"
            data-testid="training-progress-bar"
            value="${slide.endNo}"
            max="${totalCards}"
          ></progress>
        </div>
        <div class="training-controls">
          <label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.8rem;color:#cbd5e1;cursor:pointer;margin-right:0.4rem;">
            <input type="checkbox" id="training-group-toggle-chk" ${groupByHousehold ? "checked" : ""} />
            世帯まとめて表示
          </label>
          <label for="training-jump-select">移動:</label>
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
        ${stageHtml}

        <div class="training-point-section">
          <div style="display:flex;align-items:center;justify-content:center;gap:0.75rem;flex-wrap:wrap;">
            <button
              type="button"
              class="btn btn-secondary"
              id="training-point-toggle-btn"
              data-testid="training-point-toggle-btn"
            >
              ${showTrainingPoint ? "訓練ポイントを隠す" : "訓練ポイントを表示"}
            </button>
            <label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.82rem;color:#cbd5e1;cursor:pointer;user-select:none;">
              <input
                type="checkbox"
                id="training-point-always-chk"
                data-testid="training-point-always-chk"
                ${alwaysShowTrainingPoint ? "checked" : ""}
              />
              カード切替時も常に表示
            </label>
          </div>
          ${showTrainingPoint ? pointsHtml : ""}
        </div>
      </div>

      <div class="training-bottombar">
        <button
          type="button"
          class="btn btn-lg"
          id="training-prev-btn"
          data-testid="training-prev-btn"
          ${currentSlideIdx === 0 ? "disabled" : ""}
        >
          ← 前へ
        </button>
        <span class="training-hint">キーボードの ← / → キー、または画面スワイプでも移動できます</span>
        <button
          type="button"
          class="btn btn-lg btn-primary"
          id="training-next-btn"
          data-testid="training-next-btn"
          ${currentSlideIdx === slides.length - 1 ? "disabled" : ""}
        >
          次へ →
        </button>
      </div>
    `;

    // 全カード画像への Canvas レンダリングバインド
    overlay.querySelectorAll(".training-rendered-card-img").forEach((img) => {
      const origId = img.dataset.origId;
      const c = slide.cards.find((x) => x.original_id === origId) || firstCard;
      const model = toCardRenderModel(c, c.group || grp, {
        cardNumber: c.card_number,
      });
      if (model) {
        bindCardCanvasImage(img, model, { showNumber: true });
      }
    });

    // 世帯まとめトグル切り替え
    const groupToggleChk = overlay.querySelector("#training-group-toggle-chk");
    if (groupToggleChk) {
      groupToggleChk.addEventListener("change", (e) => {
        closeTrainingView();
        openTrainingView(cards, {
          groupByHousehold: Boolean(e.target.checked),
          initialCardIndex: slide.startNo,
        });
      });
    }

    overlay
      .querySelector("#training-close-btn")
      .addEventListener("click", closeTrainingView);

    overlay
      .querySelector("#training-prev-btn")
      .addEventListener("click", () => {
        if (currentSlideIdx > 0) {
          currentSlideIdx -= 1;
          showTrainingPoint = alwaysShowTrainingPoint;
          renderSlide();
        }
      });

    overlay
      .querySelector("#training-next-btn")
      .addEventListener("click", () => {
        if (currentSlideIdx < slides.length - 1) {
          currentSlideIdx += 1;
          showTrainingPoint = alwaysShowTrainingPoint;
          renderSlide();
        }
      });

    overlay
      .querySelector("#training-jump-select")
      .addEventListener("change", (e) => {
        const idx = Number(e.target.value);
        if (!Number.isNaN(idx) && idx >= 0 && idx < slides.length) {
          currentSlideIdx = idx;
          showTrainingPoint = alwaysShowTrainingPoint;
          renderSlide();
        }
      });

    overlay
      .querySelector("#training-point-toggle-btn")
      .addEventListener("click", () => {
        showTrainingPoint = !showTrainingPoint;
        renderSlide();
      });

    const alwaysChk = overlay.querySelector("#training-point-always-chk");
    if (alwaysChk) {
      alwaysChk.addEventListener("change", (e) => {
        alwaysShowTrainingPoint = Boolean(e.target.checked);
        if (alwaysShowTrainingPoint && !showTrainingPoint) {
          showTrainingPoint = true;
          renderSlide();
        }
      });
    }
  };

  activeTrainingKeyHandler = (e) => {
    if (e.key === "ArrowRight") {
      if (currentSlideIdx < slides.length - 1) {
        currentSlideIdx += 1;
        showTrainingPoint = alwaysShowTrainingPoint;
        renderSlide();
      }
    } else if (e.key === "ArrowLeft") {
      if (currentSlideIdx > 0) {
        currentSlideIdx -= 1;
        showTrainingPoint = alwaysShowTrainingPoint;
        renderSlide();
      }
    } else if (e.key === "Escape") {
      closeTrainingView();
    }
  };
  document.addEventListener("keydown", activeTrainingKeyHandler);

  renderSlide();
}
