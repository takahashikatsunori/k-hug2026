/**
 * HUGカード画像合成・グリッド画像自動分割・PDF/ZIP/避難者台帳出力エンジン
 * (hug-card-gen の全機能・デザイン仕様を 100% 継承)
 */
import { escapeHtml, triggerBlobDownload } from "./util.js";
import { store } from "./store.js";

export const VALID_FLAGS = {
  健康: [
    "発熱",
    "呼吸器不調",
    "消化器不調",
    "下痢・嘔吐",
    "骨折",
    "感染症疑い",
    "熱中症",
    "擦り傷",
    "精神的ショック",
    "慢性疾患あり",
    "泥酔",
    "重傷",
    "病気",
    "ケガ",
    "温度管理必要",
    "混乱・怯え",
    "特殊エサ",
    "高齢・要介護",
  ],
  スキル: [
    "医療",
    "力仕事",
    "食",
    "事務IT",
    "地域リーダー",
    "多言語手話",
    "IT関係",
    "設備修理",
    "保育",
    "建築関係",
    "医療関係",
    "飲食関係",
    "手話・要約筆記",
    "多言語通訳",
    "重機運転",
    "保育・教育",
    "電気・設備",
    "癒し",
    "人懐こい",
    "見張り・警戒",
  ],
  配慮事項: [
    "ペット",
    "移動困難",
    "乳幼児妊産婦",
    "外国籍",
    "要電源",
    "車中泊",
    "喫煙",
    "車椅子",
    "LGBTQ",
    "電源必要",
    "妊婦",
    "認知症",
    "視覚障害",
    "聴覚障害",
    "乳幼児",
    "アレルギー",
    "人工透析",
    "精神疾患",
    "言語障害",
    "ワクチン未接種",
    "無駄吠え・夜鳴き",
    "未去勢",
    "ケージNG",
    "威嚇・噛み癖",
  ],
};

export const ALL_VALID_FLAGS = new Set(Object.values(VALID_FLAGS).flat());

export const PRINT_SIZES = {
  current: {
    width: 47.5,
    height: 63.33,
    label: "現在のサイズ(約4.8×6.3)",
    cols: 6,
    rows: 3,
  },
  "3x4.5": {
    width: 30,
    height: 45,
    label: "3cm × 4.5cm",
    cols: 9,
    rows: 4,
  },
  "4.5x6.5": {
    width: 45,
    height: 65,
    label: "4.5cm × 6.5cm",
    cols: 6,
    rows: 3,
  },
  "4x6": {
    width: 40,
    height: 60,
    label: "4cm × 6cm",
    cols: 7,
    rows: 3,
  },
  business: {
    width: 55,
    height: 91,
    label: "名刺サイズ (5.5×9.1cm)",
    cols: 5,
    rows: 2,
  },
  credit: {
    width: 54,
    height: 86,
    label: "クレジットカード (5.4×8.6cm)",
    cols: 5,
    rows: 2,
  },
  poker: {
    width: 63,
    height: 88,
    label: "トランプサイズ (6.3×8.8cm)",
    cols: 4,
    rows: 2,
  },
};

export const FIXED_DESIGN_MODE = "standard";
export const FIXED_PRINT_SIZE_ID = "business";

/**
 * 避難者・ペットカードのレイアウト切替フラグ.
 * 元のレイアウト（グループ情報なし）へ戻す場合はここを `"legacy"` に変更してください.
 * @type {"withGroupHeader" | "legacy"}
 */
export const EVACUEE_CARD_LAYOUT_MODE = "withGroupHeader";

/**
 * 指定カード・オプションに対する有効なレイアウトモードを解決する.
 * @param {Record<string, any> | null | undefined} card
 * @param {{ layoutMode?: "withGroupHeader" | "legacy" }} [options]
 * @returns {"withGroupHeader" | "legacy"}
 */
export function resolveEvacueeCardLayoutMode(card, options = {}) {
  const mode = options?.layoutMode || card?.layoutMode || EVACUEE_CARD_LAYOUT_MODE;
  return mode === "legacy" ? "legacy" : "withGroupHeader";
}

/**
 * イベントカードタイトルのレイアウト切替フラグ.
 * 元の可変行レイアウト（1行時にイラストが上へ詰まる形式）へ戻す場合は `"legacy"` に変更してください.
 * @type {"fixedTwoLine" | "legacy"}
 */
export const EVENT_CARD_TITLE_LAYOUT_MODE = "fixedTwoLine";

/**
 * 指定カード・オプションに対する有効なイベントタイトルレイアウトモードを解決する.
 * @param {Record<string, any> | null | undefined} card
 * @param {{ eventTitleLayoutMode?: "fixedTwoLine" | "legacy" }} [options]
 * @returns {"fixedTwoLine" | "legacy"}
 */
export function resolveEventCardTitleLayoutMode(card, options = {}) {
  const mode =
    options?.eventTitleLayoutMode ||
    card?.eventTitleLayoutMode ||
    EVENT_CARD_TITLE_LAYOUT_MODE;
  return mode === "legacy" ? "legacy" : "fixedTwoLine";
}

/**
 * カード／レコードからグループIDを抽出する.
 * @param {Record<string, any> | null | undefined} item
 * @param {Record<string, any> | null | undefined} [group]
 * @returns {string}
 */
export function resolveCardGroupId(item, group = null) {
  if (!item) return "";
  return String(
    item.group_id || item.data?.group_id || item.group?.group_id || group?.group_id || ""
  ).trim();
}

/**
 * カード配列の各要素について、同一配列（デッキまたは世帯）内でのグループ内順番・総数を計算する.
 * @param {Array<Record<string, any>>} cards
 * @returns {Array<{ group_index: number, group_total: number } | null>}
 */
export function computeGroupPositionsByIndex(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  const totals = new Map();
  const groupIds = cards.map((c) => {
    if (!c || c.kind === "event" || c.type === "イベント") return "";
    return resolveCardGroupId(c);
  });
  for (const gid of groupIds) {
    if (gid) totals.set(gid, (totals.get(gid) || 0) + 1);
  }
  const seen = new Map();
  return groupIds.map((gid) => {
    if (!gid) return null;
    const pos = (seen.get(gid) || 0) + 1;
    seen.set(gid, pos);
    return {
      group_index: pos,
      group_total: totals.get(gid) || pos,
    };
  });
}

/**
 * カード配列から `original_id` (または `member_id`/`id`) をキーとするグループ内順番マップを構築する.
 * @param {Array<Record<string, any>>} cards
 * @returns {Map<string, { group_index: number, group_total: number }>}
 */
export function computeGroupPositionMap(cards) {
  const byId = new Map();
  if (!Array.isArray(cards)) return byId;
  const positions = computeGroupPositionsByIndex(cards);
  for (let i = 0; i < cards.length; i++) {
    const pos = positions[i];
    if (!pos) continue;
    const c = cards[i];
    const oid = String(c.original_id || c.member_id || c.id || "").trim();
    if (oid) byId.set(oid, pos);
  }
  return byId;
}

const cardImageCache = new Map();
const baseCardCanvasCache = new Map();
const baseCardDataUrlCache = new Map();
const loadedImageElementCache = new Map();

const MAX_CANVAS_CACHE_ENTRIES = 36;
const MAX_IMAGE_ELEMENT_CACHE_ENTRIES = 48;
const MAX_DATAURL_CACHE_ENTRIES = 450;

export const CARD_CANVAS_WIDTH = 600;
export const CARD_CANVAS_HEIGHT = Math.round(
  (CARD_CANVAS_WIDTH * PRINT_SIZES.business.height) / PRINT_SIZES.business.width
); // 993px (名刺サイズ 55:91 縦横比)

const PLACEHOLDER_CARD_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_CANVAS_WIDTH}" height="${CARD_CANVAS_HEIGHT}" viewBox="0 0 ${CARD_CANVAS_WIDTH} ${CARD_CANVAS_HEIGHT}">` +
      `<rect width="${CARD_CANVAS_WIDTH}" height="${CARD_CANVAS_HEIGHT}" fill="#ffffff"/>` +
      `<rect x="15" y="15" width="${CARD_CANVAS_WIDTH - 30}" height="${CARD_CANVAS_HEIGHT - 30}" rx="20" ry="20" fill="none" stroke="#cbd5e1" stroke-width="6"/>` +
      "</svg>"
  );

function setBoundedMap(map, key, val, maxEntries) {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
  map.set(key, val);
}

export function clearCardImageCache() {
  cardImageCache.clear();
  baseCardCanvasCache.clear();
  baseCardDataUrlCache.clear();
  loadedImageElementCache.clear();
}

/**
 * 詳細フラグのカテゴリ（'健康' | 'スキル' | '配慮事項' | 'other'）を判定する.
 * @param {string} flag
 * @returns {'健康' | 'スキル' | '配慮事項' | 'other'}
 */
export function getFlagCategory(flag) {
  if (VALID_FLAGS["健康"].includes(flag)) return "健康";
  if (VALID_FLAGS["スキル"].includes(flag)) return "スキル";
  if (VALID_FLAGS["配慮事項"].includes(flag)) return "配慮事項";
  return "other";
}

/**
 * Base64文字列またはDataURL/APIパスを正規のDataURLまたはURLに変換する.
 * 注意: JPEGのBase64文字列は先頭バイト(0xFF 0xD8 0xFF)により必ず "/9j/" で始まるため、
 * 単なる `raw.startsWith("/")` では相対URLと誤判定される。`/api/` または `/static/` のみ相対URLとして扱う。
 * @param {string} raw
 * @returns {string}
 */
export function ensureDataUrl(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/api/") ||
    trimmed.startsWith("/static/") ||
    trimmed.startsWith("/data/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/9j/")) {
    return `data:image/jpeg;base64,${trimmed}`;
  }
  if (trimmed.startsWith("UklGR")) {
    return `data:image/webp;base64,${trimmed}`;
  }
  if (trimmed.startsWith("R0lGOD")) {
    return `data:image/gif;base64,${trimmed}`;
  }
  return `data:image/png;base64,${trimmed}`;
}

/**
 * 4x3 (12枚) または 3x3 (9枚) のグリッド画像を白線自動検出で切り出す (hug-card-gen の sliceImage 完全移植).
 * @param {string} base64OrDataUrl
 * @param {number} cols
 * @param {number} rows
 * @returns {Promise<string[]>}
 */
export const sliceGridImage = async (base64OrDataUrl, cols, rows) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imgData.data;

      const colBrightness = new Float32Array(img.width);
      const rowBrightness = new Float32Array(img.height);

      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const brightness =
            (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          colBrightness[x] += brightness;
          rowBrightness[y] += brightness;
        }
      }

      for (let x = 0; x < img.width; x++) colBrightness[x] /= img.height;
      for (let y = 0; y < img.height; y++) rowBrightness[y] /= img.width;

      const findLines = (brightnessArr, expectedCount, totalLen) => {
        const lines = [];
        let inLine = false;
        let lineStart = 0;

        for (let i = 0; i < brightnessArr.length; i++) {
          if (brightnessArr[i] > 240) {
            if (!inLine) {
              inLine = true;
              lineStart = i;
            }
          } else {
            if (inLine) {
              inLine = false;
              lines.push({
                center: (lineStart + i - 1) / 2,
                width: i - lineStart,
              });
            }
          }
        }
        if (inLine) {
          lines.push({
            center: (lineStart + brightnessArr.length - 1) / 2,
            width: brightnessArr.length - lineStart,
          });
        }

        const validLines = [];
        const startPos = 0;
        validLines.push(startPos);
        const endPos = totalLen;
        const expectedSpacing = (endPos - startPos) / expectedCount;

        for (let i = 1; i < expectedCount; i++) {
          const expectedPos = startPos + i * expectedSpacing;
          let closestLine = -1;
          let minDiff = totalLen;
          for (const line of lines) {
            const diff = Math.abs(line.center - expectedPos);
            if (diff < minDiff && diff < expectedSpacing * 0.2) {
              minDiff = diff;
              closestLine = line.center;
            }
          }
          if (closestLine !== -1) {
            validLines.push(closestLine);
          } else {
            validLines.push(expectedPos);
          }
        }

        validLines.push(endPos);
        return validLines;
      };

      const xLines = findLines(colBrightness, cols, img.width);
      const yLines = findLines(rowBrightness, rows, img.height);

      const slices = [];
      const outCanvas = document.createElement("canvas");
      const outCtx = outCanvas.getContext("2d");

      if (!outCtx) {
        reject(new Error("Failed to get output canvas context"));
        return;
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const xStart = xLines[c];
          const xEnd = xLines[c + 1];
          const yStart = yLines[r];
          const yEnd = yLines[r + 1];

          const margin = 2;
          const sx = xStart + margin;
          const sy = yStart + margin;
          const sw = Math.max(1, xEnd - xStart - margin * 2);
          const sh = Math.max(1, yEnd - yStart - margin * 2);

          outCanvas.width = sw;
          outCanvas.height = sh;
          outCtx.clearRect(0, 0, sw, sh);

          outCtx.fillStyle = "#ffffff";
          outCtx.fillRect(0, 0, sw, sh);

          outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          slices.push(outCanvas.toDataURL("image/png"));
        }
      }
      resolve(slices);
    };
    img.onerror = () =>
      reject(
        new Error(
          "グリッド画像の読み込みに失敗しました。画像ファイル形式（PNG/JPEG/WebP）をご確認ください。"
        )
      );
    img.src = ensureDataUrl(base64OrDataUrl);
  });
};

/**
 * 切り出し確認用の赤枠＋「セル1〜N」アノテーション画像を生成する.
 * @param {string} base64OrDataUrl
 * @param {number} cols
 * @param {number} rows
 * @returns {Promise<string>}
 */
export const createAnnotatedImage = async (base64OrDataUrl, cols, rows) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0);

      const cellWidth = img.width / cols;
      const cellHeight = img.height / rows;

      ctx.strokeStyle = "red";
      ctx.lineWidth = 4;
      ctx.fillStyle = "red";
      ctx.font = "bold 60px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let count = 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cellWidth;
          const y = r * cellHeight;

          ctx.strokeRect(x, y, cellWidth, cellHeight);

          const textX = x + cellWidth / 2;
          const textY = y + cellHeight / 2;

          ctx.lineWidth = 8;
          ctx.strokeStyle = "white";
          ctx.strokeText(`セル${count}`, textX, textY);
          ctx.fillText(`セル${count}`, textX, textY);

          count++;
        }
      }
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () =>
      reject(new Error("アノテーション対象画像の読み込みに失敗しました。"));
    img.src = ensureDataUrl(base64OrDataUrl);
  });
};

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * カード左上に通し番号 (`No. X`) を描画すべきかどうかを判定する.
 * マスタIDのまま（EV-xxx / M-xxxx / PREVIEW）で通し番号が未確定の場合は false を返す.
 * @param {Record<string, any>} card
 * @param {{ showNumber?: boolean }} [options]
 * @returns {boolean}
 */
export function shouldDrawCardNumber(card, options = {}) {
  if (options && typeof options.showNumber === "boolean") {
    return options.showNumber;
  }
  const idStr = String((card && card.id) ?? "").trim();
  const origStr = String((card && card.original_id) ?? "").trim();
  if (!idStr || idStr === "PREVIEW") return false;
  if (/^(EV|M|GRP)-\d+$/i.test(idStr) && (!origStr || idStr === origStr)) {
    return false;
  }
  return true;
}

/**
 * ベースカード画像（番号以外の部分）のキャッシュキーを生成する.
 * @param {Record<string, any>} card
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {boolean} [withImage=true]
 * @returns {string}
 */
function buildBaseCardCacheKey(
  card,
  designMode = "standard",
  withImage = true,
  options = {}
) {
  return JSON.stringify({
    original_id: String(card.original_id || card.id || ""),
    type: String(card.type || ""),
    name: String(card.name || ""),
    origin: String(card.origin || ""),
    age: String(card.age ?? ""),
    gender: String(card.gender || ""),
    attributes: String(card.attributes || ""),
    detailedFlags: Array.isArray(card.detailedFlags) ? card.detailedFlags : [],
    dialogue: String(card.dialogue || ""),
    group_name: String(card.group_name || ""),
    group_index: card.group_index ?? null,
    group_total: card.group_total ?? null,
    imageUrl: withImage ? String(card.imageUrl || "") : "",
    designMode: designMode || "standard",
    layoutMode: resolveEvacueeCardLayoutMode(card, options),
    eventTitleLayoutMode: resolveEventCardTitleLayoutMode(card, options),
  });
}

/**
 * 幅上限で単純文字折り返しを行うフォールバックヘルパー.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 * @returns {string[]}
 */
function wrapTextByCharWidth(ctx, text, maxW) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * 明示的な改行 (\n) を含む文字列を行ごとに幅折り返しする.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 * @returns {string[]}
 */
function wrapExplicitNewlines(ctx, text, maxW) {
  const explicit = text.split("\n").filter((s) => s.length > 0);
  const wrapped = [];
  for (const part of explicit) {
    wrapped.push(...wrapTextByCharWidth(ctx, part, maxW));
  }
  return wrapped.length ? wrapped : [text];
}

/**
 * 2行折り返し時に助詞・記号・カタカナ単語などの意味の切れ目で自然に分割する.
 * 明示的な改行（\n）がある場合はそれを優先する.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 * @returns {string[]}
 */
function splitGroupNameSmart(ctx, text, maxW) {
  if (text.includes("\n")) {
    return wrapExplicitNewlines(ctx, text, maxW);
  }

  const raw = wrapTextByCharWidth(ctx, text, maxW);
  if (raw.length <= 1) return raw;

  const chars = Array.from(text);
  const isKatakana = (c) => c !== "・" && /[\u30A0-\u30FF]/.test(c);
  const isHiragana = (c) => /[\u3040-\u309F]/.test(c);
  const isAscii = (c) => /[A-Za-z0-9]/.test(c);

  let best = null;
  for (let i = 1; i < chars.length; i++) {
    const l1 = chars.slice(0, i).join("");
    const l2 = chars.slice(i).join("");
    if (ctx.measureText(l1).width > maxW || ctx.measureText(l2).width > maxW) {
      continue;
    }

    let score = 0;
    const prev = chars[i - 1];
    const next = chars[i];
    if (prev === "・" || prev === "、" || prev === " " || prev === "　") {
      score += 120;
    }
    if ((next === "（" || next === "(") && i >= 2) {
      score += 110;
    }
    if (next === "・") score -= 60;
    if (next === "）" || next === ")" || next === "、") score -= 220;
    if (prev === "（" || prev === "(") score -= 180;
    if (/[0-9０-９]/.test(prev) && /[人名匹歳階]/.test(next)) score -= 100;

    // 末尾1〜3文字だけ2行目に落ちる孤立折り返しや極端に短い1行目を抑制
    if (chars.length - i < 4) score -= 140;
    if (i < 2) score -= 100;
    if (i === 2) score -= 25;

    // カタカナ語・英数字の途中切れを避け、文字種の境目を優先
    if (isAscii(prev) && isAscii(next)) score -= 130;
    if (isKatakana(prev) && isKatakana(next)) score -= 120;
    if (
      (isKatakana(prev) && !isKatakana(next) && next !== "）" && next !== "・") ||
      (!isKatakana(prev) && isKatakana(next) && prev !== "（" && prev !== "・")
    ) {
      score += 35;
    }
    if (isHiragana(prev) && !isHiragana(next) && next !== "）") score += 25;

    score -= Math.abs(i - (chars.length - i)) * 2;
    if (!best || score > best.score) {
      best = { score, lines: [l1, l2] };
    }
  }
  return best ? best.lines : raw;
}

/**
 * グループ名バナー用にフォントサイズと表示行（最大2行）を決定する.
 * 1行収まりを優先し、2行になる場合は意味の区切りで自然に改行する.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} displayGroupName
 * @param {number} nameMaxW
 * @returns {{ fontSize: number, lines: string[] }}
 */
export function layoutGroupNameText(ctx, displayGroupName, nameMaxW) {
  const text = String(displayGroupName || "");
  if (!text.includes("\n")) {
    for (const fs of [31, 29, 27, 25]) {
      ctx.font = `bold ${fs}px sans-serif`;
      if (ctx.measureText(text).width <= nameMaxW) {
        return { fontSize: fs, lines: [text] };
      }
    }
  }
  let fallbackLines = [text];
  let fallbackFont = 21;
  for (const fs of [25, 23, 21]) {
    ctx.font = `bold ${fs}px sans-serif`;
    const lines = splitGroupNameSmart(ctx, text, nameMaxW);
    fallbackFont = fs;
    fallbackLines = lines;
    if (lines.length <= 2) {
      return { fontSize: fs, lines };
    }
  }
  return { fontSize: fallbackFont, lines: fallbackLines };
}

const EVENT_TITLE_PARTICLES = new Set(["の", "と", "を", "に", "へ", "で", "が", "や"]);
const EVENT_TITLE_BREAK_AFTER_PHRASES = [
  "による",
  "への",
  "での",
  "からの",
  "に伴う",
  "に対する",
  "における",
  "を巡る",
];
const EVENT_TITLE_BREAK_BEFORE_PHRASES = ["からの", "への", "による", "に伴う"];

/**
 * イベントカードタイトルの最適な2行分割位置スコアを算出する.
 * @param {string[]} chars
 * @param {number} i
 * @param {number} depthAtIndex
 * @returns {number}
 */
function scoreEventTitleSplit(chars, i, depthAtIndex) {
  const isKatakana = (c) =>
    c === "ー" || (c !== "・" && /[\u30A0-\u30FF]/.test(c));
  const isHiragana = (c) => /[\u3040-\u309F]/.test(c);
  const isKanji = (c) => /[\u4E00-\u9FFF]/.test(c);
  const isAscii = (c) => /[A-Za-z0-9]/.test(c);
  const isDigit = (c) => /[0-9０-９]/.test(c);

  const l1 = chars.slice(0, i).join("");
  const l2 = chars.slice(i).join("");
  const prev = chars[i - 1];
  const next = chars[i];
  let score = 0;

  // 括弧内の途中改行を抑止し、開き括弧の直前での改行を優先する
  if (depthAtIndex > 0 && next !== "）" && next !== ")") score -= 240;
  if (prev === "（" || prev === "(") score -= 280;
  if (next === "）" || next === ")") score -= 340;
  if ((next === "（" || next === "(") && i >= 2) score += 240;

  if (prev === "・" || prev === "、" || prev === " " || prev === "　") {
    score += i <= 3 && chars.length >= 10 ? 30 : 150;
  }
  if (next === "・" || next === "、") score -= 180;

  // カタカナ・ひらがな語・英数字・数字+単位・送り仮名・複合語の途中切れを抑止
  if (isAscii(prev) && isAscii(next)) score -= 220;
  if (isKatakana(prev) && isKatakana(next)) score -= 210;
  if (
    isHiragana(prev) &&
    isHiragana(next) &&
    !EVENT_TITLE_PARTICLES.has(prev) &&
    !EVENT_TITLE_PARTICLES.has(next)
  ) {
    score -= 210;
  }
  if (
    (prev === "第" && isDigit(next)) ||
    (isDigit(prev) && /[便名基世帯丁目時間度枚]/.test(next))
  ) {
    score -= 220;
  }
  if (isKanji(prev) && isHiragana(next) && !EVENT_TITLE_PARTICLES.has(next)) {
    score -= 220;
  }
  if (/[者替錠室所品用等]/.test(next)) score -= 210;
  if ((prev === "施" && next === "設") || (prev === "設" && next === "営")) {
    score -= 240;
  }
  if (l1.endsWith("に") && l2.startsWith("伴う")) score -= 220;
  if (l1.endsWith("おむつ") && l2.startsWith("替え")) score -= 210;

  if (EVENT_TITLE_BREAK_AFTER_PHRASES.some((ph) => l1.endsWith(ph))) {
    score += 140;
  }
  if (EVENT_TITLE_BREAK_BEFORE_PHRASES.some((ph) => l2.startsWith(ph))) {
    score += 105;
  }

  if (EVENT_TITLE_PARTICLES.has(prev) && !EVENT_TITLE_PARTICLES.has(next) && next !== "・") {
    score += 85;
  }
  if (EVENT_TITLE_PARTICLES.has(next) && !l2.startsWith("からの")) {
    score -= 105;
  }

  // 極端に短い孤立行を避け、中央バランスを微調整する
  if (chars.length - i <= 2) score -= 200;
  else if (chars.length - i === 3) score -= 50;
  if (i <= 2) score -= 170;
  else if (i === 3) score -= 45;

  score -= Math.abs(i - chars.length / 2) * 2;
  return score;
}

/**
 * イベントカードタイトルを2行以内に分割する際、助詞・中黒・括弧・複合語の境界で自然に改行する.
 * 明示的な改行（\n）がある場合はそれを優先する.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 * @returns {string[]}
 */
function splitEventTitleSmart(ctx, text, maxW) {
  const s = String(text || "");
  if (s.includes("\n")) {
    return wrapExplicitNewlines(ctx, s, maxW);
  }
  const raw = wrapTextByCharWidth(ctx, s, maxW);
  if (raw.length <= 1) return raw;

  const chars = Array.from(s);
  const depthBefore = [];
  let depth = 0;
  for (let k = 0; k < chars.length; k++) {
    depthBefore.push(depth);
    if (chars[k] === "（" || chars[k] === "(") depth++;
    else if ((chars[k] === "）" || chars[k] === ")") && depth > 0) depth--;
  }

  let best = null;
  for (let i = 1; i < chars.length; i++) {
    const l1 = chars.slice(0, i).join("");
    const l2 = chars.slice(i).join("");
    if (ctx.measureText(l1).width > maxW || ctx.measureText(l2).width > maxW) {
      continue;
    }
    const score = scoreEventTitleSplit(chars, i, depthBefore[i]);
    if (!best || score > best.score) {
      best = { score, lines: [l1, l2] };
    }
  }
  return best ? best.lines : raw;
}

/**
 * イベントカードタイトル用にフォントサイズと表示行（最大2行）を決定する.
 * カタカナ語・英数字・括弧内が途中切れしないサイズまで段階縮小して見栄えを整える.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} titleText
 * @param {number} maxW
 * @param {{ baseFontSize?: number, minPreferredFontSize?: number, minFontSize?: number }} [options]
 * @returns {{ fontSize: number, lines: string[] }}
 */
export function layoutEventTitleText(ctx, titleText, maxW, options = {}) {
  const text = String(titleText || "");
  const baseFs = options.baseFontSize ?? 54;
  const minPreferredFs = options.minPreferredFontSize ?? 40;
  const minFs = options.minFontSize ?? 14;

  const hasMidTokenBreak = (lines) => {
    if (lines.length !== 2) return false;
    const l1 = lines[0] || "";
    const l2 = lines[1] || "";
    const prev = l1.slice(-1);
    const next = l2.slice(0, 1);
    const midKata =
      prev !== "・" &&
      next !== "・" &&
      /[\u30A0-\u30FF]/.test(prev) &&
      /[\u30A0-\u30FF]/.test(next);
    const midAsc = /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next);
    const brokenParen =
      l1.split("（").length - l1.split("）").length > 0 ||
      l1.split("(").length - l1.split(")").length > 0;
    return midKata || midAsc || brokenParen;
  };

  for (let fs = baseFs; fs >= minFs; fs -= 2) {
    ctx.font = `bold ${fs}px sans-serif`;
    const lines = splitEventTitleSmart(ctx, text, maxW);
    if (lines.length <= 2) {
      if (hasMidTokenBreak(lines) && fs > minPreferredFs) {
        continue;
      }
      return { fontSize: fs, lines };
    }
  }

  ctx.font = `bold ${minFs}px sans-serif`;
  return { fontSize: minFs, lines: splitEventTitleSmart(ctx, text, maxW) };
}

/**
 * 避難者・ペットカード上部のグループ名＆「○名中 ○番目」ヘッダ帯（固定2行高さ）を描画する.
 * 提案A配色（避難者・ペット共通で高い視認性を維持）を使用する.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Record<string, any>} card
 * @param {number} width
 * @returns {number} 次要素（氏名）のベースラインY座標
 */
function drawGroupInfoBanner(ctx, card, width) {
  const boxX = 35;
  const boxY = 74;
  const boxW = width - 70;
  const boxH = 74;

  const rawGroupName = String(card.group_name || "").trim();
  const groupIdx = Number(card.group_index);
  const groupTot = Number(card.group_total);
  const hasPos =
    Number.isFinite(groupIdx) &&
    Number.isFinite(groupTot) &&
    groupIdx > 0 &&
    groupTot > 0;
  const posText = hasPos ? `${groupTot}名中 ${groupIdx}番目` : "";

  if (!rawGroupName && !posText) {
    return boxY + boxH + 56;
  }

  // 外枠＆薄い青背景（避難者・ペット共通の提案A配色）
  ctx.fillStyle = "#eff6ff";
  drawRoundRect(ctx, boxX, boxY, boxW, boxH, 8);
  ctx.fill();
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 左端アクセントバー（角丸に合わせてクリップ）
  ctx.save();
  drawRoundRect(ctx, boxX, boxY, boxW, boxH, 8);
  ctx.clip();
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(boxX, boxY, 8, boxH);
  ctx.restore();

  // 右側「○名中 ○番目」ピル
  let nameRightLimit = boxX + boxW - 14;
  if (posText) {
    ctx.font = "bold 23px sans-serif";
    const pillW = Math.ceil(ctx.measureText(posText).width + 24);
    const pillH = 34;
    const pillX = boxX + boxW - 12 - pillW;
    const pillY = boxY + Math.round((boxH - pillH) / 2);

    ctx.fillStyle = "#1d4ed8";
    drawRoundRect(ctx, pillX, pillY, pillW, pillH, 6);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(posText, pillX + pillW / 2, pillY + pillH / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    nameRightLimit = pillX - 10;
  }

  // 左側グループ名（1行収まり優先 → 長い場合は自動縮小＆スマート2行折り返し、超過分はクリップ）
  const displayGroupName = rawGroupName || "(グループ名未設定)";
  const nameStartX = boxX + 20;
  const nameMaxW = Math.max(40, nameRightLimit - nameStartX);
  const { fontSize: chosenFont, lines: drawnLines } = layoutGroupNameText(
    ctx,
    displayGroupName,
    nameMaxW
  );

  const visibleLines = (drawnLines || [displayGroupName]).slice(0, 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    boxX + 10,
    boxY + 2,
    Math.max(10, nameRightLimit - (boxX + 10)),
    boxH - 4
  );
  ctx.clip();
  ctx.fillStyle = rawGroupName ? "#1e3a8a" : "#64748b";
  ctx.font = `bold ${chosenFont}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (visibleLines.length === 1) {
    ctx.fillText(visibleLines[0], nameStartX, boxY + boxH / 2 + 1);
  } else {
    const lineH = Math.round(chosenFont * 1.24);
    const totalH = visibleLines.length * lineH;
    const firstMidY = boxY + Math.round((boxH - totalH) / 2 + lineH / 2);
    for (let li = 0; li < visibleLines.length; li++) {
      ctx.fillText(visibleLines[li], nameStartX, firstMidY + li * lineH);
    }
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";

  return boxY + boxH + 56;
}

/**
 * ロード済みの HTMLImageElement を使って、番号部分以外のベースカード Canvas を同期描画する.
 * 右下隅にはデータベース上の一意のカードID (`original_id`) を小さく描画する.
 * @param {Record<string, any>} card
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {HTMLImageElement | null} [loadedImg=null]
 * @param {{ layoutMode?: 'withGroupHeader' | 'legacy' }} [options]
 * @returns {HTMLCanvasElement}
 */
function renderBaseCardCanvasSync(
  card,
  designMode = "standard",
  loadedImg = null,
  options = {}
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const width = CARD_CANVAS_WIDTH;
  const height = CARD_CANVAS_HEIGHT;
  canvas.width = width;
  canvas.height = height;

  const isEvent = card.type === "イベント";
  const isPet = card.type === "ペット";
  const mainColor = isEvent ? "#ef4444" : isPet ? "#10b981" : "#3b82f6";
  const bgColor = isEvent ? "#fef2f2" : isPet ? "#ecfdf5" : "#f8fafc";
  const borderColor = isEvent ? "#fee2e2" : isPet ? "#a7f3d0" : "#f1f5f9";
  const textColor = isEvent ? "#7f1d1d" : "#0f172a";

  const isLarge = designMode === "largeText";

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Outer Border
  ctx.strokeStyle = mainColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(15, 15, width - 30, height - 30);

  // Badge (右上: 種別)
  ctx.fillStyle = isEvent ? "#fee2e2" : isPet ? "#d1fae5" : "#dbeafe";
  if (isLarge) {
    drawRoundRect(ctx, width - 180, 20, 150, 48, 24);
    ctx.fill();
    ctx.fillStyle = isEvent ? "#b91c1c" : isPet ? "#047857" : "#1d4ed8";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(card.type, width - 105, 54);
  } else {
    drawRoundRect(ctx, width - 150, 25, 120, 42, 21);
    ctx.fill();
    ctx.fillStyle = isEvent ? "#b91c1c" : isPet ? "#047857" : "#1d4ed8";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(card.type, width - 90, 54);
  }
  ctx.textAlign = "left";

  // Title
  ctx.fillStyle = textColor;
  ctx.font = isLarge ? "bold 72px sans-serif" : "bold 36px sans-serif";

  const wrapText = (text, x, y, maxWidth, lineHeight, maxLines) => {
    if (!text) return y;
    const chars = String(text).split("");
    let line = "";
    let lineCount = 0;
    let currentY = y;
    for (let n = 0; n < chars.length; n++) {
      const testLine = line + chars[n];
      if (ctx.measureText(testLine).width > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = chars[n];
        currentY += lineHeight;
        lineCount++;
        if (lineCount >= maxLines) return currentY;
      } else {
        line = testLine;
      }
    }
    if (lineCount < maxLines) {
      ctx.fillText(line, x, currentY);
      currentY += lineHeight;
    }
    return currentY;
  };

  const layoutMode = resolveEvacueeCardLayoutMode(card, options);
  const useGroupHeader = !isEvent && !isLarge && layoutMode === "withGroupHeader";

  let currentY = isLarge ? 130 : 110;
  if (useGroupHeader) {
    currentY = drawGroupInfoBanner(ctx, card, width);
    ctx.fillStyle = textColor;
  }
  const cardName = String(card.name || (isEvent ? "(イベント名未設定)" : "(氏名自動生成)"));

  if (!isEvent) {
    let titleFontSize = isLarge ? 72 : 54;
    ctx.font = `bold ${titleFontSize}px sans-serif`;
    let textWidth = ctx.measureText(cardName).width;
    while (textWidth > width - 70 && titleFontSize > 12) {
      titleFontSize -= 2;
      ctx.font = `bold ${titleFontSize}px sans-serif`;
      textWidth = ctx.measureText(cardName).width;
    }
    ctx.fillText(cardName, 35, currentY);
    currentY += isLarge ? 15 : 10;
  } else {
    const eventTitleLayoutMode = resolveEventCardTitleLayoutMode(card, options);
    const baseTitleFont = isLarge ? 72 : 54;
    const maxTitleWidth = width - 70;

    if (eventTitleLayoutMode === "fixedTwoLine") {
      const baseLineHeight = Math.floor(baseTitleFont * 1.15);
      const { fontSize: titleFontSize, lines: rawLines } = layoutEventTitleText(
        ctx,
        cardName,
        maxTitleWidth,
        {
          baseFontSize: baseTitleFont,
          minPreferredFontSize: isLarge ? 52 : 40,
          minFontSize: 14,
        }
      );
      const visibleLines = (
        rawLines && rawLines.length ? rawLines : [cardName]
      ).slice(0, 2);
      const titleLineHeight = Math.floor(titleFontSize * 1.15);

      // 1行タイトルも2行タイトルもイラスト開始Y座標を完全固定するため、2行枠の中央を基準に配置する
      const refCenterBaseline = currentY + Math.floor(baseLineHeight / 2);
      const blockSpan = (visibleLines.length - 1) * titleLineHeight;
      const startBaselineY = Math.round(
        refCenterBaseline - blockSpan / 2 + (baseTitleFont - titleFontSize) * 0.35
      );

      ctx.fillStyle = textColor;
      ctx.font = `bold ${titleFontSize}px sans-serif`;
      ctx.textAlign = "left";
      for (let i = 0; i < visibleLines.length; i++) {
        ctx.fillText(visibleLines[i], 35, startBaselineY + i * titleLineHeight);
      }

      currentY += baseLineHeight;
      currentY += isLarge ? 15 : 10;
    } else {
      let titleFontSize = baseTitleFont;
      let titleLineHeight = Math.floor(titleFontSize * 1.15);
      ctx.font = `bold ${titleFontSize}px sans-serif`;

      while (titleFontSize > 12) {
        if (!cardName) break;
        const chars = cardName.split("");
        let testLine = "";
        let testLineCount = 1;
        for (let n = 0; n < chars.length; n++) {
          const testNext = testLine + chars[n];
          if (ctx.measureText(testNext).width > maxTitleWidth && n > 0) {
            testLine = chars[n];
            testLineCount++;
          } else {
            testLine = testNext;
          }
        }
        if (testLineCount <= 2) {
          break;
        }
        titleFontSize -= 2;
        titleLineHeight = Math.floor(titleFontSize * 1.15);
        ctx.font = `bold ${titleFontSize}px sans-serif`;
      }

      const linesRendered =
        (wrapText(cardName, 35, currentY, maxTitleWidth, titleLineHeight, 2) -
          currentY) /
        titleLineHeight;
      currentY += (Math.max(1, linesRendered) - 1) * titleLineHeight;
      currentY += isLarge ? 15 : 10;
    }
  }

  const validAge =
    card.age !== undefined && card.age !== null && card.age !== "" && card.age !== "-"
      ? String(card.age)
      : "";
  const validGender =
    card.gender !== undefined &&
    card.gender !== null &&
    card.gender !== "" &&
    card.gender !== "-"
      ? String(card.gender)
      : "";
  const validOrigin =
    card.origin !== undefined &&
    card.origin !== null &&
    card.origin !== "" &&
    card.origin !== "-"
      ? String(card.origin)
      : "";

  // Image
  let hasDrawnSideBadges = false;
  if (loadedImg && loadedImg.width > 0 && loadedImg.height > 0) {
    let imgAreaWidth = width - 70;
    if (!isEvent && (validAge || validGender)) {
      imgAreaWidth = width - 70 - (isLarge ? 150 : 110);
    }

    const imgAreaHeight = 300;
    const scale = Math.min(
      imgAreaWidth / loadedImg.width,
      imgAreaHeight / loadedImg.height
    );
    const drawWidth = loadedImg.width * scale;
    const drawHeight = loadedImg.height * scale;
    const drawX = 35 + (imgAreaWidth - drawWidth) / 2;
    const drawY = currentY + 10 + (imgAreaHeight - drawHeight) / 2;

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(35, currentY + 10, imgAreaWidth, imgAreaHeight);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.strokeRect(35, currentY + 10, imgAreaWidth, imgAreaHeight);

    ctx.drawImage(loadedImg, drawX, drawY, drawWidth, drawHeight);

    if (!isEvent && (validAge || validGender)) {
      const sideX = 35 + imgAreaWidth + 10;
      const badgesCount = (validAge ? 1 : 0) + (validGender ? 1 : 0);
      const badgeFontSize = isLarge ? 56 : 36;
      const badgeHeight = badgeFontSize + 12;
      const totalSideHeight =
        badgesCount * badgeHeight +
        (badgesCount > 0 ? badgesCount - 1 : 0) * 20;

      let sideY = currentY + 10 + (imgAreaHeight - totalSideHeight) / 2;

      const drawSideBadge = (text) => {
        ctx.font = `bold ${badgeFontSize}px sans-serif`;
        ctx.fillStyle = "#f1f5f9";
        const textWidth = ctx.measureText(text).width;
        drawRoundRect(ctx, sideX, sideY, textWidth + 20, badgeHeight, 6);
        ctx.fill();
        ctx.fillStyle = "#334155";
        ctx.fillText(
          text,
          sideX + 10,
          sideY + badgeHeight / 2 + badgeFontSize / 3
        );
        sideY += badgeHeight + 20;
      };

      if (validAge) {
        drawSideBadge(
          validAge.includes("歳") ? validAge : `${validAge}歳`
        );
      }
      if (validGender) {
        drawSideBadge(validGender);
      }
      hasDrawnSideBadges = true;
    }

    currentY += imgAreaHeight + (isLarge ? 20 : 15);
  } else {
    currentY += isLarge ? 10 : 5;
  }

  // Attributes (Age / Gender / Origin)
  if (!isEvent) {
    let attrX = 35;
    let badgeMaxHeight = 0;
    const drawBadge = (text, fontSize) => {
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = "#f1f5f9";
      const textWidth = ctx.measureText(text).width;
      const badgeHeight = fontSize + 12;
      if (badgeHeight > badgeMaxHeight) badgeMaxHeight = badgeHeight;
      drawRoundRect(ctx, attrX, currentY, textWidth + 20, badgeHeight, 6);
      ctx.fill();
      ctx.fillStyle = "#334155";
      ctx.fillText(
        text,
        attrX + 10,
        currentY + badgeHeight / 2 + fontSize / 3
      );
      attrX += textWidth + (isLarge ? 40 : 30);
    };

    if (validAge && !hasDrawnSideBadges) {
      drawBadge(
        validAge.includes("歳") ? validAge : `${validAge}歳`,
        isLarge ? 72 : 36
      );
    }
    if (validGender && !hasDrawnSideBadges) {
      drawBadge(validGender, isLarge ? 72 : 36);
    }
    if (validOrigin) {
      if ((validAge || validGender) && !hasDrawnSideBadges) {
        attrX = 35;
        currentY += badgeMaxHeight + (isLarge ? 20 : 10);
        badgeMaxHeight = 0;
      }
      let displayOrigin = validOrigin;
      if (displayOrigin.length > 25) {
        displayOrigin = displayOrigin.substring(0, 25) + "...";
      }
      drawBadge(displayOrigin, isLarge ? 36 : 40);
    }

    currentY += badgeMaxHeight + (isLarge ? 20 : 15);
  } else {
    currentY += isLarge ? 20 : 15;
  }

  // Attributes (属性)
  if (card.attributes) {
    currentY += isLarge ? 30 : 15;

    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("属性:", 35, currentY);

    const labelWidth = ctx.measureText("属性:").width;

    ctx.fillStyle = "#334155";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText(String(card.attributes), 35 + labelWidth + 15, currentY);

    currentY += isLarge ? 30 : 20;
  }

  // Detailed Flags
  if (Array.isArray(card.detailedFlags) && card.detailedFlags.length > 0) {
    let flagX = 35;
    const drawFlagBadge = (text, fontSize) => {
      ctx.font = `bold ${fontSize}px sans-serif`;

      let flagBg = "#f1f5f9";
      let flagText = "#334155";
      if (VALID_FLAGS["健康"].includes(text)) {
        flagBg = "#fee2e2";
        flagText = "#000000";
      } else if (VALID_FLAGS["スキル"].includes(text)) {
        flagBg = "#dcfce7";
        flagText = "#000000";
      } else if (VALID_FLAGS["配慮事項"].includes(text)) {
        flagBg = "#fef3c7";
        flagText = "#000000";
      }

      const textWidth = ctx.measureText(text).width;
      const badgeHeight = fontSize + 16;

      if (flagX + textWidth + 20 > width - 35) {
        flagX = 35;
        currentY += badgeHeight + 10;
      }

      ctx.fillStyle = flagBg;
      drawRoundRect(ctx, flagX, currentY, textWidth + 20, badgeHeight, 6);
      ctx.fill();
      ctx.fillStyle = flagText;
      ctx.fillText(
        text,
        flagX + 10,
        currentY + badgeHeight / 2 + fontSize / 3
      );
      flagX += textWidth + 30;
    };

    card.detailedFlags.forEach((flag) => {
      drawFlagBadge(String(flag), isLarge ? 50 : 26);
    });
    currentY += isLarge ? 80 : 50;
  }

  // Dialogue Box (下部にデータベース一意ID用の余白を確保)
  if (!isLarge) {
    const boxHeight = Math.max(60, height - currentY - 46);
    ctx.fillStyle = bgColor;
    drawRoundRect(ctx, 35, currentY, width - 70, boxHeight, 8);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    const clipDialogue = useGroupHeader;
    const minDialogueFont = clipDialogue ? 25 : 12;

    ctx.fillStyle = "#0f172a";
    let dialogueFontSize = 33;
    let dialogueLineHeight = Math.floor(dialogueFontSize * 1.45);
    ctx.font = `bold ${dialogueFontSize}px sans-serif`;
    const dialogueText = String(card.dialogue || "");

    while (dialogueFontSize > minDialogueFont) {
      if (!dialogueText) break;
      const chars = dialogueText.split("");
      let testLine = "";
      let testLineCount = 1;
      for (let n = 0; n < chars.length; n++) {
        const testNext = testLine + chars[n];
        if (ctx.measureText(testNext).width > width - 110 && n > 0) {
          testLine = chars[n];
          testLineCount++;
        } else {
          testLine = testNext;
        }
      }

      const maxLinesFit = Math.floor((boxHeight - 20) / dialogueLineHeight);
      if (testLineCount <= maxLinesFit) {
        break;
      }
      dialogueFontSize -= 2;
      dialogueLineHeight = Math.floor(dialogueFontSize * 1.45);
      ctx.font = `bold ${dialogueFontSize}px sans-serif`;
    }

    const finalMaxLinesFit = clipDialogue
      ? Math.max(1, Math.floor((boxHeight - 16) / dialogueLineHeight))
      : Math.ceil((boxHeight - 20) / dialogueLineHeight);
    if (clipDialogue) {
      ctx.save();
      drawRoundRect(ctx, 35, currentY, width - 70, boxHeight, 8);
      ctx.clip();
    }
    wrapText(
      dialogueText,
      55,
      currentY + Math.floor(dialogueLineHeight * 1.1),
      width - 110,
      dialogueLineHeight,
      finalMaxLinesFit
    );
    if (clipDialogue) {
      ctx.restore();
    }
  }

  // カード画像の右下隅にデータベース上の一意のカードID (EV-xxx / M-xxxx 等) を小さく描画
  const dbCardId = String(card.original_id || card.id || "").trim();
  if (dbCardId) {
    ctx.save();
    ctx.font = "bold 17px monospace";
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`ID: ${dbCardId}`, width - 26, height - 23);
    ctx.restore();
  }

  return canvas;
}

/**
 * ベースカード Canvas の上にカード番号 (`No. X`) を合成して DataURL を返す.
 * @param {HTMLCanvasElement} baseCanvas
 * @param {string} numberText
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @returns {string}
 */
function composeCardNumberOnBaseCanvas(
  baseCanvas,
  numberText,
  designMode = "standard"
) {
  const canvas = document.createElement("canvas");
  canvas.width = baseCanvas.width;
  canvas.height = baseCanvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return baseCanvas.toDataURL("image/png");

  ctx.drawImage(baseCanvas, 0, 0);
  const isLarge = designMode === "largeText";
  ctx.fillStyle = "#0f172a";
  ctx.font = isLarge ? "bold 50px monospace" : "bold 39px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`No. ${numberText}`, 35, isLarge ? 60 : 55);
  return canvas.toDataURL("image/png");
}

/**
 * イラスト画像を非同期ロードしてキャッシュする.
 * @param {string} url
 * @returns {Promise<HTMLImageElement | null>}
 */
async function loadImageElement(url) {
  if (!url) return null;
  if (loadedImageElementCache.has(url)) {
    return loadedImageElementCache.get(url);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setBoundedMap(
        loadedImageElementCache,
        url,
        img,
        MAX_IMAGE_ELEMENT_CACHE_ENTRIES
      );
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * 番号以外のベースカード Canvas と DataURL を取得（キャッシュ済みなら即返却）する.
 * @param {Record<string, any>} card
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ layoutMode?: 'withGroupHeader' | 'legacy' }} [options]
 * @returns {Promise<{ canvas: HTMLCanvasElement, dataUrl: string }>}
 */
export async function generateBaseCardCanvas(
  card,
  designMode = "standard",
  options = {}
) {
  const key = buildBaseCardCacheKey(card, designMode, true, options);
  if (baseCardCanvasCache.has(key)) {
    return baseCardCanvasCache.get(key);
  }
  const loadedImg = card.imageUrl ? await loadImageElement(card.imageUrl) : null;
  const canvas = renderBaseCardCanvasSync(card, designMode, loadedImg, options);
  const dataUrl = canvas.toDataURL("image/png");
  const entry = {
    canvas,
    dataUrl,
  };
  setBoundedMap(baseCardCanvasCache, key, entry, MAX_CANVAS_CACHE_ENTRIES);
  setBoundedMap(baseCardDataUrlCache, key, dataUrl, MAX_DATAURL_CACHE_ENTRIES);
  return entry;
}

/**
 * 同期的に即座に取得可能なカード画像 DataURL を返す.
 * イラスト画像が未ロードの場合でも、まずイラストなしベース画像を即座に返すため白紙にならない.
 * @param {Record<string, any>} card
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ showNumber?: boolean, layoutMode?: 'withGroupHeader' | 'legacy' }} [options]
 * @returns {{ dataUrl: string, isComplete: boolean }}
 */
export function getCardImageDataUrlSync(
  card,
  designMode = "standard",
  options = {}
) {
  const showNum = shouldDrawCardNumber(card, options);
  const baseCompleteKey = buildBaseCardCacheKey(card, designMode, true, options);
  const fullCacheKey = JSON.stringify({
    baseKey: baseCompleteKey,
    id: showNum ? String(card.id) : "",
    showNum,
  });
  if (cardImageCache.has(fullCacheKey)) {
    return { dataUrl: cardImageCache.get(fullCacheKey), isComplete: true };
  }
  if (!showNum && baseCardDataUrlCache.has(baseCompleteKey)) {
    const cachedUrl = baseCardDataUrlCache.get(baseCompleteKey);
    setBoundedMap(
      cardImageCache,
      fullCacheKey,
      cachedUrl,
      MAX_DATAURL_CACHE_ENTRIES
    );
    return { dataUrl: cachedUrl, isComplete: true };
  }

  const hasReadyImage =
    !card.imageUrl || loadedImageElementCache.has(card.imageUrl);
  const baseKey = buildBaseCardCacheKey(card, designMode, hasReadyImage, options);
  let baseEntry = baseCardCanvasCache.get(baseKey);
  if (!baseEntry) {
    const imgEl =
      hasReadyImage && card.imageUrl
        ? loadedImageElementCache.get(card.imageUrl)
        : null;
    const canvas = renderBaseCardCanvasSync(card, designMode, imgEl, options);
    const dataUrl = canvas.toDataURL("image/png");
    baseEntry = { canvas, dataUrl };
    setBoundedMap(baseCardCanvasCache, baseKey, baseEntry, MAX_CANVAS_CACHE_ENTRIES);
    if (hasReadyImage) {
      setBoundedMap(
        baseCardDataUrlCache,
        baseKey,
        dataUrl,
        MAX_DATAURL_CACHE_ENTRIES
      );
    }
  }

  const outUrl = showNum
    ? composeCardNumberOnBaseCanvas(baseEntry.canvas, String(card.id), designMode)
    : baseEntry.dataUrl;

  if (hasReadyImage) {
    setBoundedMap(
      cardImageCache,
      fullCacheKey,
      outUrl,
      MAX_DATAURL_CACHE_ENTRIES
    );
  }
  return { dataUrl: outUrl, isComplete: hasReadyImage };
}

// 非同期・ビューポート優先レンダリングキュー（メインスレッドとHTTP接続の飽和を防止）
const renderQueue = [];
const queuedElementMap = new WeakMap();
let activeRenderCount = 0;
const MAX_CONCURRENT_RENDERS = 3;
let syncRendersThisFrame = 0;
let syncResetScheduled = false;
let cardVisibilityObserver = null;

function scheduleSyncCounterReset() {
  if (syncResetScheduled) return;
  syncResetScheduled = true;
  setTimeout(() => {
    syncRendersThisFrame = 0;
    syncResetScheduled = false;
  }, 16);
}

function pumpRenderQueue() {
  while (activeRenderCount < MAX_CONCURRENT_RENDERS && renderQueue.length > 0) {
    const task = renderQueue.shift();
    if (!task || !task.imgEl) continue;
    const currentToken = queuedElementMap.get(task.imgEl);
    if (currentToken && currentToken !== task) continue;
    queuedElementMap.delete(task.imgEl);

    activeRenderCount++;
    generateCardImageCanvas(task.card, task.designMode, task.options)
      .then((finalUrl) => {
        if (task.imgEl.isConnected || !task.imgEl.src || task.imgEl.src.startsWith("data:image/svg+xml")) {
          task.imgEl.src = finalUrl;
        }
      })
      .catch(() => {})
      .finally(() => {
        activeRenderCount = Math.max(0, activeRenderCount - 1);
        if (renderQueue.length > 0) {
          setTimeout(pumpRenderQueue, 0);
        }
      });
  }
}

function enqueueCardRenderTask(task, highPriority = false) {
  const existingIdx = renderQueue.indexOf(task);
  if (existingIdx !== -1) {
    if (highPriority && existingIdx > 0) {
      renderQueue.splice(existingIdx, 1);
      renderQueue.unshift(task);
    }
    pumpRenderQueue();
    return;
  }
  if (highPriority) {
    renderQueue.unshift(task);
  } else {
    renderQueue.push(task);
  }
  pumpRenderQueue();
}

function getCardVisibilityObserver() {
  if (cardVisibilityObserver || typeof IntersectionObserver === "undefined") {
    return cardVisibilityObserver;
  }
  cardVisibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const imgEl = entry.target;
          cardVisibilityObserver.unobserve(imgEl);
          const task = queuedElementMap.get(imgEl);
          if (task) {
            enqueueCardRenderTask(task, true);
          }
        }
      }
    },
    { rootMargin: "500px 0px" }
  );
  return cardVisibilityObserver;
}

/**
 * `<img>` 要素に対して出力予定のカード画像をバインドする（キャッシュ即時表示＋ビューポート優先非同期描画）.
 * @param {HTMLImageElement} imgEl
 * @param {Record<string, any>} card
 * @param {{ showNumber?: boolean, designMode?: 'standard' | 'largeText' }} [options]
 */
export function bindCardCanvasImage(imgEl, card, options = {}) {
  if (!imgEl || !card) return;
  const designMode = options.designMode || FIXED_DESIGN_MODE;
  const showNum = shouldDrawCardNumber(card, options);
  const baseCompleteKey = buildBaseCardCacheKey(card, designMode, true, options);
  const fullCacheKey = JSON.stringify({
    baseKey: baseCompleteKey,
    id: showNum ? String(card.id) : "",
    showNum,
  });

  // 1. すでに完成画像がキャッシュ済みなら 0ms で即時設定
  if (cardImageCache.has(fullCacheKey)) {
    imgEl.src = cardImageCache.get(fullCacheKey);
    return;
  }
  if (!showNum && baseCardDataUrlCache.has(baseCompleteKey)) {
    const cachedUrl = baseCardDataUrlCache.get(baseCompleteKey);
    setBoundedMap(
      cardImageCache,
      fullCacheKey,
      cachedUrl,
      MAX_DATAURL_CACHE_ENTRIES
    );
    imgEl.src = cachedUrl;
    return;
  }

  // 2. 1フレーム内の最初の数枚（ライブプレビュー・訓練表示・一覧先頭）でイラスト待ちが不要な場合は同期描画
  const hasReadyImage =
    !card.imageUrl || loadedImageElementCache.has(card.imageUrl);
  scheduleSyncCounterReset();
  if (hasReadyImage && syncRendersThisFrame < 4) {
    syncRendersThisFrame++;
    const syncRes = getCardImageDataUrlSync(card, designMode, options);
    imgEl.src = syncRes.dataUrl;
    return;
  }

  // 3. それ以外は軽量SVGプレースホルダを即座に設定し、非同期キュー（ビューポート優先）で描画
  imgEl.src = PLACEHOLDER_CARD_DATA_URL;
  const task = { imgEl, card, designMode, options };
  queuedElementMap.set(imgEl, task);

  const observer = getCardVisibilityObserver();
  if (observer) {
    observer.observe(imgEl);
  }
  enqueueCardRenderTask(task, syncRendersThisFrame < 8);
  syncRendersThisFrame++;
}

/**
 * 複数カードの「番号なしベース画像」をあらかじめバックグラウンド（アイドル時）で少数ずつ生成・キャッシュする.
 * @param {Array<Record<string, any>>} cards
 */
export async function prebuildCardBaseImages(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  const posList = computeGroupPositionsByIndex(cards);
  const limit = Math.min(cards.length, 12);
  for (let i = 0; i < limit; i++) {
    while (activeRenderCount > 0 || renderQueue.length > 0) {
      await new Promise((r) => setTimeout(r, 120));
    }
    const c = cards[i];
    const pos = posList[i];
    const model = toCardRenderModel(c, c?.group || null, {
      groupIndex: c?.group_index ?? pos?.group_index,
      groupTotal: c?.group_total ?? pos?.group_total,
    });
    if (model) {
      try {
        await generateBaseCardCanvas(model, FIXED_DESIGN_MODE);
      } catch {
        // ignore individual card prebuild errors
      }
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

/**
 * 完成カード画像 (600x993 名刺縦横比 PNG DataURL) を Canvas で描画する.
 * あらかじめ生成・キャッシュされたベース画像（番号以外）を利用し、通し番号がある場合のみ左上に `No. X` を合成する.
 * @param {Record<string, any>} card
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ showNumber?: boolean, layoutMode?: 'withGroupHeader' | 'legacy' }} [options]
 * @returns {Promise<string>}
 */
export const generateCardImageCanvas = async (
  card,
  designMode = "standard",
  options = {}
) => {
  const showNum = shouldDrawCardNumber(card, options);
  const baseCompleteKey = buildBaseCardCacheKey(card, designMode, true, options);
  const fullCacheKey = JSON.stringify({
    baseKey: baseCompleteKey,
    id: showNum ? String(card.id) : "",
    showNum,
  });
  if (cardImageCache.has(fullCacheKey)) {
    return cardImageCache.get(fullCacheKey);
  }
  if (!showNum && baseCardDataUrlCache.has(baseCompleteKey)) {
    const cachedUrl = baseCardDataUrlCache.get(baseCompleteKey);
    setBoundedMap(
      cardImageCache,
      fullCacheKey,
      cachedUrl,
      MAX_DATAURL_CACHE_ENTRIES
    );
    return cachedUrl;
  }

  const baseEntry = await generateBaseCardCanvas(card, designMode, options);
  const finalDataUrl = showNum
    ? composeCardNumberOnBaseCanvas(baseEntry.canvas, String(card.id), designMode)
    : baseEntry.dataUrl;

  setBoundedMap(
    cardImageCache,
    fullCacheKey,
    finalDataUrl,
    MAX_DATAURL_CACHE_ENTRIES
  );
  return finalDataUrl;
};

/**
 * k-hug2026 のイベント・構成員レコードまたはデッキカードオブジェクトを HugCard 描画モデルへ変換する.
 * @param {Record<string, any>} item
 * @param {Record<string, any> | null} [group]
 * @param {{ cardNumber?: number | string | null, imageIds?: Set<string> | string[] | null }} [options]
 * @returns {Record<string, any>}
 */
function resolveCardImageUrl(origId, ver = "") {
  if (typeof store.resolveImageUrl === "function") {
    return store.resolveImageUrl(origId, ver);
  }
  return `/api/images/${encodeURIComponent(origId)}${ver ? `?v=${ver}` : ""}`;
}

export function toCardRenderModel(item, group = null, options = {}) {
  if (!item) return null;

  const imageSet =
    options.imageIds instanceof Set
      ? options.imageIds
      : Array.isArray(options.imageIds)
        ? new Set(options.imageIds)
        : store.imageIds instanceof Set
          ? store.imageIds
          : new Set();

  // すでに HugCard 形式 (type === '避難者' | 'ペット' | 'イベント' かつ dialogue を持つ) の場合
  if (
    (item.type === "避難者" ||
      item.type === "ペット" ||
      item.type === "イベント") &&
    "dialogue" in item
  ) {
    const origId = String(item.original_id || item.id);
    const displayId =
      options.cardNumber !== undefined && options.cardNumber !== null
        ? String(options.cardNumber)
        : String(item.id || origId);
    const hasImage = Boolean(item.has_image || item.hasImage || imageSet.has(origId));
    const ver = (store.imageCacheBust && store.imageCacheBust[origId]) || "";
    const imageUrl =
      item.imageUrl && String(item.imageUrl).startsWith("data:")
        ? item.imageUrl
        : hasImage
          ? resolveCardImageUrl(origId, ver)
          : null;
    const resolvedGroupName =
      options.groupName !== undefined && options.groupName !== null
        ? String(options.groupName)
        : String(item.group_name || group?.group_name || "");
    const resolvedGroupIdx =
      options.groupIndex !== undefined && options.groupIndex !== null
        ? Number(options.groupIndex)
        : item.group_index ?? null;
    const resolvedGroupTot =
      options.groupTotal !== undefined && options.groupTotal !== null
        ? Number(options.groupTotal)
        : item.group_total ?? null;
    return {
      ...item,
      id: displayId,
      original_id: origId,
      group_name: resolvedGroupName,
      group_index: resolvedGroupIdx,
      group_total: resolvedGroupTot,
      hasImage,
      imageUrl,
    };
  }

  // DeckCard 形式 ({ card_number, kind, original_id, data, group }) の場合
  if (item.data && item.kind && item.original_id) {
    return toCardRenderModel(item.data, item.group || group, {
      ...options,
      cardNumber:
        options.cardNumber !== undefined && options.cardNumber !== null
          ? options.cardNumber
          : item.card_number,
      originalId: item.original_id,
      groupName:
        options.groupName !== undefined && options.groupName !== null
          ? options.groupName
          : item.group_name,
      groupIndex:
        options.groupIndex !== undefined && options.groupIndex !== null
          ? options.groupIndex
          : item.group_index,
      groupTotal:
        options.groupTotal !== undefined && options.groupTotal !== null
          ? options.groupTotal
          : item.group_total,
    });
  }

  // イベントレコード
  if ("event_name" in item || item.kind === "event" || String(item.card_id || "").startsWith("EV-")) {
    const origId = String(options.originalId || item.card_id || "PREVIEW");
    const displayId =
      options.cardNumber !== undefined && options.cardNumber !== null
        ? String(options.cardNumber)
        : origId;
    const hasImage = imageSet.has(origId);
    const ver = (store.imageCacheBust && store.imageCacheBust[origId]) || "";
    return {
      id: displayId,
      original_id: origId,
      kind: "event",
      type: "イベント",
      name: String(item.event_name || ""),
      origin: "-",
      age: "-",
      gender: "-",
      attributes: String(item.source || ""),
      detailedFlags: Array.isArray(item.category)
        ? item.category.filter(Boolean).map(String)
        : [],
      appearance: String(item.scene_description || ""),
      dialogue: String(item.content || ""),
      points: String(item.training_point || ""),
      hasImage,
      imageUrl: hasImage
        ? resolveCardImageUrl(origId, ver)
        : null,
    };
  }

  // 構成員レコード (人物 / ペット)
  const origId = String(options.originalId || item.member_id || "PREVIEW");
  const displayId =
    options.cardNumber !== undefined && options.cardNumber !== null
      ? String(options.cardNumber)
      : origId;
  const isPet = item.data_type === "ペット";
  const grp = group || {};
  const origin = String(grp.evacuation_origin || item.evacuation_origin || "");
  const rawAge = item.age;
  const ageStr =
    rawAge === null || rawAge === undefined || rawAge === ""
      ? ""
      : String(rawAge);
  const gender = String(item.gender || "");
  const appearance = String(item.appearance || "");
  const points = String(item.training_point || "");

  let flags = [];
  let rel = "";
  let dialogue = "";

  if (isPet) {
    rel = String(item.relationship || "ペット");
    const pVulns = (item.pet_vulnerabilities || []).filter(Boolean).map(String);
    const pHealth = (item.pet_health_condition || [])
      .filter((x) => x && String(x) !== "良好")
      .map(String);
    const pSkills = (item.pet_skills || []).filter(Boolean).map(String);
    flags = [...pVulns, ...pHealth, ...pSkills];
    dialogue = appearance;
  } else {
    rel = String(item.relationship || "");
    const vulns = (item.vulnerabilities || []).filter(Boolean).map(String);
    const health = (item.health_condition || [])
      .filter((x) => x && String(x) !== "良好")
      .map(String);
    const skills = (item.skills || []).filter(Boolean).map(String);
    flags = [...vulns, ...health, ...skills];
    dialogue = String(item.statement || "");
  }

  const hasImage = imageSet.has(origId);
  const ver = (store.imageCacheBust && store.imageCacheBust[origId]) || "";

  const resolvedGroupIdx =
    options.groupIndex !== undefined && options.groupIndex !== null
      ? Number(options.groupIndex)
      : item.group_index ?? null;
  const resolvedGroupTot =
    options.groupTotal !== undefined && options.groupTotal !== null
      ? Number(options.groupTotal)
      : item.group_total ?? null;

  return {
    id: displayId,
    original_id: origId,
    group_id: String(item.group_id || grp.group_id || ""),
    group_name: String(
      options.groupName !== undefined && options.groupName !== null
        ? options.groupName
        : grp.group_name || item.group_name || ""
    ),
    group_index: resolvedGroupIdx,
    group_total: resolvedGroupTot,
    kind: isPet ? "pet" : "person",
    type: isPet ? "ペット" : "避難者",
    name: String(item.name || ""),
    origin,
    age: ageStr,
    gender,
    attributes: rel,
    detailedFlags: flags,
    appearance,
    dialogue,
    points,
    hasImage,
    imageUrl: hasImage
      ? resolveCardImageUrl(origId, ver)
      : null,
  };
}

/**
 * 複数カードの完成画像を20枚並列チャンクで高速生成する.
 * @param {Array<Record<string, any>>} cardsToProcess
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ onProgress?: (current: number, total: number) => void, signal?: { cancelled?: boolean } }} [options]
 * @returns {Promise<Map<string, string>>}
 */
export async function generateCardImagesBatch(
  cardsToProcess,
  designMode = "standard",
  options = {}
) {
  const results = new Map();
  const concurrency = 20;

  for (let i = 0; i < cardsToProcess.length; i += concurrency) {
    if (options.signal && options.signal.cancelled) {
      throw new Error("CANCELLED");
    }

    const chunk = cardsToProcess.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (card) => {
      const cacheKey = JSON.stringify({
        card,
        designMode,
        layoutMode: resolveEvacueeCardLayoutMode(card, options),
        eventTitleLayoutMode: resolveEventCardTitleLayoutMode(card, options),
      });
      if (cardImageCache.has(cacheKey)) {
        return { id: String(card.id), dataUrl: cardImageCache.get(cacheKey) };
      }

      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        const dataUrl = await generateCardImageCanvas(card, designMode, options);
        setBoundedMap(
          cardImageCache,
          cacheKey,
          dataUrl,
          MAX_DATAURL_CACHE_ENTRIES
        );
        return { id: String(card.id), dataUrl };
      } catch (err) {
        console.error(`Failed to generate image for card ${card.id}`, err);
        return { id: String(card.id), dataUrl: null };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    chunkResults.forEach((res) => {
      if (res.dataUrl) results.set(res.id, res.dataUrl);
    });

    if (options.onProgress) {
      options.onProgress(
        Math.min(i + concurrency, cardsToProcess.length),
        cardsToProcess.length
      );
    }
  }

  return results;
}

let vendorScriptsLoadPromise = null;

async function ensureVendorLibraries() {
  if (window.jspdf && window.JSZip) return;
  if (!vendorScriptsLoadPromise) {
    vendorScriptsLoadPromise = (async () => {
      const loadScript = (src) =>
        new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      const jspdfUrl = new URL("../vendor/jspdf.umd.min.js", import.meta.url).href;
      const jszipUrl = new URL("../vendor/jszip.min.js", import.meta.url).href;
      if (!window.jspdf) {
        await loadScript(jspdfUrl);
      }
      if (!window.JSZip) {
        await loadScript(jszipUrl);
      }
    })();
  }
  await vendorScriptsLoadPromise;
}

/**
 * カード配列を指定印刷サイズ（デフォルト: 名刺サイズ 5.5×9.1cm）で A4横・裁断線付き PDF に変換して出力する.
 * @param {Array<Record<string, any>>} cards
 * @param {keyof typeof PRINT_SIZES} [printSizeId='business']
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ download?: boolean, filename?: string, onProgress?: (c: number, t: number) => void, signal?: { cancelled?: boolean } }} [options]
 * @returns {Promise<{ blob: Blob, pageCount: number, cols: number, rows: number }>}
 */
export async function exportCardsAsPdf(
  cards,
  printSizeId = "business",
  designMode = "standard",
  options = {}
) {
  await ensureVendorLibraries();
  const { jsPDF } = window.jspdf;

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const printConfig = PRINT_SIZES[printSizeId] || PRINT_SIZES.business;
  const cols = printConfig.cols;
  const rows = printConfig.rows;
  const cardsPerPage = cols * rows;

  const cardWidth = printConfig.width;
  const cardHeight = printConfig.height;
  const marginX = (297 - cardWidth * cols) / 2;
  const marginY = (210 - cardHeight * rows) / 2;

  const imagesMap = await generateCardImagesBatch(cards, designMode, options);
  let pageCount = 1;

  for (let i = 0; i < cards.length; i++) {
    if (options.signal && options.signal.cancelled) {
      throw new Error("CANCELLED");
    }

    const card = cards[i];
    const imgData = imagesMap.get(String(card.id));

    if (imgData) {
      const posOnPage = i % cardsPerPage;
      if (posOnPage === 0 && i > 0) {
        pdf.addPage();
        pageCount++;
      }

      const col = posOnPage % cols;
      const row = Math.floor(posOnPage / cols);
      const x = marginX + col * cardWidth;
      const y = marginY + row * cardHeight;

      pdf.addImage(imgData, "PNG", x, y, cardWidth, cardHeight);

      // 裁断線 (薄いグレー 0.1mm)
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.1);
      pdf.rect(x, y, cardWidth, cardHeight);
    }
  }

  if (options.signal && options.signal.cancelled) {
    throw new Error("CANCELLED");
  }

  const blob = pdf.output("blob");
  if (options.download !== false) {
    triggerBlobDownload(blob, options.filename || "hug-cards.pdf");
  }
  return { blob, pageCount, cols, rows };
}

/**
 * カード配列を `hug-cards/hug-card-{id}.png` として格納した ZIP Blob に変換して出力する.
 * @param {Array<Record<string, any>>} cards
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ download?: boolean, filename?: string, onProgress?: (c: number, t: number) => void, signal?: { cancelled?: boolean } }} [options]
 * @returns {Promise<{ blob: Blob, fileCount: number }>}
 */
export async function exportCardsAsZip(
  cards,
  designMode = "standard",
  options = {}
) {
  await ensureVendorLibraries();
  const JSZip = window.JSZip;
  const zip = new JSZip();
  const folder = zip.folder("hug-cards");

  const imagesMap = await generateCardImagesBatch(cards, designMode, options);
  let fileCount = 0;

  for (let i = 0; i < cards.length; i++) {
    if (options.signal && options.signal.cancelled) {
      throw new Error("CANCELLED");
    }

    const card = cards[i];
    const dataUrl = imagesMap.get(String(card.id));
    if (dataUrl && folder) {
      const base64Data = dataUrl.replace(/^data:image\/(png|jpg|jpeg);base64,/, "");
      folder.file(`hug-card-${card.id}.png`, base64Data, { base64: true });
      fileCount++;
    }
  }

  if (options.signal && options.signal.cancelled) {
    throw new Error("CANCELLED");
  }

  const blob = await zip.generateAsync({ type: "blob" });
  if (options.download !== false) {
    triggerBlobDownload(blob, options.filename || "hug-cards.zip");
  }
  return { blob, fileCount };
}

/**
 * 出力される予定の完成カード画像（Canvas描画PNG）をそのまま表示するプレビュー要素を生成する.
 * @param {Record<string, any>} card
 * @param {{ designMode?: 'standard' | 'largeText', showNumber?: boolean, onClick?: (card: Record<string, any>) => void, actionsHtml?: string }} [options]
 * @returns {HTMLElement}
 */
export function renderCardPreviewElement(card, options = {}) {
  const designMode = FIXED_DESIGN_MODE;
  const isEvent = card.type === "イベント";
  const isPet = card.type === "ペット";
  const origId = String(card.original_id || card.id || "");
  const showNum = shouldDrawCardNumber(card, options);

  const wrapper = document.createElement("div");
  wrapper.className = "hug-gen-card-outer";
  wrapper.dataset.cardId = String(card.id);
  wrapper.dataset.originalId = origId;
  wrapper.setAttribute("data-testid", `gen-card-${card.id}`);

  const noLabel = showNum ? `No. ${card.id}` : origId;

  wrapper.innerHTML = `
    <div class="hug-gen-card-frame hug-gen-card-image-mode ${isEvent ? "frame-event" : isPet ? "frame-pet" : "frame-person"} mode-standard">
      <img
        alt="${escapeHtml(card.name || origId)}"
        class="gen-card-canvas-img"
        data-testid="gen-card-img-${escapeHtml(card.id)}"
      />
      <span class="sr-only gen-card-no" data-testid="gen-card-no-${escapeHtml(card.id)}">${escapeHtml(noLabel)}</span>
      <span class="sr-only gen-card-orig-id" data-testid="gen-card-orig-id-${escapeHtml(origId)}">${escapeHtml(origId)}</span>
    </div>
    <button type="button" class="gen-card-download-btn" title="完成カードPNGをダウンロード" data-testid="download-card-png-${escapeHtml(card.id)}">
      ⬇ PNG
    </button>
    ${options.actionsHtml || ""}
  `;

  const canvasImg = wrapper.querySelector(".gen-card-canvas-img");
  if (canvasImg) {
    bindCardCanvasImage(canvasImg, card, {
      designMode,
      showNumber: options.showNumber,
      layoutMode: options.layoutMode,
      eventTitleLayoutMode: options.eventTitleLayoutMode,
    });
  }

  const dlBtn = wrapper.querySelector(".gen-card-download-btn");
  if (dlBtn) {
    dlBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const dataUrl = await generateCardImageCanvas(card, designMode, {
          showNumber: options.showNumber,
          layoutMode: options.layoutMode,
          eventTitleLayoutMode: options.eventTitleLayoutMode,
        });
        const link = document.createElement("a");
        link.download = `hug-card-${card.id}.png`;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error("Failed to download card image", err);
      }
    });
  }

  if (options.onClick) {
    wrapper
      .querySelector(".hug-gen-card-frame")
      .addEventListener("click", () => options.onClick(card));
  }

  return wrapper;
}

/**
 * 11列の避難者台帳 (MasterList) テーブル要素を生成する.
 * @param {Array<Record<string, any>>} cards
 * @returns {HTMLElement}
 */
export function renderMasterListElement(cards) {
  const wrap = document.createElement("div");
  wrap.className = "master-ledger-wrap";
  wrap.id = "master-list-table";
  wrap.setAttribute("data-testid", "master-list-table");

  const rowsHtml = (cards || [])
    .map((card) => {
      const typeCls =
        card.type === "イベント"
          ? "pill-event"
          : card.type === "ペット"
            ? "pill-pet"
            : "pill-person";
      const flagsHtml = (card.detailedFlags || [])
        .map((flag) => {
          const cat = getFlagCategory(flag);
          const cls =
            cat === "健康"
              ? "gen-flag-health"
              : cat === "スキル"
                ? "gen-flag-skill"
                : cat === "配慮事項"
                  ? "gen-flag-care"
                  : "gen-flag-other";
          return `<span class="gen-flag-badge ${cls}">${escapeHtml(flag)}</span>`;
        })
        .join(" ");

      return `
        <tr>
          <td class="ledger-no">${escapeHtml(card.id)}</td>
          <td><span class="type-pill ${typeCls}">${escapeHtml(card.type)}</span></td>
          <td class="ledger-name">${escapeHtml(card.name)}</td>
          <td>${escapeHtml(card.age || "-")}</td>
          <td>${escapeHtml(card.gender || "-")}</td>
          <td>${escapeHtml(card.attributes || "-")}</td>
          <td><div class="ledger-flags">${flagsHtml}</div></td>
          <td>${escapeHtml(card.appearance || "-")}</td>
          <td>${escapeHtml(card.origin || "-")}</td>
          <td class="ledger-dialogue">${escapeHtml(card.dialogue || "")}</td>
          <td class="ledger-points">${escapeHtml(card.points || "")}</td>
        </tr>
      `;
    })
    .join("");

  wrap.innerHTML = `
    <div class="ledger-scroll">
      <table class="ledger-table" data-testid="master-ledger-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>種別</th>
            <th>氏名/イベント名</th>
            <th>年齢</th>
            <th>性別</th>
            <th>属性</th>
            <th>詳細フラグ</th>
            <th>容姿</th>
            <th>避難元</th>
            <th>状況・セリフ</th>
            <th class="ledger-points-th">判定ポイント</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
  return wrap;
}

/**
 * 避難者台帳の印刷用HTMLを生成し、別ウィンドウ（または印刷ダイアログ）で開く.
 * @param {Array<Record<string, any>>} cards
 * @returns {string} 生成されたHTML文字列
 */
export function buildMasterLedgerPrintHtml(cards) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>避難者台帳</title>
  <style>
    body {
      font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
      font-size: 11px;
      color: #333;
      line-height: 1.4;
      margin: 0;
      padding: 20px;
    }
    h2 {
      font-size: 16px;
      margin-top: 0;
      margin-bottom: 10px;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px;
      text-align: left;
      vertical-align: top;
      word-wrap: break-word;
    }
    th {
      background-color: #f8fafc;
      font-weight: bold;
      color: #475569;
    }
    .col-no { width: 35px; }
    .col-type { width: 55px; }
    .col-name { width: 90px; }
    .col-age { width: 35px; }
    .col-gender { width: 35px; }
    .col-attr { width: 70px; }
    .col-flags { width: 90px; }
    .col-app { width: 90px; }
    .col-origin { width: 90px; }
    .col-dialogue { width: auto; }
    .col-points { width: 110px; background: #fffbeb; }
    .type-event { color: #b91c1c; background: #fee2e2; padding: 2px 4px; border-radius: 4px; font-size: 9px; display: inline-block; }
    .type-pet { color: #047857; background: #d1fae5; padding: 2px 4px; border-radius: 4px; font-size: 9px; display: inline-block; }
    .type-person { color: #1d4ed8; background: #dbeafe; padding: 2px 4px; border-radius: 4px; font-size: 9px; display: inline-block; }
    @media print {
      @page { size: A4 landscape; margin: 10mm; }
      body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h2>避難者台帳</h2>
  <table>
    <thead>
      <tr>
        <th class="col-no">No.</th>
        <th class="col-type">種別</th>
        <th class="col-name">氏名/イベント名</th>
        <th class="col-age">年齢</th>
        <th class="col-gender">性別</th>
        <th class="col-attr">属性</th>
        <th class="col-flags">詳細フラグ</th>
        <th class="col-app">容姿</th>
        <th class="col-origin">避難元</th>
        <th class="col-dialogue">状況・セリフ</th>
        <th class="col-points">判定ポイント</th>
      </tr>
    </thead>
    <tbody>
      ${(cards || [])
        .map(
          (card) => `
        <tr>
          <td>${escapeHtml(card.id)}</td>
          <td><span class="${card.type === "イベント" ? "type-event" : card.type === "ペット" ? "type-pet" : "type-person"}">${escapeHtml(card.type)}</span></td>
          <td>${escapeHtml(card.name)}</td>
          <td>${escapeHtml(card.age || "")}</td>
          <td>${escapeHtml(card.gender || "")}</td>
          <td>${escapeHtml(card.attributes || "")}</td>
          <td>${escapeHtml((card.detailedFlags || []).join(", "))}</td>
          <td>${escapeHtml(card.appearance || "")}</td>
          <td>${escapeHtml(card.origin || "")}</td>
          <td>${escapeHtml(card.dialogue || "")}</td>
          <td class="col-points">${escapeHtml(card.points || "")}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;
}

export function printMasterLedger(cards) {
  const html = buildMasterLedgerPrintHtml(cards);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    triggerBlobDownload(blob, "hug_master_ledger.html");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 400);
}
