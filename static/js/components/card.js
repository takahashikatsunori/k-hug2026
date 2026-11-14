/**
 * カード描画コンポーネント (イベント / 世帯 / 人物 / ペット).
 */
import { escapeHtml } from "../util.js";
import { store } from "../store.js";
import { toCardRenderModel, bindCardCanvasImage } from "../cardCanvas.js";

/**
 * イベントの必須項目が欠けているか判定する.
 * @param {Record<string, any>} ev
 * @returns {boolean}
 */
export function isEventIncomplete(ev) {
  if (!ev) return true;
  if (!ev.event_name || !String(ev.event_name).trim()) return true;
  if (!Array.isArray(ev.category) || ev.category.length === 0) return true;
  if (ev.priority === null || ev.priority === undefined || ev.priority === "") return true;
  if (!ev.difficulty) return true;
  if (!ev.must_respond) return true;
  if (!ev.content || !String(ev.content).trim()) return true;
  return false;
}

/**
 * 世帯の必須項目が欠けているか判定する.
 * @param {Record<string, any>} grp
 * @param {Array<Record<string, any>>} [members]
 * @returns {boolean}
 */
export function isHouseholdIncomplete(grp, members = []) {
  if (!grp) return true;
  if (!grp.group_name || !String(grp.group_name).trim()) return true;
  if (!grp.evacuation_origin) return true;
  if (!grp.urgency_level) return true;
  if (Array.isArray(members) && members.length > 0) {
    const hasPerson = members.some((m) => m.data_type === "人物");
    if (!hasPerson) return true;
    if (members.some((m) => isMemberIncomplete(m))) return true;
  }
  return false;
}

/**
 * 構成員の必須項目が欠けているか判定する.
 * @param {Record<string, any>} mem
 * @returns {boolean}
 */
export function isMemberIncomplete(mem) {
  if (!mem) return true;
  if (!mem.data_type) return true;
  if (!mem.appearance || !String(mem.appearance).trim()) return true;
  if (!mem.training_point || !String(mem.training_point).trim()) return true;
  if (mem.data_type === "人物" && (!mem.statement || !String(mem.statement).trim())) {
    return true;
  }
  return false;
}

/**
 * 条件の合致・排除バッジHTMLを生成する.
 * @param {Record<string, any>} rec
 * @returns {string}
 */
function renderConditionBadgesHtml(rec) {
  const badges = [];
  const dims = [
    ["disaster_types", "災害"],
    ["infrastructure", "インフラ"],
    ["weather", "天候"],
    ["holiday_type", "休日"],
    ["time_slots", "時間帯"],
    ["shelters", "避難所"],
    ["dates", "日付"],
  ];
  for (const [key, label] of dims) {
    const m = rec[`match_${key}`];
    const x = rec[`exclude_${key}`];
    if (Array.isArray(m) && m.length > 0) {
      for (const val of m) {
        badges.push(
          `<span class="badge badge-match" data-testid="badge-match-${escapeHtml(key)}-${escapeHtml(val)}">合致(${escapeHtml(label)}): ${escapeHtml(val)}</span>`
        );
      }
    } else if (typeof m === "string" && m.trim()) {
      badges.push(
        `<span class="badge badge-match">合致(${escapeHtml(label)}): ${escapeHtml(m)}</span>`
      );
    }
    if (Array.isArray(x) && x.length > 0) {
      for (const val of x) {
        badges.push(
          `<span class="badge badge-exclude" data-testid="badge-exclude-${escapeHtml(key)}-${escapeHtml(val)}">排除(${escapeHtml(label)}): ${escapeHtml(val)}</span>`
        );
      }
    } else if (typeof x === "string" && x.trim()) {
      badges.push(
        `<span class="badge badge-exclude">排除(${escapeHtml(label)}): ${escapeHtml(x)}</span>`
      );
    }
  }
  return badges.join("");
}

/**
 * イベントカードの DOM 要素を生成する（出力予定の完成カード画像をそのまま表示）.
 * @param {Record<string, any>} ev
 * @param {{ onClick?: (ev: Record<string, any>) => void }} [options]
 * @returns {HTMLElement}
 */
export function renderEventCard(ev, options = {}) {
  const el = document.createElement("article");
  const cid = ev.card_id || "PREVIEW";
  el.className = "hug-card card-type-event hug-card-image-layout";
  el.dataset.cardId = cid;
  el.dataset.kind = "event";
  el.setAttribute("data-testid", `card-${cid}`);

  const incomplete = isEventIncomplete(ev);
  const hasImg = Boolean(cid && cid !== "PREVIEW" && store.imageIds && store.imageIds.has(cid));
  const timings = Array.isArray(ev.relative_timing)
    ? ev.relative_timing.join("・")
    : ev.relative_timing || "中盤";
  const phases = Array.isArray(ev.disaster_phase)
    ? ev.disaster_phase.join("・")
    : ev.disaster_phase || "-";
  const condHtml = renderConditionBadgesHtml(ev);
  const cardModel = toCardRenderModel(ev);

  el.innerHTML = `
    <div class="card-canvas-wrap">
      <img
        alt="${escapeHtml(ev.event_name || cid)}"
        class="card-canvas-preview-img"
        ${hasImg ? `data-testid="card-thumb-${escapeHtml(cid)}"` : ""}
      />
    </div>
    <div class="card-meta-footer">
      <h3 class="card-title sr-only">${escapeHtml(ev.event_name || "(イベント名未入力)")}</h3>
      <div class="card-header-left">
        <span class="card-id">${escapeHtml(cid)}</span>
        ${incomplete ? '<span class="badge badge-incomplete" data-testid="badge-incomplete">要入力</span>' : ""}
        ${hasImg ? `<span class="badge badge-has-image" data-testid="badge-has-image-${escapeHtml(cid)}">🎨イラスト済</span>` : ""}
        <span class="badge badge-priority">優先度:${escapeHtml(ev.priority ?? "-")}</span>
        <span class="badge badge-timing">${escapeHtml(timings)}</span>
        <span class="badge badge-phase">${escapeHtml(phases)}</span>
        ${ev.prerequisite_card_id ? `<span class="badge badge-prereq">前提: ${escapeHtml(ev.prerequisite_card_id)}</span>` : ""}
      </div>
      ${condHtml ? `<div class="card-badges">${condHtml}</div>` : ""}
    </div>
  `;

  const imgEl = el.querySelector(".card-canvas-preview-img");
  if (imgEl && cardModel) {
    bindCardCanvasImage(imgEl, cardModel, { showNumber: false });
  }

  if (options.onClick) {
    el.addEventListener("click", () => options.onClick(ev));
  }
  return el;
}

/**
 * 世帯カードの DOM 要素を生成する（構成員ごとの出力予定カード画像を並べて表示）.
 * @param {Record<string, any>} grp
 * @param {Array<Record<string, any>>} [members]
 * @param {{ onClick?: (grp: Record<string, any>) => void }} [options]
 * @returns {HTMLElement}
 */
export function renderHouseholdCard(grp, members = [], options = {}) {
  const el = document.createElement("article");
  const gid = grp.group_id || "PREVIEW";
  el.className = "hug-card card-type-household hug-card-household-image-layout";
  el.dataset.groupId = gid;
  el.dataset.kind = "household";
  el.setAttribute("data-testid", `card-${gid}`);

  const incomplete = isHouseholdIncomplete(grp, members);
  const timings = Array.isArray(grp.relative_timing)
    ? grp.relative_timing.join("・")
    : grp.relative_timing || "中盤";
  const phases = Array.isArray(grp.disaster_phase)
    ? grp.disaster_phase.join("・")
    : grp.disaster_phase || "-";
  const condHtml = renderConditionBadgesHtml(grp);

  el.innerHTML = `
    <div class="card-header">
      <div class="card-header-left">
        <span class="type-pill pill-household">世帯</span>
        <span class="card-id">${escapeHtml(gid)}</span>
        <h3 class="card-title" style="margin:0;display:inline;font-size:1rem;">${escapeHtml(grp.group_name || "(グループ名未入力)")}</h3>
        ${incomplete ? '<span class="badge badge-incomplete" data-testid="badge-incomplete">要入力</span>' : ""}
      </div>
      <div class="card-header-right">
        <span class="meta-item">人物: <strong>${escapeHtml(grp.member_count ?? 0)}名</strong> / ペット: <strong>${escapeHtml(grp.pet_count ?? 0)}匹</strong></span>
        <span class="badge badge-priority">${escapeHtml(grp.urgency_level || "-")}</span>
        <span class="badge badge-timing">${escapeHtml(timings)}</span>
        <span class="badge badge-phase">${escapeHtml(phases)}</span>
      </div>
    </div>
    ${
      (grp.personal_equipment && grp.personal_equipment.length > 0) || condHtml
        ? `<div class="card-badges">
            ${(grp.personal_equipment || []).map((eq) => `<span class="badge">${escapeHtml(eq)}</span>`).join("")}
            ${condHtml}
          </div>`
        : ""
    }
    <div class="household-members-card-grid"></div>
  `;

  const membersGrid = el.querySelector(".household-members-card-grid");
  const memberList = members || [];
  const totalInHousehold = memberList.length;
  for (let i = 0; i < memberList.length; i++) {
    const m = memberList[i];
    const mModel = toCardRenderModel(m, grp, {
      groupIndex: i + 1,
      groupTotal: totalInHousehold,
    });
    const mid = m.member_id || "PREVIEW";
    const mWrap = document.createElement("div");
    mWrap.className = "household-member-card-item";
    mWrap.innerHTML = `
      <div class="card-canvas-wrap">
        <img
          alt="${escapeHtml(m.name || mid)}"
          class="card-canvas-preview-img"
        />
      </div>
    `;
    const mImg = mWrap.querySelector(".card-canvas-preview-img");
    if (mImg && mModel) {
      bindCardCanvasImage(mImg, mModel, { showNumber: false });
    }
    membersGrid.appendChild(mWrap);
  }

  if (options.onClick) {
    el.addEventListener("click", () => options.onClick(grp));
  }
  return el;
}

/**
 * 構成員 (人物 / ペット) カードの DOM 要素を生成する（出力予定の完成カード画像をそのまま表示）.
 * @param {Record<string, any>} mem
 * @param {Record<string, any>} [grp]
 * @param {{ onClick?: (mem: Record<string, any>) => void }} [options]
 * @returns {HTMLElement}
 */
export function renderMemberCard(mem, grp = {}, options = {}) {
  const isPet = mem.data_type === "ペット";
  const mid = mem.member_id || "PREVIEW";
  const el = document.createElement("article");
  el.className = `hug-card ${isPet ? "card-type-pet" : "card-type-person"} hug-card-image-layout`;
  el.dataset.memberId = mid;
  el.dataset.groupId = mem.group_id || (grp && grp.group_id) || "";
  el.dataset.kind = isPet ? "pet" : "person";
  el.setAttribute("data-testid", `card-${mid}`);

  const incomplete = isMemberIncomplete(mem);
  const hasImg = Boolean(mid && mid !== "PREVIEW" && store.imageIds && store.imageIds.has(mid));
  const cardModel = toCardRenderModel(mem, grp, {
    groupIndex: options.groupIndex,
    groupTotal: options.groupTotal,
  });

  el.innerHTML = `
    <div class="card-canvas-wrap">
      <img
        alt="${escapeHtml(mem.name || mid)}"
        class="card-canvas-preview-img"
        ${hasImg ? `data-testid="card-thumb-${escapeHtml(mid)}"` : ""}
      />
    </div>
    <div class="card-meta-footer">
      <h3 class="card-title sr-only">${escapeHtml(mem.name || "(氏名自動生成)")}</h3>
      <div class="card-header-left">
        <span class="card-id">${escapeHtml(mid)}</span>
        <span class="badge">${escapeHtml(mem.group_id || "")} ${escapeHtml((grp && grp.group_name) || "")}</span>
        ${incomplete ? '<span class="badge badge-incomplete" data-testid="badge-incomplete">要入力</span>' : ""}
        ${hasImg ? `<span class="badge badge-has-image" data-testid="badge-has-image-${escapeHtml(mid)}">🎨イラスト済</span>` : ""}
      </div>
    </div>
  `;

  const imgEl = el.querySelector(".card-canvas-preview-img");
  if (imgEl && cardModel) {
    bindCardCanvasImage(imgEl, cardModel, { showNumber: false });
  }

  if (options.onClick) {
    el.addEventListener("click", () => options.onClick(mem));
  }
  return el;
}
