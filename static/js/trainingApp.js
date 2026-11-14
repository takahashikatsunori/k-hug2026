/**
 * HUG (避難所運営ゲーム) 訓練実行アプリケーション
 * 明るいクリーム色調 (Warm Cream Theme)
 * カルーセル＆スポットライト方式・全画面カードサムネイルギャラリー・イラスト完全描画
 */
import { escapeHtml } from "./util.js";
import { store } from "./store.js";
import {
  toCardRenderModel,
  bindCardCanvasImage,
  computeGroupPositionsByIndex,
  computeGroupPositionMap,
} from "./cardCanvas.js";
import {
  buildAllDatabaseCardEntries,
  buildInitialDeck,
  importDeckFromJsonText,
  renumberDeckCards,
} from "./webDeckEngine.js";

const LOGO_IMG_ATTRS = `src="./static/logo/正式ロゴ.jpeg" onerror="if(!this.dataset.fb1){this.dataset.fb1='1';this.src='./static/logo/official_logo.jpeg';}else if(!this.dataset.fb2){this.dataset.fb2='1';this.src='./logo/正式ロゴ.jpeg';}"`;

// ============================================================================
// Web Audio API サウンドシステム
// ============================================================================
class TrainingAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.55;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playCardFlip() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1500, now);
    filter.frequency.exponentialRampToValueAtTime(450, now + 0.08);
    filter.Q.value = 2.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    whiteNoise.start(now);
  }

  playEventAlert() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const startTime = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.09);

      const noteStart = startTime + idx * 0.09;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(this.volume * 0.55, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.38);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteStart);
      osc.stop(noteStart + 0.38);
    });
  }

  playHouseholdChime() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 440.0]; // D5 -> A4
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.18);

      const noteStart = now + idx * 0.18;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(this.volume * 0.45, noteStart + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.55);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteStart);
      osc.stop(noteStart + 0.55);
    });
  }

  playCountdownBeep(isFinal = false) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    if (isFinal) {
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(this.volume * 0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.start(now);
      osc.stop(now + 0.32);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      gain.gain.setValueAtTime(this.volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }
    osc.connect(gain);
    gain.connect(this.ctx.destination);
  }

  playFanfare() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const chordNotes = [
      { f: 523.25, t: 0.0, d: 0.2 },
      { f: 659.25, t: 0.15, d: 0.2 },
      { f: 783.99, t: 0.3, d: 0.2 },
      { f: 1046.5, t: 0.45, d: 0.9 },
      { f: 1318.51, t: 0.45, d: 0.9 },
    ];
    const now = this.ctx.currentTime;
    chordNotes.forEach(({ f, t, d }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + t);
      gain.gain.setValueAtTime(this.volume * 0.5, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + d);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + d);
    });
  }
}

const sfx = new TrainingAudio();

// ============================================================================
// アプリケーション状態
// ============================================================================
const appState = {
  db: null,
  rawDeckCards: [], // 全カード配列
  deckTitle: "読み込み待ち",
  deckSourceInfo: "",
  deckConditions: {},

  // 設定
  groupByHousehold: true,
  mode: "manual",
  timerSeconds: 45,
  soundEnabled: true,

  // 実行状態
  phase: "setup", // 'setup' | 'running' | 'completed'
  slides: [], // スライド配列
  currentSlideIdx: -1, // -1: 開始前, 0〜: 現在のスライド
  maxOpenedSlideIdx: -1, // 最大到達スライド
  activeCardNo: null, // 現在フォーカスしているカード番号（←/→キーナビゲーション用）

  // タイマー
  elapsedSeconds: 0,
  elapsedTimerId: null,
  autoTimerRemaining: 45,
  autoTimerId: null,
  isPaused: false,

  // UI状態
  showPointsPopup: false,
  showGalleryModal: false,
};

// ============================================================================
// データベース初期化＆イラスト情報セットアップ
// ============================================================================
function initDatabaseContext(db) {
  if (!db) return;
  appState.db = db;
  store.schema = db.schema || {};
  store.imageIds = new Set(db.image_ids || []);
  const imageMeta = db.image_meta || {};
  store.resolveImageUrl = (origId, ver = "") => {
    const meta = imageMeta[origId];
    const ext = (meta && meta.ext) || ".png";
    const q = ver ? `?v=${encodeURIComponent(ver)}` : "";
    return `./data/images/${encodeURIComponent(origId)}${ext}${q}`;
  };
}

async function loadCardDatabase() {
  const candidates = ["./data/cards_db.json", "/data/cards_db.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) {
        const db = await res.json();
        initDatabaseContext(db);
        return db;
      }
    } catch {
      // try next
    }
  }
  return null;
}

// ============================================================================
// カード配列のスライド化
// ============================================================================
function buildSlides(cards, groupByHousehold) {
  if (!groupByHousehold) {
    return cards.map((c, i) => ({
      index: i,
      isHousehold: c.kind !== "event" && Boolean(c.group_id),
      groupId: c.group_id || null,
      group: c.group || null,
      cards: [c],
      startNo: c.card_number,
      endNo: c.card_number,
      title: c.kind === "event" ? (c.data?.event_name || c.title || "イベント") : (c.data?.name || c.title || "避難者"),
    }));
  }

  const slides = [];
  for (const card of cards) {
    const isHH = card.kind !== "event" && Boolean(card.group_id);
    const last = slides[slides.length - 1];
    if (isHH && last && last.isHousehold && last.groupId === card.group_id) {
      last.cards.push(card);
      last.endNo = card.card_number;
    } else {
      slides.push({
        index: slides.length,
        isHousehold: isHH,
        groupId: isHH ? card.group_id : null,
        group: card.group || null,
        cards: [card],
        startNo: card.card_number,
        endNo: card.card_number,
        title: isHH
          ? `${card.group_id || ""} ${card.group?.group_name || card.group_name || "世帯"} (${card.group?.evacuation_origin || "避難元不明"})`
          : (card.data?.event_name || card.title || "イベント"),
      });
    }
  }
  return slides;
}

// ============================================================================
// 各種デッキのロード処理
// ============================================================================
export async function loadDeckFromJsonFile(file) {
  const text = await file.text();
  return loadDeckFromJsonString(text, file.name);
}

function annotateDeckGroupPositions(cards) {
  const posList = computeGroupPositionsByIndex(cards);
  return (cards || []).map((c, idx) => {
    const pos = posList[idx];
    if (!pos) return c;
    return {
      ...c,
      group_index: pos.group_index,
      group_total: pos.group_total,
    };
  });
}

export function loadDeckFromJsonString(jsonString, sourceName = "JSONファイル") {
  try {
    let result;
    if (appState.db) {
      result = importDeckFromJsonText(jsonString, appState.db);
    } else {
      const parsed = JSON.parse(jsonString);
      const cards = parsed.cards || parsed.deck_cards || parsed.cards_event || [];
      result = {
        deckCards: annotateDeckGroupPositions(
          cards.map((c, i) => {
            const rawData = c.data || c;
            const grp = c.group || null;
            const gid = c.group_id || rawData.group_id || grp?.group_id || null;
            return {
              card_number: c.card_number || i + 1,
              original_id: c.card_id || c.original_id || rawData.member_id || `C-${i + 1}`,
              kind: c.kind || (c.event_id ? "event" : rawData.data_type === "ペット" ? "pet" : "person"),
              data: rawData,
              group_id: gid,
              group_name: c.group_name || grp?.group_name || null,
              group: grp,
            };
          })
        ),
        matchedCount: cards.length,
      };
    }

    if (!result.deckCards || result.deckCards.length === 0) {
      throw new Error("有効なカードが見つかりませんでした");
    }

    appState.rawDeckCards = result.deckCards;
    appState.deckTitle = sourceName.replace(/\.json$/i, "");
    appState.deckSourceInfo = `JSONファイル読み込み (${result.deckCards.length}枚)`;
    appState.deckConditions = result.restoredConditions || {};
    showSetupDeckLoaded();
  } catch (err) {
    alert(`デッキの読み込みに失敗しました: ${err.message}`);
  }
}

export function loadDeckFromLocalStorage() {
  const raw = localStorage.getItem("hug_web_deck_state_v1");
  if (!raw) {
    alert("現在ブラウザに保存されたデッキ情報はありません。Webツールでデッキを作成するか、JSONファイルを指定してください。");
    return false;
  }
  try {
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.cardOrigIds) || saved.cardOrigIds.length === 0) {
      alert("保存されたデッキカードが見つかりませんでした。");
      return false;
    }
    if (!appState.db) {
      alert("カードデータベースの読み込み中です。しばらくしてから再度お試しください。");
      return false;
    }

    const allDbCards = buildAllDatabaseCardEntries(appState.db);
    const dbCardByOrigId = new Map(allDbCards.map((c) => [c.original_id, c]));
    const originOverrides = saved.originOverrides || saved.conditions?.origin_overrides || {};

    const entries = [];
    for (const oid of saved.cardOrigIds) {
      const dbEntry = dbCardByOrigId.get(String(oid));
      if (dbEntry) {
        const d = structuredClone(dbEntry.data);
        const grp = dbEntry.group ? structuredClone(dbEntry.group) : null;
        const overrideOrigin = originOverrides[String(dbEntry.group_id)];
        if (overrideOrigin) {
          if (grp) grp.evacuation_origin = overrideOrigin;
          if (d) d.evacuation_origin = overrideOrigin;
        }
        entries.push({
          original_id: dbEntry.original_id,
          kind: dbEntry.kind,
          unit_id: dbEntry.unit_id,
          group_id: dbEntry.group_id,
          group_name: dbEntry.group_name,
          data: d,
          group: grp,
        });
      }
    }

    appState.rawDeckCards = renumberDeckCards(entries, appState.db);
    appState.deckTitle = "Webツール作成デッキ";
    appState.deckSourceInfo = `ブラウザ一時保存より読み込み (${appState.rawDeckCards.length}枚)`;
    appState.deckConditions = saved.conditions || {};
    showSetupDeckLoaded();
    return true;
  } catch (err) {
    alert(`保存デッキの復元に失敗しました: ${err.message}`);
    return false;
  }
}

export async function fetchServerSavedDecks() {
  try {
    const res = await fetch("/api/decks");
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch {
    // GitHub Pages 等では静的 JSON 内の saved_decks にフォールバック
  }
  return Array.isArray(appState.db?.saved_decks) ? appState.db.saved_decks : [];
}

export async function loadDeckFromServerSavedDeck(deckId) {
  try {
    let detail = null;
    try {
      const res = await fetch(`/api/decks/${deckId}`);
      if (res.ok) detail = await res.json();
    } catch {
      // 静的環境フォールバック
    }
    if (!detail && Array.isArray(appState.db?.saved_decks)) {
      detail = appState.db.saved_decks.find((d) => String(d.id) === String(deckId)) || null;
    }
    if (!detail) throw new Error("保存デッキ情報を取得できませんでした");

    const cond = detail.conditions || {};
    if (appState.db) {
      const built = buildInitialDeck(appState.db, cond, {
        phaseFirst: false,
        resolutions: detail.resolutions || {},
        manualOrder: detail.manual_order || null,
        excludedIds: Array.isArray(cond.excluded_ids) ? cond.excluded_ids : [],
      });
      appState.rawDeckCards = built.cardEntries || [];
    } else {
      const buildRes = await fetch("/api/deck/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions: cond,
          resolutions: detail.resolutions || {},
          manual_order: detail.manual_order || [],
        }),
      });
      if (!buildRes.ok) throw new Error("デッキの再構築に失敗しました");
      const built = await buildRes.json();
      const cards = built.deck?.cards || built.cards || [];
      appState.rawDeckCards = annotateDeckGroupPositions(
        cards.map((c, i) => ({
          card_number: c.card_number || i + 1,
          original_id: c.original_id || c.card_id,
          kind: c.kind,
          data: c.data || c,
          group: c.group || null,
          group_id: c.group_id,
          group_name: c.group_name,
          group_index: c.group_index,
          group_total: c.group_total,
        }))
      );
    }

    appState.deckTitle = detail.name || `保存デッキ #${deckId}`;
    appState.deckSourceInfo = `保存済みデッキより読み込み (${appState.rawDeckCards.length}枚)`;
    appState.deckConditions = cond;
    showSetupDeckLoaded();
  } catch (err) {
    alert(`保存デッキの取得に失敗しました: ${err.message}`);
  }
}

// ============================================================================
// セットアップ画面表示
// ============================================================================
function showSetupDeckLoaded() {
  const container = document.getElementById("tr-loaded-deck-container");
  if (!container) return;

  const totalCards = appState.rawDeckCards.length;
  const events = appState.rawDeckCards.filter((c) => c.kind === "event");
  const households = new Set(
    appState.rawDeckCards.filter((c) => c.kind !== "event" && c.group_id).map((c) => c.group_id)
  );
  const persons = appState.rawDeckCards.filter((c) => c.kind === "person");
  const pets = appState.rawDeckCards.filter((c) => c.kind === "pet");

  container.innerHTML = `
    <div class="tr-loaded-deck-panel" data-testid="tr-loaded-deck-section">
      <div class="tr-loaded-summary">
        <div>
          <div class="tr-deck-name-badge">🃏 ${escapeHtml(appState.deckTitle)}</div>
          <div style="font-size:0.85rem;color:var(--tr-text-muted);margin-top:0.25rem;">
            ${escapeHtml(appState.deckSourceInfo)}
          </div>
        </div>
        <div class="tr-badges-wrap">
          <span class="tr-badge tr-badge-main" data-testid="stat-total-cards">合計 <strong>${totalCards}</strong> 枚</span>
          <span class="tr-badge tr-badge-event">⚡ イベント <strong>${events.length}</strong></span>
          <span class="tr-badge tr-household">🏠 避難世帯 <strong>${households.size}</strong> 組 (👤 ${persons.length}名 🐾 ${pets.length}匹)</span>
        </div>
      </div>

      <!-- 訓練前オプション設定 -->
      <div class="tr-config-grid">
        <div class="tr-config-item">
          <label class="tr-config-title"><span>🔄</span> めくり単位の選択</label>
          <div class="tr-radio-box-group">
            <label class="tr-radio-pill ${appState.groupByHousehold ? "active" : ""}" data-target="group-unit">
              <input type="radio" name="opt-unit" value="group" ${appState.groupByHousehold ? "checked" : ""} />
              <span>🏠 世帯をまとめる（推奨）</span>
            </label>
            <label class="tr-radio-pill ${!appState.groupByHousehold ? "active" : ""}" data-target="single-unit">
              <input type="radio" name="opt-unit" value="single" ${!appState.groupByHousehold ? "checked" : ""} />
              <span>👤 1枚ずつ</span>
            </label>
          </div>
          <small style="color:var(--tr-text-muted);font-size:0.75rem;">
            「世帯をまとめる」を選ぶと、家族全員のカードに同時にスポットライトが当たります。
          </small>
        </div>

        <div class="tr-config-item">
          <label class="tr-config-title"><span>⏱️</span> カード送りのタイミング</label>
          <div class="tr-radio-box-group">
            <label class="tr-radio-pill ${appState.mode === "manual" ? "active" : ""}" data-target="mode-manual">
              <input type="radio" name="opt-mode" value="manual" ${appState.mode === "manual" ? "checked" : ""} />
              <span>✋ 手動でめくる</span>
            </label>
            <label class="tr-radio-pill ${appState.mode === "auto" ? "active" : ""}" data-target="mode-auto">
              <input type="radio" name="opt-mode" value="auto" ${appState.mode === "auto" ? "checked" : ""} />
              <span>⏰ 自動（タイマー）</span>
            </label>
          </div>
          <div id="tr-timer-select-wrap" style="display:${appState.mode === "auto" ? "flex" : "none"};gap:0.5rem;align-items:center;">
            <span style="font-size:0.8rem;color:#475569;">自動めくり間隔:</span>
            <select id="tr-timer-sec-select" class="tr-btn tr-btn-sm" style="background:#ffffff;">
              <option value="20" ${appState.timerSeconds === 20 ? "selected" : ""}>20秒 (スピード重視)</option>
              <option value="30" ${appState.timerSeconds === 30 ? "selected" : ""}>30秒</option>
              <option value="45" ${appState.timerSeconds === 45 ? "selected" : ""}>45秒 (標準)</option>
              <option value="60" ${appState.timerSeconds === 60 ? "selected" : ""}>60秒 (じっくり)</option>
              <option value="90" ${appState.timerSeconds === 90 ? "selected" : ""}>90秒</option>
              <option value="120" ${appState.timerSeconds === 120 ? "selected" : ""}>120秒 (2分)</option>
            </select>
          </div>
        </div>

        <div class="tr-config-item">
          <label class="tr-config-title"><span>🔊</span> 効果音・エンタメ演出</label>
          <label style="display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem;color:#334155;">
            <input type="checkbox" id="tr-sound-toggle-chk" ${appState.soundEnabled ? "checked" : ""} />
            効果音を鳴らす（めくり音・警報音・チャイム）
          </label>
          <small style="color:var(--tr-text-muted);font-size:0.75rem;">
            Web Audio APIにより完全オフライン・会場の音響環境でも動作します。
          </small>
        </div>
      </div>

      <!-- デッキカード一覧テーブル -->
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:0.95rem;color:#334155;">📋 デッキに含まれるカード一覧（${totalCards}枚）</h3>
          <span style="font-size:0.78rem;color:var(--tr-text-muted);">カルーセル形式で常時カードが並び、順次スポットライトが当たります</span>
        </div>
        <div class="tr-card-preview-table-wrap">
          <table class="tr-preview-table">
            <thead>
              <tr>
                <th style="width:60px;">No.</th>
                <th style="width:90px;">種別</th>
                <th>カード見出し / 氏名</th>
                <th>避難元 / 発生時期</th>
                <th>訓練ポイント</th>
              </tr>
            </thead>
            <tbody>
              ${appState.rawDeckCards
                .map((c) => {
                  const d = c.data || {};
                  const isEv = c.kind === "event";
                  const isPet = c.kind === "pet";
                  const title = isEv ? d.event_name || c.title || "-" : d.name || c.title || "-";
                  const originOrTiming = isEv
                    ? (Array.isArray(d.relative_timing) ? d.relative_timing.join("・") : "-")
                    : (c.group?.evacuation_origin || d.evacuation_origin || "-");
                  const pt = d.training_point || "-";
                  return `
                    <tr>
                      <td><strong>${c.card_number}</strong></td>
                      <td>
                        <span class="tr-badge ${isEv ? "tr-badge-event" : "tr-badge-household"}" style="font-size:0.72rem;padding:0.15rem 0.4rem;">
                          ${isEv ? "⚡ イベント" : isPet ? "🐾 ペット" : "👤 避難者"}
                        </span>
                      </td>
                      <td><strong>${escapeHtml(title)}</strong></td>
                      <td style="color:#64748b;">${escapeHtml(originOrTiming)}</td>
                      <td style="color:#334155;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(pt)}">
                        ${escapeHtml(pt)}
                      </td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div style="display:flex;justify-content:center;padding-top:0.5rem;">
        <button
          type="button"
          class="tr-btn tr-btn-lg tr-btn-success"
          id="tr-start-training-btn"
          data-testid="tr-start-training-btn"
          style="min-width:300px;font-size:1.25rem;font-weight:800;"
        >
          🚀 訓練を開始する
        </button>
      </div>
    </div>
  `;

  // イベントバインド
  const unitRadios = container.querySelectorAll("input[name='opt-unit']");
  unitRadios.forEach((r) => {
    r.addEventListener("change", (e) => {
      appState.groupByHousehold = e.target.value === "group";
      container.querySelectorAll(".tr-radio-pill[data-target*='unit']").forEach((pill) => {
        pill.classList.remove("active");
      });
      e.target.closest(".tr-radio-pill").classList.add("active");
    });
  });

  const modeRadios = container.querySelectorAll("input[name='opt-mode']");
  const timerWrap = container.querySelector("#tr-timer-select-wrap");
  modeRadios.forEach((r) => {
    r.addEventListener("change", (e) => {
      appState.mode = e.target.value;
      container.querySelectorAll(".tr-radio-pill[data-target*='mode']").forEach((pill) => {
        pill.classList.remove("active");
      });
      e.target.closest(".tr-radio-pill").classList.add("active");
      if (timerWrap) timerWrap.style.display = appState.mode === "auto" ? "flex" : "none";
    });
  });

  const timerSelect = container.querySelector("#tr-timer-sec-select");
  if (timerSelect) {
    timerSelect.addEventListener("change", (e) => {
      appState.timerSeconds = Number(e.target.value);
    });
  }

  const soundChk = container.querySelector("#tr-sound-toggle-chk");
  if (soundChk) {
    soundChk.addEventListener("change", (e) => {
      appState.soundEnabled = Boolean(e.target.checked);
      sfx.enabled = appState.soundEnabled;
    });
  }

  const startBtn = container.querySelector("#tr-start-training-btn");
  if (startBtn) {
    startBtn.addEventListener("click", startTraining);
  }

  container.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============================================================================
// 訓練実行ステージの初期化
// ============================================================================
function startTraining() {
  if (!appState.rawDeckCards || appState.rawDeckCards.length === 0) {
    alert("デッキが読み込まれていません。");
    return;
  }

  sfx.init();

  appState.slides = buildSlides(appState.rawDeckCards, appState.groupByHousehold);
  appState.currentSlideIdx = -1; // 開始前
  appState.maxOpenedSlideIdx = -1;
  appState.phase = "running";
  appState.elapsedSeconds = 0;
  appState.isPaused = false;
  appState.autoTimerRemaining = appState.timerSeconds;
  appState.showPointsPopup = false;
  appState.showGalleryModal = false;

  document.body.classList.remove("is-setup");

  if (appState.elapsedTimerId) clearInterval(appState.elapsedTimerId);
  appState.elapsedTimerId = setInterval(() => {
    if (!appState.isPaused && appState.phase === "running") {
      appState.elapsedSeconds++;
      updateElapsedTimerDisplay();
    }
  }, 1000);

  setupCarouselArenaDOM();

  if (appState.mode === "auto") {
    startAutoTimer();
  }
}

// ============================================================================
// カルーセル＆スポットライト DOMの初期化
// ============================================================================
function setupCarouselArenaDOM() {
  const main = document.getElementById("tr-main");
  if (!main) return;

  // カルーセルカード要素の生成
  const carouselCardsHtml = appState.rawDeckCards
    .map((c) => `
      <div
        class="tr-carousel-card is-back"
        id="tr-card-slot-${c.card_number}"
        data-card-no="${c.card_number}"
        data-orig-id="${escapeHtml(c.original_id)}"
      >
        <!-- カード裏面 (公式ロゴ入り山札デザイン) -->
        <div class="tr-card-face-down-inner">
          <div class="tr-card-back-frame">
            <div class="tr-card-back-header">避難所運営ゲーム</div>
            <div class="tr-card-back-logo-wrap">
              <img ${LOGO_IMG_ATTRS} alt="HUGロゴ" class="tr-card-back-logo-img" />
            </div>
            <div class="tr-card-back-title">HUG CARD</div>
            <div class="tr-card-back-no">No.${c.card_number}</div>
          </div>
        </div>

        <!-- 表面 (画像) -->
        <img
          class="tr-carousel-card-img"
          data-orig-id="${escapeHtml(c.original_id)}"
          data-card-no="${c.card_number}"
          alt="No.${c.card_number}"
          style="display:none;"
        />
        <div class="tr-carousel-card-badge">No.${c.card_number}</div>
      </div>
    `)
    .join("");

  main.innerHTML = `
    <div class="tr-arena-layout" data-testid="tr-stage-view">
      <!-- 1. トップバー -->
      <header class="tr-arena-topbar" data-testid="tr-status-bar">
        <div class="tr-arena-top-left">
          <div class="tr-arena-brand-tag">
            <img ${LOGO_IMG_ATTRS} alt="HUGロゴ" class="tr-arena-brand-logo" />
            <span class="tr-arena-brand-label">HUG訓練</span>
          </div>
          <div class="tr-progress-counter" data-testid="tr-progress-counter">
            <span class="accent" id="tr-hdr-current-no">-</span>
            <span class="tr-progress-total">/ 全${appState.rawDeckCards.length}枚</span>
          </div>

          <div class="tr-progress-bar-wrap" title="訓練進行度">
            <div class="tr-progress-bar-fill" id="tr-progress-fill" style="width:0%;"></div>
          </div>

          <span class="sr-only" id="tr-progress-text" data-testid="tr-progress-text">訓練開始待ち（全カード裏返し）</span>
          <progress id="tr-progress-bar" data-testid="tr-progress-bar" value="0" max="${appState.rawDeckCards.length}" style="display:none;"></progress>

          <div class="tr-arena-timer" title="経過時間">
            <span class="tr-hide-mobile">⏱️</span>
            <span id="tr-elapsed-text">00:00:00</span>
          </div>
        </div>

        <div class="tr-arena-top-right">
          ${
            appState.mode === "auto"
              ? `
              <div class="tr-auto-timer-pill" id="tr-auto-timer-pill">
                <span class="tr-hide-mobile" style="font-size:0.8rem;color:var(--tr-text-muted);">⏰ タイマー:</span>
                <span class="tr-auto-timer-sec" id="tr-auto-sec-val">${appState.autoTimerRemaining}秒</span>
                <button type="button" class="tr-btn tr-btn-sm" id="tr-timer-pause-btn" style="padding:0.2rem 0.45rem;">
                  ⏸️
                </button>
                <button type="button" class="tr-btn tr-btn-sm" id="tr-timer-plus-btn" style="padding:0.2rem 0.45rem;" title="+30秒延長">
                  +30秒
                </button>
              </div>
            `
              : ""
          }

          <button
            type="button"
            class="tr-btn tr-btn-sm tr-btn-primary"
            id="tr-open-history-btn"
            data-testid="tr-open-history-btn"
            title="全画面サムネイル一覧で表示済みカードを一覧・確認"
          >
            📋 <span class="tr-hide-mobile">表示済み</span>一覧 (<span id="tr-opened-count-badge">0</span>)
          </button>

          <button
            type="button"
            class="tr-btn tr-btn-sm"
            id="tr-return-latest-btn"
            title="最新の進行位置にカルーセルを戻す"
            style="display:none;"
          >
            🎯 最新<span class="tr-hide-mobile">へ</span>
          </button>

          <button
            type="button"
            class="tr-btn tr-btn-sm tr-hide-mobile"
            id="tr-toggle-fullscreen-btn"
            title="全画面シアター表示 (F11)"
          >
            ⛶ 全画面
          </button>

          <button
            type="button"
            class="tr-btn tr-btn-sm tr-btn-danger"
            id="tr-exit-training-btn"
            title="訓練を終了して戻る"
          >
            ✕ 終了
          </button>
        </div>
      </header>

      <!-- 2. 見出しバナーバー -->
      <div class="tr-stage-banner-row">
        <div id="tr-stage-banner-wrap" class="tr-stage-banner-wrap">
          <!-- 待機中の表示 -->
          <div class="tr-stage-banner tr-stage-banner-waiting" id="tr-card-back" data-testid="tr-card-back">
            <img ${LOGO_IMG_ATTRS} alt="HUGロゴ" style="width:24px;height:24px;object-fit:contain;border-radius:4px;flex-shrink:0;" />
            <span style="font-weight:700;">全カード裏返しの状態です。「最初のカードをめくる」で訓練を開始してください</span>
          </div>
        </div>
      </div>

      <!-- 3. カルーセル・アリーナ -->
      <main class="tr-carousel-arena" id="tr-carousel-arena" data-testid="tr-card-arena">
        <!-- 左右ナビゲーション矢印ボタン -->
        <button type="button" class="tr-carousel-nav-btn tr-carousel-nav-prev" id="tr-carousel-prev-btn" title="左へスクロール" aria-label="前へ">
          ◀
        </button>
        <button type="button" class="tr-carousel-nav-btn tr-carousel-nav-next" id="tr-carousel-next-btn" title="右へスクロール" aria-label="次へ">
          ▶
        </button>

        <!-- 水平スクロールトラック -->
        <div class="tr-carousel-track-wrap" id="tr-carousel-track" data-testid="tr-card-front">
          ${carouselCardsHtml}
        </div>

        <!-- 訓練ポイントポップアップ -->
        <div class="tr-point-popup" id="tr-point-popup" style="display:none;">
          <div class="tr-point-popup-header">
            <div class="tr-point-popup-title">💡 指導者・進行役用 訓練ポイント</div>
            <button type="button" class="tr-btn tr-btn-sm" id="tr-close-point-popup-btn">✕ 閉じる</button>
          </div>
          <div class="tr-point-popup-body" id="tr-point-popup-body"></div>
        </div>
      </main>

      <!-- 4. 操作フッターバー -->
      <footer class="tr-arena-bottombar" data-testid="tr-controls-bar">
        <button
          type="button"
          class="tr-btn tr-btn-lg tr-prev-main-btn"
          id="tr-prev-card-btn"
          data-testid="tr-prev-card-btn"
          disabled
        >
          ← <span class="tr-hide-mobile">前のカードへ</span><span class="tr-show-mobile">前へ</span>
        </button>

        <div class="tr-arena-bottom-center">
          <button
            type="button"
            class="tr-btn tr-btn-lg tr-btn-primary tr-next-main-btn"
            id="tr-next-card-btn"
            data-testid="tr-next-card-btn"
          >
            🃏 最初のカードをめくる！
          </button>

          <button
            type="button"
            class="tr-btn tr-point-toggle-btn"
            id="tr-toggle-point-btn"
            data-testid="tr-toggle-point-btn"
            title="訓練ポイントの表示切替 (Tキー)"
          >
            💡<span class="tr-hide-mobile"> 訓練ポイント</span><span class="tr-show-mobile"> ポイント</span>
          </button>

          <div class="tr-keyboard-hint" data-testid="tr-keyboard-hint">
            <span>[Space/Enter] 世帯送り</span>
            <span>・</span>
            <span>[← / →] 1枚移動</span>
          </div>
        </div>

        <div class="tr-arena-bottom-right">
          <button
            type="button"
            class="tr-btn tr-btn-sm"
            id="tr-sound-btn"
            title="効果音のON/OFF"
          >
            ${appState.soundEnabled ? "🔊<span class='tr-hide-mobile'> 音ON</span>" : "🔇<span class='tr-hide-mobile'> 音OFF</span>"}
          </button>
        </div>
      </footer>

      <!-- 5. 全画面サムネイルギャラリーモーダル -->
      <div class="tr-gallery-modal" id="tr-gallery-modal" style="display:none;">
        <div class="tr-gallery-header">
          <div class="tr-gallery-title">📋 表示済みカード一覧（クリックで拡大確認）</div>
          <div class="tr-gallery-header-actions">
            <button type="button" class="tr-btn tr-btn-sm tr-btn-primary" id="tr-gallery-jump-latest-btn">
              🎯 最新<span class="tr-hide-mobile">のカード</span>へ戻る
            </button>
            <button type="button" class="tr-btn tr-btn-sm" id="tr-close-gallery-btn">
              ✕ 閉じる
            </button>
          </div>
        </div>
        <div class="tr-gallery-grid" id="tr-gallery-grid"></div>
      </div>

      <!-- 6. 拡大ライトボックスモーダル -->
      <div class="tr-lightbox-overlay" id="tr-lightbox-overlay" style="display:none;">
        <div class="tr-lightbox-card">
          <img class="tr-lightbox-img" id="tr-lightbox-img" alt="拡大プレビュー" />
          <div class="tr-lightbox-actions">
            <button type="button" class="tr-btn tr-btn-primary tr-btn-lg" id="tr-lightbox-select-btn">
              🎯 このカードの位置に戻る
            </button>
            <button type="button" class="tr-btn tr-btn-lg" id="tr-lightbox-close-btn">
              ✕ 閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindCarouselArenaEvents();
  updateCarouselSpotlight(false);
}

// ============================================================================
// モバイルビューポート判定（幅768px以下は1枚表示モード）
// ============================================================================
export function isMobileViewport() {
  return Boolean(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
}

// ============================================================================
// カルーセルのスポットライト＆スクロール更新
// ============================================================================
function updateCarouselSpotlight(scrollIntoView = true) {
  const isStarted = appState.currentSlideIdx >= 0;
  const currentSlide = isStarted ? appState.slides[appState.currentSlideIdx] : null;
  const isMobile = isMobileViewport();

  const prevBtn = document.getElementById("tr-prev-card-btn");
  const nextBtn = document.getElementById("tr-next-card-btn");
  const hdrCurrentNo = document.getElementById("tr-hdr-current-no");
  const progressFill = document.getElementById("tr-progress-fill");
  const progressText = document.getElementById("tr-progress-text");
  const progressBar = document.getElementById("tr-progress-bar");
  const openedBadge = document.getElementById("tr-opened-count-badge");
  const bannerWrap = document.getElementById("tr-stage-banner-wrap");
  const returnLatestBtn = document.getElementById("tr-return-latest-btn");

  if (openedBadge) {
    openedBadge.textContent = String(Math.max(0, appState.maxOpenedSlideIdx + 1));
  }

  // 「最新へ」ボタンの表示制御
  if (returnLatestBtn) {
    returnLatestBtn.style.display =
      isStarted && appState.currentSlideIdx < appState.maxOpenedSlideIdx ? "inline-flex" : "none";
  }

  // 開始前（全カード裏返し）
  if (!isStarted || !currentSlide) {
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.innerHTML = "🃏 最初のカードをめくる！";
    if (hdrCurrentNo) hdrCurrentNo.textContent = "-";
    if (progressFill) progressFill.style.width = "0%";
    if (progressText) progressText.textContent = "訓練開始待ち（全カード裏返し）";
    if (progressBar) progressBar.value = 0;
    return;
  }

  // 番号＆進行状況
  const totalCards = appState.rawDeckCards.length;
  const isSingle = currentSlide.startNo === currentSlide.endNo;
  const noStr = isSingle ? `No.${currentSlide.startNo}` : `No.${currentSlide.startNo}〜${currentSlide.endNo}`;
  if (hdrCurrentNo) hdrCurrentNo.textContent = noStr;
  const ratio = Math.min(100, Math.round((currentSlide.endNo / totalCards) * 100));
  if (progressFill) progressFill.style.width = `${ratio}%`;
  if (progressBar) progressBar.value = currentSlide.endNo;
  if (progressText) {
    progressText.textContent = `カード ${noStr} / 全${totalCards}枚 (${appState.currentSlideIdx + 1}/${appState.slides.length})`;
  }

  // 見出しバナー更新
  const isHH = currentSlide.isHousehold;
  const firstCard = currentSlide.cards[0];
  const rec = firstCard.data || {};
  const grp = currentSlide.group || firstCard.group || null;
  const totalInSlide = currentSlide.cards.length;
  const activeNo = appState.activeCardNo || currentSlide.startNo;
  const activeIdxInSlide = Math.max(0, currentSlide.cards.findIndex((c) => c.card_number === activeNo));

  if (bannerWrap) {
    if (isHH && grp) {
      const origin = grp.evacuation_origin || rec.evacuation_origin || "市外";
      const memberCount = grp.member_count ?? currentSlide.cards.filter((c) => c.kind !== "pet").length;
      const petCount = grp.pet_count ?? currentSlide.cards.filter((c) => c.kind === "pet").length;
      const stepBadgeHtml =
        totalInSlide > 1
          ? `<span class="tr-member-step-badge" id="tr-member-step-badge">${activeIdxInSlide + 1}/${totalInSlide}枚目</span>`
          : "";
      bannerWrap.innerHTML = `
        <div class="tr-stage-banner is-household" data-testid="tr-household-header">
          <div class="tr-stage-banner-main">
            <span class="tr-badge tr-badge-household">🏠 避難世帯</span>
            <span class="tr-stage-banner-title">${escapeHtml(grp.group_id || firstCard.group_id || "")}: ${escapeHtml(grp.group_name || firstCard.group_name || "世帯")}</span>
            ${stepBadgeHtml}
          </div>
          <div class="tr-stage-banner-meta">
            避難元: <strong>${escapeHtml(origin)}</strong> ｜ 👤 <strong>${memberCount}名</strong> 🐾 <strong>${petCount}匹</strong>
          </div>
        </div>
      `;
    } else {
      const isEvent = firstCard.kind === "event";
      const title = isEvent ? rec.event_name || firstCard.title : rec.name || firstCard.title;
      const timing = Array.isArray(rec.relative_timing) ? rec.relative_timing.join("・") : "";
      bannerWrap.innerHTML = `
        <div class="tr-stage-banner ${isEvent ? "is-event" : "is-household"}" data-testid="tr-event-header">
          <div class="tr-stage-banner-main">
            <span class="tr-badge ${isEvent ? "tr-badge-event" : "tr-badge-household"}">
              ${isEvent ? "⚡ イベント" : firstCard.kind === "pet" ? "🐾 ペット" : "👤 避難者"}
            </span>
            <span class="tr-stage-banner-title">No.${firstCard.card_number}: ${escapeHtml(title || "")}</span>
          </div>
          ${timing ? `<div class="tr-stage-banner-meta">発生時期: <strong>${escapeHtml(timing)}</strong></div>` : ""}
        </div>
      `;
    }
  }

  // ボタン状態更新
  updateControlButtonsState();

  // 各カードスロットのクラス・画像更新
  const spotlightCardNos = new Set(currentSlide.cards.map((c) => c.card_number));
  const maxOpenedCardNo = appState.slides[appState.maxOpenedSlideIdx].endNo;

  appState.rawDeckCards.forEach((c) => {
    const slot = document.getElementById(`tr-card-slot-${c.card_number}`);
    if (!slot) return;

    const backInner = slot.querySelector(".tr-card-face-down-inner");
    const img = slot.querySelector(".tr-carousel-card-img");

    slot.className = "tr-carousel-card";

    if (spotlightCardNos.has(c.card_number)) {
      // スポットライト（現在フォーカス中）
      slot.classList.add("is-spotlight");
      if (backInner) backInner.style.display = "none";
      if (img) {
        img.style.display = "block";
        bindCardImageIfNeeded(img, c);
      }
    } else if (c.card_number <= maxOpenedCardNo) {
      // 過去にオープン済み（陰で薄暗い）
      slot.classList.add("is-past");
      if (backInner) backInner.style.display = "none";
      if (img) {
        img.style.display = "block";
        bindCardImageIfNeeded(img, c);
      }
    } else {
      // 未オープン（裏返し）
      slot.classList.add("is-back");
      if (backInner) backInner.style.display = "flex";
      if (img) img.style.display = "none";
    }
  });

  // スクロールを対象カードに合わせる
  if (scrollIntoView) {
    let targetCardNo = currentSlide.startNo;
    if (!isMobile && currentSlide.cards && currentSlide.cards.length >= 4) {
      // PC横並び表示時のみ：4名以上のグループにスポットライトが当たったときは先頭の人が中央で止まると後ろの人が切れるため、
      // 自動で1マスか2マススクロール（4名は1マス進めたカード、5名以上は2マス進めたカードを中央配置）
      const offsetIndex = currentSlide.cards.length === 4 ? 1 : 2;
      const midCard = currentSlide.cards[Math.min(offsetIndex, currentSlide.cards.length - 1)];
      if (midCard) {
        targetCardNo = midCard.card_number;
      }
    }
    scrollCardSlotIntoView(targetCardNo);
  }

  // 訓練ポイントポップアップの中身を更新
  updatePointsPopupContent(currentSlide, appState.activeCardNo);
}

// ============================================================================
// 下部操作ボタンおよび世帯内枚数バッジの同期
// ============================================================================
function updateControlButtonsState() {
  const isStarted = appState.currentSlideIdx >= 0;
  const currentSlide = isStarted ? appState.slides[appState.currentSlideIdx] : null;
  if (!isStarted || !currentSlide) return;

  const isMobile = isMobileViewport();
  const prevBtn = document.getElementById("tr-prev-card-btn");
  const nextBtn = document.getElementById("tr-next-card-btn");
  const stepBadge = document.getElementById("tr-member-step-badge");
  const hdrCurrentNo = document.getElementById("tr-hdr-current-no");

  const activeNo = appState.activeCardNo || currentSlide.startNo;
  const totalInSlide = currentSlide.cards.length;
  const idxInSlide = currentSlide.cards.findIndex((c) => c.card_number === activeNo);

  if (stepBadge && totalInSlide > 1) {
    const displayIdx = idxInSlide >= 0 ? idxInSlide + 1 : 1;
    stepBadge.textContent = `${displayIdx}/${totalInSlide}枚目`;
  }

  // トップバーの番号表示
  if (hdrCurrentNo) {
    const isSingle = currentSlide.startNo === currentSlide.endNo;
    hdrCurrentNo.textContent = isSingle
      ? `No.${currentSlide.startNo}`
      : `No.${currentSlide.startNo}〜${currentSlide.endNo}`;
  }

  if (prevBtn) {
    if (isMobile) {
      prevBtn.disabled = appState.currentSlideIdx === 0 && activeNo <= 1;
    } else {
      prevBtn.disabled = appState.currentSlideIdx === 0;
    }
  }

  if (nextBtn) {
    if (isMobile && totalInSlide > 1 && activeNo >= currentSlide.startNo && activeNo < currentSlide.endNo) {
      const nextStepIdx = idxInSlide >= 0 ? idxInSlide + 2 : 2;
      nextBtn.innerHTML = `次のメンバー (${nextStepIdx}/${totalInSlide}) →`;
    } else if (appState.currentSlideIdx < appState.slides.length - 1) {
      nextBtn.innerHTML = "次のカードをめくる →";
    } else {
      nextBtn.innerHTML = "🎉 訓練完了！";
    }
  }
}

// ============================================================================
// カードスロットへのスムーズスクロール
// ============================================================================
export function scrollCardSlotIntoView(cardNo) {
  const slot = document.getElementById(`tr-card-slot-${cardNo}`);
  if (slot) {
    slot.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

// ============================================================================
// カード個別フォーカス処理（←/→キー・スマホ1枚送り操作時）
// ============================================================================
export function highlightSingleCard(cardNo) {
  appState.activeCardNo = cardNo;
  document.querySelectorAll(".tr-carousel-card.is-single-focused").forEach((el) => {
    el.classList.remove("is-single-focused");
  });
  const slot = document.getElementById(`tr-card-slot-${cardNo}`);
  if (slot) {
    slot.classList.add("is-single-focused");
  }
  scrollCardSlotIntoView(cardNo);
  updateControlButtonsState();

  if (appState.currentSlideIdx >= 0) {
    updatePointsPopupContent(appState.slides[appState.currentSlideIdx], cardNo);
  }
}

// ============================================================================
// カード画像のCanvasレンダリングバインド
// ============================================================================
function bindCardImageIfNeeded(imgEl, card) {
  if (!imgEl.dataset.rendered) {
    imgEl.dataset.rendered = "true";
    const posMap = computeGroupPositionMap(appState.rawDeckCards);
    const pos = posMap.get(String(card.original_id || ""));
    const model = toCardRenderModel(card, card.group, {
      cardNumber: card.card_number,
      imageIds: store.imageIds,
      groupIndex: pos?.group_index ?? card.group_index,
      groupTotal: pos?.group_total ?? card.group_total,
    });
    if (model) {
      bindCardCanvasImage(imgEl, model, { showNumber: true });
    }
  }
}

// ============================================================================
// 訓練ポイントの内容更新（個別フォーカス連動）
// ============================================================================
function updatePointsPopupContent(currentSlide, focusedCardNo = null) {
  const body = document.getElementById("tr-point-popup-body");
  if (!body || !currentSlide) return;

  const isHH = currentSlide.isHousehold;
  if (isHH) {
    body.innerHTML = currentSlide.cards
      .map((c) => {
        const pt = c.data?.training_point || "（特記なし）";
        const isPet = c.kind === "pet";
        const isFocused = focusedCardNo === c.card_number;
        return `
          <div style="margin-bottom:0.75rem;padding:0.4rem 0.5rem;border-radius:6px;border-bottom:1px solid #e2e8f0;background:${isFocused ? "#eff6ff" : "transparent"};">
            <div style="font-weight:700;color:${isFocused ? "#1d4ed8" : "#1e40af"};margin-bottom:0.2rem;display:flex;align-items:center;justify-content:space-between;">
              <span>No.${c.card_number} ${isPet ? "🐾" : "👤"} ${escapeHtml(c.data?.name || c.title || "")}</span>
              ${isFocused ? '<span style="font-size:0.7rem;background:#2563eb;color:#ffffff;padding:0.1rem 0.4rem;border-radius:4px;">選択中</span>' : ""}
            </div>
            <div style="color:#1e293b;">${escapeHtml(pt)}</div>
          </div>
        `;
      })
      .join("");
  } else {
    const c = currentSlide.cards[0];
    const pt = c.data?.training_point || "（特記なし）";
    body.innerHTML = `
      <div style="color:#1e293b;font-size:1rem;line-height:1.6;">
        ${escapeHtml(pt)}
      </div>
    `;
  }
}

// ============================================================================
// カルーセルアリーナ イベントリスナー
// ============================================================================
function bindCarouselArenaEvents() {
  const nextBtn = document.getElementById("tr-next-card-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (isMobileViewport() && appState.currentSlideIdx >= 0) {
        const currentSlide = appState.slides[appState.currentSlideIdx];
        const activeNo = appState.activeCardNo || currentSlide?.startNo || 0;
        if (currentSlide && activeNo >= currentSlide.startNo && activeNo < currentSlide.endNo) {
          advanceSingleCard();
          return;
        }
      }
      advanceNextCard();
    });
  }

  const prevBtn = document.getElementById("tr-prev-card-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (isMobileViewport() && appState.currentSlideIdx >= 0) {
        stepBackSingleCard();
        return;
      }
      stepBackPreviousCard();
    });
  }

  // カルーセル左右スクロール矢印
  const navPrev = document.getElementById("tr-carousel-prev-btn");
  const navNext = document.getElementById("tr-carousel-next-btn");
  const track = document.getElementById("tr-carousel-track");

  if (navPrev && track) {
    navPrev.addEventListener("click", () => {
      if (isMobileViewport() && appState.currentSlideIdx >= 0) {
        stepBackSingleCard();
      } else {
        track.scrollBy({ left: -320, behavior: "smooth" });
      }
    });
  }
  if (navNext && track) {
    navNext.addEventListener("click", () => {
      if (isMobileViewport() && appState.currentSlideIdx >= 0) {
        advanceSingleCard();
      } else {
        track.scrollBy({ left: 320, behavior: "smooth" });
      }
    });
  }

  // カルーセルカードの直接クリックでジャンプ
  if (track) {
    track.addEventListener("click", (e) => {
      const cardSlot = e.target.closest(".tr-carousel-card");
      if (!cardSlot) return;
      const cardNo = Number(cardSlot.dataset.cardNo);
      if (!Number.isNaN(cardNo)) {
        const slideIdx = appState.slides.findIndex(
          (s) => cardNo >= s.startNo && cardNo <= s.endNo
        );
        if (slideIdx >= 0 && slideIdx <= appState.maxOpenedSlideIdx) {
          jumpToSlide(slideIdx);
          highlightSingleCard(cardNo);
        } else if (appState.currentSlideIdx === -1) {
          advanceNextCard();
        }
      }
    });

    // スマホ横スワイプ時に中央に来たカードを検出してステータス同期
    let scrollSyncTimer = null;
    track.addEventListener(
      "scroll",
      () => {
        if (!isMobileViewport() || appState.currentSlideIdx < 0) return;
        if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
        scrollSyncTimer = setTimeout(() => {
          const trackRect = track.getBoundingClientRect();
          const centerX = trackRect.left + trackRect.width / 2;
          const currentSlide = appState.slides[appState.currentSlideIdx];
          if (!currentSlide) return;

          let closestNo = null;
          let minDist = Infinity;
          currentSlide.cards.forEach((c) => {
            const slot = document.getElementById(`tr-card-slot-${c.card_number}`);
            if (!slot) return;
            const rect = slot.getBoundingClientRect();
            const slotCenter = rect.left + rect.width / 2;
            const dist = Math.abs(slotCenter - centerX);
            if (dist < minDist) {
              minDist = dist;
              closestNo = c.card_number;
            }
          });
          if (closestNo !== null && closestNo !== appState.activeCardNo) {
            appState.activeCardNo = closestNo;
            updateControlButtonsState();
            updatePointsPopupContent(currentSlide, closestNo);
          }
        }, 120);
      },
      { passive: true }
    );

    // ドラッグスクロール
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    track.addEventListener("mousedown", (e) => {
      isDown = true;
      startX = e.pageX - track.offsetLeft;
      scrollLeft = track.scrollLeft;
    });
    track.addEventListener("mouseleave", () => { isDown = false; });
    track.addEventListener("mouseup", () => { isDown = false; });
    track.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - track.offsetLeft;
      const walk = (x - startX) * 1.5;
      track.scrollLeft = scrollLeft - walk;
    });
  }

  // 「最新へ」復帰ボタン
  const returnLatestBtn = document.getElementById("tr-return-latest-btn");
  if (returnLatestBtn) {
    returnLatestBtn.addEventListener("click", () => {
      if (appState.maxOpenedSlideIdx >= 0) {
        jumpToSlide(appState.maxOpenedSlideIdx);
      }
    });
  }

  // 指導者用 訓練ポイントトグル
  const pointBtn = document.getElementById("tr-toggle-point-btn");
  const popup = document.getElementById("tr-point-popup");
  const closePopupBtn = document.getElementById("tr-close-point-popup-btn");
  if (pointBtn && popup) {
    pointBtn.addEventListener("click", () => {
      appState.showPointsPopup = !appState.showPointsPopup;
      popup.style.display = appState.showPointsPopup ? "block" : "none";
    });
  }
  if (closePopupBtn && popup) {
    closePopupBtn.addEventListener("click", () => {
      appState.showPointsPopup = false;
      popup.style.display = "none";
    });
  }

  // 表示済み一覧（全画面ギャラリーモーダル）
  const openHistoryBtn = document.getElementById("tr-open-history-btn");
  const galleryModal = document.getElementById("tr-gallery-modal");
  const closeGalleryBtn = document.getElementById("tr-close-gallery-btn");
  const galleryJumpLatestBtn = document.getElementById("tr-gallery-jump-latest-btn");

  if (openHistoryBtn && galleryModal) {
    openHistoryBtn.addEventListener("click", () => {
      renderGalleryModal();
      galleryModal.style.display = "flex";
    });
  }
  if (closeGalleryBtn && galleryModal) {
    closeGalleryBtn.addEventListener("click", () => {
      galleryModal.style.display = "none";
    });
  }
  if (galleryJumpLatestBtn && galleryModal) {
    galleryJumpLatestBtn.addEventListener("click", () => {
      galleryModal.style.display = "none";
      if (appState.maxOpenedSlideIdx >= 0) {
        jumpToSlide(appState.maxOpenedSlideIdx);
      }
    });
  }

  // 拡大ライトボックスモーダル
  const lightboxOverlay = document.getElementById("tr-lightbox-overlay");
  const lightboxCloseBtn = document.getElementById("tr-lightbox-close-btn");
  if (lightboxOverlay && lightboxCloseBtn) {
    lightboxCloseBtn.addEventListener("click", () => {
      lightboxOverlay.style.display = "none";
    });
    lightboxOverlay.addEventListener("click", (e) => {
      if (e.target === lightboxOverlay) lightboxOverlay.style.display = "none";
    });
  }

  // 全画面
  const fullBtn = document.getElementById("tr-toggle-fullscreen-btn");
  if (fullBtn) fullBtn.addEventListener("click", toggleFullscreen);

  // 終了
  const exitBtn = document.getElementById("tr-exit-training-btn");
  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      if (confirm("訓練モードを終了し、デッキ選択画面に戻りますか？")) {
        cleanupTimers();
        appState.phase = "setup";
        document.body.classList.add("is-setup");
        initAppUI();
        showSetupDeckLoaded();
      }
    });
  }

  // サウンド
  const soundBtn = document.getElementById("tr-sound-btn");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      appState.soundEnabled = !appState.soundEnabled;
      sfx.enabled = appState.soundEnabled;
      soundBtn.textContent = appState.soundEnabled ? "🔊 音ON" : "🔇 音OFF";
    });
  }

  // 自動タイマー制御
  const pauseBtn = document.getElementById("tr-timer-pause-btn");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      appState.isPaused = !appState.isPaused;
      pauseBtn.textContent = appState.isPaused ? "▶" : "⏸️";
    });
  }
  const plusBtn = document.getElementById("tr-timer-plus-btn");
  if (plusBtn) {
    plusBtn.addEventListener("click", () => {
      appState.autoTimerRemaining = Math.min(appState.autoTimerRemaining + 30, 300);
      updateAutoTimerDisplay();
    });
  }
}

// ============================================================================
// カード送り・戻し進行（世帯・イベント単位 ＆ カード1枚単位）
// ============================================================================
export function advanceNextCard() {
  if (appState.currentSlideIdx < appState.slides.length - 1) {
    appState.currentSlideIdx++;
    appState.maxOpenedSlideIdx = Math.max(appState.maxOpenedSlideIdx, appState.currentSlideIdx);

    const slide = appState.slides[appState.currentSlideIdx];
    appState.activeCardNo = slide.startNo;

    // 個別フォーカスクラスのクリア
    document.querySelectorAll(".tr-carousel-card.is-single-focused").forEach((el) => {
      el.classList.remove("is-single-focused");
    });

    // サウンド
    sfx.playCardFlip();
    setTimeout(() => {
      if (slide.isHousehold) {
        sfx.playHouseholdChime();
      } else {
        sfx.playEventAlert();
      }
    }, 180);

    if (appState.mode === "auto") {
      appState.autoTimerRemaining = appState.timerSeconds;
      updateAutoTimerDisplay();
    }

    updateCarouselSpotlight(true);
  } else {
    completeTraining();
  }
}

export function stepBackPreviousCard() {
  if (appState.currentSlideIdx > 0) {
    appState.currentSlideIdx--;
    const slide = appState.slides[appState.currentSlideIdx];
    appState.activeCardNo = slide.startNo;

    document.querySelectorAll(".tr-carousel-card.is-single-focused").forEach((el) => {
      el.classList.remove("is-single-focused");
    });

    sfx.playCardFlip();
    if (appState.mode === "auto") {
      appState.autoTimerRemaining = appState.timerSeconds;
      updateAutoTimerDisplay();
    }
    updateCarouselSpotlight(true);
  }
}

// 左右矢印キー操作: カード1枚単位送り
export function advanceSingleCard() {
  if (appState.phase !== "running") return;
  if (appState.currentSlideIdx === -1) {
    advanceNextCard();
    return;
  }

  const currentSlide = appState.slides[appState.currentSlideIdx];
  const maxOpenedCardNo = appState.slides[appState.maxOpenedSlideIdx].endNo;
  const currentCardNo = appState.activeCardNo || currentSlide.startNo;

  if (currentCardNo < appState.rawDeckCards.length) {
    const nextCardNo = currentCardNo + 1;

    // 次のカードが未オープン（maxOpenedCardNo より先）なら次のスライドをオープン
    if (nextCardNo > maxOpenedCardNo) {
      advanceNextCard();
      highlightSingleCard(nextCardNo);
      return;
    }

    // すでにオープン済みの範囲内ならスライド切り替え & カードフォーカス
    const targetSlideIdx = appState.slides.findIndex(
      (s) => nextCardNo >= s.startNo && nextCardNo <= s.endNo
    );
    if (targetSlideIdx !== -1) {
      if (targetSlideIdx !== appState.currentSlideIdx) {
        appState.currentSlideIdx = targetSlideIdx;
        updateCarouselSpotlight(false);
      }
      sfx.playCardFlip();
      highlightSingleCard(nextCardNo);
    }
  }
}

// 左右矢印キー操作: カード1枚単位戻し
export function stepBackSingleCard() {
  if (appState.phase !== "running" || appState.currentSlideIdx === -1) return;

  const currentSlide = appState.slides[appState.currentSlideIdx];
  const currentCardNo = appState.activeCardNo || currentSlide.startNo;

  if (currentCardNo > 1) {
    const prevCardNo = currentCardNo - 1;
    const targetSlideIdx = appState.slides.findIndex(
      (s) => prevCardNo >= s.startNo && prevCardNo <= s.endNo
    );
    if (targetSlideIdx !== -1 && targetSlideIdx <= appState.maxOpenedSlideIdx) {
      if (targetSlideIdx !== appState.currentSlideIdx) {
        appState.currentSlideIdx = targetSlideIdx;
        updateCarouselSpotlight(false);
      }
      sfx.playCardFlip();
      highlightSingleCard(prevCardNo);
    }
  }
}

function jumpToSlide(slideIdx) {
  if (slideIdx >= 0 && slideIdx <= appState.maxOpenedSlideIdx) {
    appState.currentSlideIdx = slideIdx;
    sfx.playCardFlip();
    if (appState.mode === "auto") {
      appState.autoTimerRemaining = appState.timerSeconds;
      updateAutoTimerDisplay();
    }
    updateCarouselSpotlight(true);
  }
}

// ============================================================================
// 全画面サムネイルギャラリー ＆ 拡大ライトボックス
// ============================================================================
let selectedGallerySlideIdx = 0;

function renderGalleryModal() {
  const grid = document.getElementById("tr-gallery-grid");
  if (!grid) return;

  if (appState.maxOpenedSlideIdx < 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--tr-text-muted);">まだ表示されたカードはありません</div>`;
    return;
  }

  const items = [];
  for (let i = 0; i <= appState.maxOpenedSlideIdx; i++) {
    const slide = appState.slides[i];
    const isCurrent = i === appState.currentSlideIdx;
    const isHH = slide.isHousehold;
    const noText = slide.startNo === slide.endNo ? `No.${slide.startNo}` : `No.${slide.startNo}〜${slide.endNo}`;
    const firstC = slide.cards[0];

    items.push(`
      <div
        class="tr-gallery-thumb-card ${isCurrent ? "active" : ""}"
        data-slide-idx="${i}"
        data-testid="tr-history-item-${slide.startNo}"
      >
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="tr-badge" style="background:#eff6ff;color:#1d4ed8;font-size:0.75rem;padding:0.15rem 0.4rem;">${noText}</span>
          <span style="font-size:0.75rem;color:var(--tr-text-muted);">${isHH ? "🏠 世帯" : "⚡ イベント"}</span>
        </div>
        <img
          class="tr-gallery-thumb-img"
          data-orig-id="${escapeHtml(firstC.original_id)}"
          data-card-no="${firstC.card_number}"
          alt="${escapeHtml(slide.title)}"
        />
        <div class="tr-gallery-thumb-title" title="${escapeHtml(slide.title)}">${escapeHtml(slide.title)}</div>
      </div>
    `);
  }

  grid.innerHTML = items.join("");

  // サムネイル画像レンダリング
  grid.querySelectorAll(".tr-gallery-thumb-img").forEach((img) => {
    const cardNo = Number(img.dataset.cardNo);
    const card = appState.rawDeckCards.find((c) => c.card_number === cardNo);
    if (card) {
      bindCardImageIfNeeded(img, card);
    }
  });

  // サムネイルクリックで拡大ライトボックス表示
  grid.querySelectorAll(".tr-gallery-thumb-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => {
      const idx = Number(cardEl.dataset.slideIdx);
      selectedGallerySlideIdx = idx;
      openLightboxForSlide(idx);
    });
  });
}

function openLightboxForSlide(slideIdx) {
  const slide = appState.slides[slideIdx];
  if (!slide) return;

  const overlay = document.getElementById("tr-lightbox-overlay");
  const imgEl = document.getElementById("tr-lightbox-img");
  const selectBtn = document.getElementById("tr-lightbox-select-btn");

  const firstCard = slide.cards[0];
  const posMap = computeGroupPositionMap(appState.rawDeckCards);
  const pos = posMap.get(String(firstCard.original_id || ""));
  const model = toCardRenderModel(firstCard, firstCard.group, {
    cardNumber: firstCard.card_number,
    imageIds: store.imageIds,
    groupIndex: pos?.group_index ?? firstCard.group_index,
    groupTotal: pos?.group_total ?? firstCard.group_total,
  });
  if (model) {
    bindCardCanvasImage(imgEl, model, { showNumber: true });
  }

  if (selectBtn) {
    selectBtn.onclick = () => {
      overlay.style.display = "none";
      const galleryModal = document.getElementById("tr-gallery-modal");
      if (galleryModal) galleryModal.style.display = "none";
      jumpToSlide(slideIdx);
    };
  }

  if (overlay) overlay.style.display = "flex";
}

// ============================================================================
// タイマー処理
// ============================================================================
function startAutoTimer() {
  if (appState.autoTimerId) clearInterval(appState.autoTimerId);
  appState.autoTimerRemaining = appState.timerSeconds;

  appState.autoTimerId = setInterval(() => {
    if (appState.isPaused || appState.phase !== "running" || appState.currentSlideIdx === -1) return;

    if (appState.autoTimerRemaining > 0) {
      appState.autoTimerRemaining--;
      updateAutoTimerDisplay();

      if (appState.autoTimerRemaining > 0 && appState.autoTimerRemaining <= 3) {
        sfx.playCountdownBeep(false);
      } else if (appState.autoTimerRemaining === 0) {
        sfx.playCountdownBeep(true);
        advanceNextCard();
      }
    }
  }, 1000);
}

function updateAutoTimerDisplay() {
  const el = document.getElementById("tr-auto-sec-val");
  if (!el) return;
  el.textContent = `${appState.autoTimerRemaining}秒`;
  if (appState.autoTimerRemaining <= 5) {
    el.className = "tr-auto-timer-sec danger";
  } else if (appState.autoTimerRemaining <= 10) {
    el.className = "tr-auto-timer-sec warning";
  } else {
    el.className = "tr-auto-timer-sec";
  }
}

function updateElapsedTimerDisplay() {
  const el = document.getElementById("tr-elapsed-text");
  if (!el) return;
  const h = String(Math.floor(appState.elapsedSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((appState.elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(appState.elapsedSeconds % 60).padStart(2, "0");
  el.textContent = `${h}:${m}:${s}`;
}

function cleanupTimers() {
  if (appState.elapsedTimerId) {
    clearInterval(appState.elapsedTimerId);
    appState.elapsedTimerId = null;
  }
  if (appState.autoTimerId) {
    clearInterval(appState.autoTimerId);
    appState.autoTimerId = null;
  }
}

// ============================================================================
// 訓練完了モーダル
// ============================================================================
function completeTraining() {
  appState.phase = "completed";
  cleanupTimers();
  sfx.playFanfare();

  const modal = document.createElement("div");
  modal.className = "tr-complete-overlay";
  modal.setAttribute("data-testid", "tr-complete-modal");

  const h = String(Math.floor(appState.elapsedSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((appState.elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(appState.elapsedSeconds % 60).padStart(2, "0");

  modal.innerHTML = `
    <div class="tr-complete-box">
      <div style="font-size:3.5rem;margin-bottom:0.5rem;">🎉</div>
      <h2 style="font-size:2rem;font-weight:800;color:#0f172a;margin:0 0 0.5rem;">避難所運営訓練 完了！</h2>
      <p style="color:#475569;font-size:1.05rem;margin:0 0 1.5rem;">
        全てのカード (${appState.rawDeckCards.length}枚) の対応・配置が完了しました。お疲れ様でした！
      </p>

      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:0.75rem;padding:1.25rem;margin-bottom:1.5rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem;text-align:center;">
        <div>
          <div style="font-size:0.8rem;color:#64748b;">総訓練時間</div>
          <div style="font-size:1.6rem;font-weight:800;color:#2563eb;">${h}:${m}:${s}</div>
        </div>
        <div>
          <div style="font-size:0.8rem;color:#64748b;">対応カード数</div>
          <div style="font-size:1.6rem;font-weight:800;color:#15803d;">${appState.rawDeckCards.length}枚</div>
        </div>
      </div>

      <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;">
        <button type="button" class="tr-btn tr-btn-primary" id="tr-modal-review-btn">
          📋 振り返り（ギャラリーを開く）
        </button>
        <button type="button" class="tr-btn tr-btn-success" id="tr-modal-restart-btn">
          🔄 最初からやり直す
        </button>
        <button type="button" class="tr-btn" id="tr-modal-back-btn">
          🏠 デッキ選択に戻る
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#tr-modal-review-btn").addEventListener("click", () => {
    modal.remove();
    renderGalleryModal();
    const gModal = document.getElementById("tr-gallery-modal");
    if (gModal) gModal.style.display = "flex";
  });
  modal.querySelector("#tr-modal-restart-btn").addEventListener("click", () => {
    modal.remove();
    startTraining();
  });
  modal.querySelector("#tr-modal-back-btn").addEventListener("click", () => {
    modal.remove();
    appState.phase = "setup";
    document.body.classList.add("is-setup");
    initAppUI();
    showSetupDeckLoaded();
  });
}

// ============================================================================
// 全画面表示切替
// ============================================================================
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
}

// ============================================================================
// キーボードショートカット
// ============================================================================
window.addEventListener("keydown", (e) => {
  if (appState.phase !== "running") return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
    return;
  }

  // スペース・リターン(Enter): 世帯・イベント単位で進行
  if (e.code === "Space" || e.key === "Enter") {
    e.preventDefault();
    advanceNextCard();
  } else if (e.key === "ArrowRight") {
    // 左右矢印キー: カード1枚ずつ送り
    e.preventDefault();
    advanceSingleCard();
  } else if (e.key === "ArrowLeft") {
    // 左右矢印キー: カード1枚ずつ戻し
    e.preventDefault();
    stepBackSingleCard();
  } else if (e.key === "Backspace") {
    // Backspace: 世帯・イベント単位で戻る
    e.preventDefault();
    stepBackPreviousCard();
  } else if (e.key === "p" || e.key === "P") {
    if (appState.mode === "auto") {
      appState.isPaused = !appState.isPaused;
      const pauseBtn = document.getElementById("tr-timer-pause-btn");
      if (pauseBtn) pauseBtn.textContent = appState.isPaused ? "▶" : "⏸️";
    }
  } else if (e.key === "h" || e.key === "H") {
    const galleryModal = document.getElementById("tr-gallery-modal");
    if (galleryModal) {
      if (galleryModal.style.display === "flex") {
        galleryModal.style.display = "none";
      } else {
        renderGalleryModal();
        galleryModal.style.display = "flex";
      }
    }
  } else if (e.key === "t" || e.key === "T") {
    const popup = document.getElementById("tr-point-popup");
    if (popup) {
      appState.showPointsPopup = !appState.showPointsPopup;
      popup.style.display = appState.showPointsPopup ? "block" : "none";
    }
  }
});

// ============================================================================
// セットアップ画面の描画
// ============================================================================
export async function initAppUI() {
  const main = document.getElementById("tr-main");
  if (!main) return;

  document.body.classList.add("is-setup");

  const hasLocalDeck = Boolean(localStorage.getItem("hug_web_deck_state_v1"));
  const serverDecks = await fetchServerSavedDecks();

  main.innerHTML = `
    <div class="tr-setup-container" data-testid="tr-setup-view">
      <div class="tr-setup-hero">
        <div class="tr-setup-logo-wrap">
          <img ${LOGO_IMG_ATTRS} alt="避難所運営ゲーム 正式ロゴ" class="tr-setup-logo-img" />
        </div>
        <h1>避難所運営ゲーム (HUG) 訓練実行モード</h1>
        <p>
          現場のプロジェクター投影・大画面モニター・ノートPCに最適化したカードオープン進行システムです。<br />
          デッキを読み込み、カルーセルスクロールとスポットライト演出でリアルタイムな避難所訓練を実施できます。
        </p>

        <div class="tr-source-cards-grid">
          <!-- ソース1: JSONファイル -->
          <div class="tr-source-card">
            <h3><span>📂</span> JSON台帳ファイル</h3>
            <p>エクスポートしたデッキJSONや台帳ファイルを読み込みます。</p>
            <div class="tr-dropzone" id="tr-dropzone" data-testid="tr-dropzone">
              <div class="tr-dropzone-icon">📥</div>
              <div style="font-size:0.9rem;font-weight:700;color:#1e293b;">ファイルをドロップ</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:0.25rem;">またはクリックして選択 (.json)</div>
              <input type="file" id="tr-file-input" accept=".json" style="display:none;" />
            </div>
          </div>

          <!-- ソース2: Webツール一時保存 -->
          <div class="tr-source-card">
            <h3><span>🌐</span> Webデッキツールのデッキ</h3>
            <p>Web版デッキ構築ツールで現在作成・編集中の最新デッキを読み込みます。</p>
            <button
              type="button"
              class="tr-btn tr-btn-primary"
              id="tr-load-local-btn"
              data-testid="tr-load-local-btn"
              ${!hasLocalDeck ? "disabled" : ""}
            >
              ${hasLocalDeck ? "編集中のデッキを読み込む" : "（保存デッキなし）"}
            </button>
          </div>

          <!-- ソース3: サーバー保存済みデッキ -->
          <div class="tr-source-card">
            <h3><span>💾</span> サーバー保存済みデッキ</h3>
            <p>データベースに保存されたデッキ条件から選択して読み込みます。</p>
            ${
              serverDecks.length > 0
                ? `
                <select id="tr-server-deck-select" class="tr-btn" style="background:#ffffff;">
                  <option value="">-- デッキを選択 --</option>
                  ${serverDecks
                    .map((d) => `<option value="${d.id}">${escapeHtml(d.name)} (${escapeHtml(d.conditions?.disaster_type || "未指定")})</option>`)
                    .join("")}
                </select>
                <button type="button" class="tr-btn tr-btn-primary" id="tr-load-server-btn" disabled>
                  選択デッキを読み込む
                </button>
              `
                : `<div style="font-size:0.82rem;color:var(--tr-text-muted);">（サーバー接続なし、または保存デッキ未登録）</div>`
            }
          </div>
        </div>
      </div>

      <!-- デッキ読み込み後に展開される詳細・設定・プレビューコンテナ -->
      <div id="tr-loaded-deck-container"></div>
    </div>
  `;

  bindSetupEventListeners(serverDecks);
}

// ============================================================================
// セットアップ画面イベントリスナー
// ============================================================================
function bindSetupEventListeners(serverDecks) {
  const dropzone = document.getElementById("tr-dropzone");
  const fileInput = document.getElementById("tr-file-input");

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadDeckFromJsonFile(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        loadDeckFromJsonFile(e.target.files[0]);
      }
    });
  }

  const loadLocalBtn = document.getElementById("tr-load-local-btn");
  if (loadLocalBtn) {
    loadLocalBtn.addEventListener("click", () => {
      loadDeckFromLocalStorage();
    });
  }

  const serverSelect = document.getElementById("tr-server-deck-select");
  const loadServerBtn = document.getElementById("tr-load-server-btn");
  if (serverSelect && loadServerBtn) {
    serverSelect.addEventListener("change", (e) => {
      loadServerBtn.disabled = !e.target.value;
    });
    loadServerBtn.addEventListener("click", () => {
      const id = serverSelect.value;
      if (id) loadDeckFromServerSavedDeck(id);
    });
  }
}

// ============================================================================
// エントリポイント
// ============================================================================
async function main() {
  await loadCardDatabase();
  await initAppUI();

  const params = new URLSearchParams(window.location.search);
  if (params.get("source") === "local") {
    loadDeckFromLocalStorage();
  }
}

main().catch(console.error);
