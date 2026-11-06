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

const cardImageCache = new Map();

export function clearCardImageCache() {
  cardImageCache.clear();
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
    trimmed.startsWith("/static/")
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
 * 完成カード画像 (600x800 PNG DataURL) を Canvas で描画する (hug-card-gen の generateCardImageCanvas 完全移植).
 * @param {Record<string, any>} card
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @returns {Promise<string>}
 */
export const generateCardImageCanvas = async (
  card,
  designMode = "standard"
) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const width = 600;
  const height = 800;
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

  // Header
  ctx.fillStyle = "#0f172a";
  ctx.font = isLarge ? "bold 50px monospace" : "bold 39px monospace";
  ctx.fillText(`No. ${card.id}`, 35, isLarge ? 60 : 55);

  // Badge
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

  let currentY = isLarge ? 130 : 110;
  const cardName = String(card.name || "");

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
    let titleFontSize = isLarge ? 72 : 54;
    let titleLineHeight = Math.floor(titleFontSize * 1.15);
    ctx.font = `bold ${titleFontSize}px sans-serif`;

    while (titleFontSize > 12) {
      if (!cardName) break;
      const chars = cardName.split("");
      let testLine = "";
      let testLineCount = 1;
      for (let n = 0; n < chars.length; n++) {
        const testNext = testLine + chars[n];
        if (ctx.measureText(testNext).width > width - 70 && n > 0) {
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
      (wrapText(cardName, 35, currentY, width - 70, titleLineHeight, 2) -
        currentY) /
      titleLineHeight;
    currentY += (Math.max(1, linesRendered) - 1) * titleLineHeight;
    currentY += isLarge ? 15 : 10;
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
  if (card.imageUrl) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = card.imageUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      let imgAreaWidth = width - 70;
      if (!isEvent && (validAge || validGender)) {
        imgAreaWidth = width - 70 - (isLarge ? 150 : 110);
      }

      const imgAreaHeight = 240;
      const scale = Math.min(
        imgAreaWidth / img.width,
        imgAreaHeight / img.height
      );
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      const drawX = 35 + (imgAreaWidth - drawWidth) / 2;
      const drawY = currentY + 10 + (imgAreaHeight - drawHeight) / 2;

      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(35, currentY + 10, imgAreaWidth, imgAreaHeight);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(35, currentY + 10, imgAreaWidth, imgAreaHeight);

      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

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
    } catch {
      currentY += isLarge ? 10 : 5;
    }
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

  // Dialogue Box
  if (!isLarge) {
    const boxHeight = Math.max(60, height - currentY - 35);
    ctx.fillStyle = bgColor;
    drawRoundRect(ctx, 35, currentY, width - 70, boxHeight, 8);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    let dialogueFontSize = 33;
    let dialogueLineHeight = Math.floor(dialogueFontSize * 1.45);
    ctx.font = `bold ${dialogueFontSize}px sans-serif`;
    const dialogueText = String(card.dialogue || "");

    while (dialogueFontSize > 12) {
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

    const finalMaxLinesFit = Math.ceil((boxHeight - 20) / dialogueLineHeight);
    wrapText(
      dialogueText,
      55,
      currentY + Math.floor(dialogueLineHeight * 1.1),
      width - 110,
      dialogueLineHeight,
      finalMaxLinesFit
    );
  }

  return canvas.toDataURL("image/png");
};

/**
 * k-hug2026 のイベント・構成員レコードまたはデッキカードオブジェクトを HugCard 描画モデルへ変換する.
 * @param {Record<string, any>} item
 * @param {Record<string, any> | null} [group]
 * @param {{ cardNumber?: number | string | null, imageIds?: Set<string> | string[] | null }} [options]
 * @returns {Record<string, any>}
 */
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
          ? `/api/images/${encodeURIComponent(origId)}${ver ? `?v=${ver}` : ""}`
          : null;
    return {
      ...item,
      id: displayId,
      original_id: origId,
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
        ? `/api/images/${encodeURIComponent(origId)}${ver ? `?v=${ver}` : ""}`
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

  return {
    id: displayId,
    original_id: origId,
    group_id: String(item.group_id || grp.group_id || ""),
    group_name: String(grp.group_name || ""),
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
      ? `/api/images/${encodeURIComponent(origId)}${ver ? `?v=${ver}` : ""}`
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
      const cacheKey = JSON.stringify({ card, designMode });
      if (cardImageCache.has(cacheKey)) {
        return { id: String(card.id), dataUrl: cardImageCache.get(cacheKey) };
      }

      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        const dataUrl = await generateCardImageCanvas(card, designMode);
        cardImageCache.set(cacheKey, dataUrl);
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
      if (!window.jspdf) {
        await loadScript("/static/vendor/jspdf.umd.min.js");
      }
      if (!window.JSZip) {
        await loadScript("/static/vendor/jszip.min.js");
      }
    })();
  }
  await vendorScriptsLoadPromise;
}

/**
 * カード配列を指定印刷サイズで A4横・裁断線付き PDF に変換して出力する.
 * @param {Array<Record<string, any>>} cards
 * @param {keyof typeof PRINT_SIZES} [printSizeId='4.5x6.5']
 * @param {'standard' | 'largeText'} [designMode='standard']
 * @param {{ download?: boolean, filename?: string, onProgress?: (c: number, t: number) => void, signal?: { cancelled?: boolean } }} [options]
 * @returns {Promise<{ blob: Blob, pageCount: number, cols: number, rows: number }>}
 */
export async function exportCardsAsPdf(
  cards,
  printSizeId = "4.5x6.5",
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

  const printConfig = PRINT_SIZES[printSizeId] || PRINT_SIZES["4.5x6.5"];
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
 * DOM版の完成カードプレビュー要素を生成する (hug-card-gen の CardPreview 準拠).
 * @param {Record<string, any>} card
 * @param {{ designMode?: 'standard' | 'largeText', onClick?: (card: Record<string, any>) => void, actionsHtml?: string }} [options]
 * @returns {HTMLElement}
 */
export function renderCardPreviewElement(card, options = {}) {
  const designMode = options.designMode || "standard";
  const isLarge = designMode === "largeText";
  const isEvent = card.type === "イベント";
  const isPet = card.type === "ペット";

  const wrapper = document.createElement("div");
  wrapper.className = "hug-gen-card-outer";
  wrapper.dataset.cardId = String(card.id);
  wrapper.dataset.originalId = String(card.original_id || card.id);
  wrapper.setAttribute("data-testid", `gen-card-${card.id}`);

  const validAge =
    card.age && card.age !== "-"
      ? card.age.includes("歳")
        ? card.age
        : `${card.age}歳`
      : "";
  const validGender = card.gender && card.gender !== "-" ? card.gender : "";
  const validOrigin = card.origin && card.origin !== "-" ? card.origin : "";

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
      return `<span class="gen-flag-badge ${cls} ${isLarge ? "gen-flag-lg" : ""}">${escapeHtml(flag)}</span>`;
    })
    .join("");

  const hasSideBadges = Boolean(card.imageUrl && !isEvent && (validAge || validGender));

  wrapper.innerHTML = `
    <div class="hug-gen-card-frame ${isEvent ? "frame-event" : isPet ? "frame-pet" : "frame-person"} ${isLarge ? "mode-large" : "mode-standard"}">
      <div class="gen-card-header">
        <span class="gen-card-no" data-testid="gen-card-no-${escapeHtml(card.id)}">No. ${escapeHtml(card.id)}</span>
        <span class="gen-card-type-pill ${isEvent ? "pill-ev" : isPet ? "pill-pt" : "pill-ps"}">${escapeHtml(card.type)}</span>
      </div>
      <h3 class="gen-card-title ${isEvent ? "title-ev" : ""}">${escapeHtml(card.name || "(名称未設定)")}</h3>
      ${
        card.imageUrl
          ? `
        <div class="gen-card-image-row">
          <div class="gen-card-image-box">
            <img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}" class="gen-card-img" />
          </div>
          ${
            hasSideBadges
              ? `
            <div class="gen-card-side-badges">
              ${validAge ? `<span class="gen-meta-badge">${escapeHtml(validAge)}</span>` : ""}
              ${validGender ? `<span class="gen-meta-badge">${escapeHtml(validGender)}</span>` : ""}
            </div>
          `
              : ""
          }
        </div>
      `
          : ""
      }
      ${
        !isEvent
          ? `
        <div class="gen-card-meta-section">
          ${
            !hasSideBadges && (validAge || validGender)
              ? `
            <div class="gen-card-meta-inline">
              ${validAge ? `<span class="gen-meta-badge">${escapeHtml(validAge)}</span>` : ""}
              ${validGender ? `<span class="gen-meta-badge">${escapeHtml(validGender)}</span>` : ""}
            </div>
          `
              : ""
          }
          ${validOrigin ? `<div class="gen-card-origin"><span class="gen-meta-badge">${escapeHtml(validOrigin)}</span></div>` : ""}
        </div>
      `
          : ""
      }
      ${
        card.attributes
          ? `
        <div class="gen-card-attr-row">
          <span class="gen-attr-label">属性:</span>
          <span class="gen-attr-val">${escapeHtml(card.attributes)}</span>
        </div>
      `
          : ""
      }
      ${flagsHtml ? `<div class="gen-card-flags-row">${flagsHtml}</div>` : ""}
      ${
        !isLarge
          ? `
        <div class="gen-card-dialogue ${isEvent ? "dlg-ev" : isPet ? "dlg-pt" : "dlg-ps"}">
          <div class="gen-card-dialogue-text">${escapeHtml(card.dialogue || "")}</div>
        </div>
      `
          : ""
      }
    </div>
    <button type="button" class="gen-card-download-btn" title="完成カードPNGをダウンロード" data-testid="download-card-png-${escapeHtml(card.id)}">
      ⬇ PNG
    </button>
    ${options.actionsHtml || ""}
  `;

  const dlBtn = wrapper.querySelector(".gen-card-download-btn");
  if (dlBtn) {
    dlBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const dataUrl = await generateCardImageCanvas(card, designMode);
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
