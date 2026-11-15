/**
 * ピュアJavaScript QRコード生成器 (ISO/IEC 18004準拠 / Byteモード UTF-8 / 誤り訂正レベルM).
 * 外部ライブラリやネットワーク通信なしで、QRマトリクス生成とPNGダウンロードを提供する。
 */

// Alignment pattern center coordinates for Versions 1..40
const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94],
  22: [6, 26, 50, 74, 98],
  23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106],
  25: [6, 32, 58, 84, 110],
  26: [6, 30, 58, 86, 114],
  27: [6, 34, 62, 90, 118],
  28: [6, 26, 50, 74, 98, 122],
  29: [6, 30, 54, 78, 102, 126],
  30: [6, 26, 52, 78, 104, 130],
  31: [6, 30, 56, 82, 108, 134],
  32: [6, 34, 60, 86, 112, 138],
  33: [6, 30, 58, 86, 114, 142],
  34: [6, 34, 62, 90, 118, 146],
  35: [6, 30, 54, 78, 102, 126, 150],
  36: [6, 24, 50, 76, 102, 128, 154],
  37: [6, 28, 54, 80, 106, 132, 158],
  38: [6, 32, 58, 84, 110, 136, 162],
  39: [6, 26, 54, 82, 110, 138, 166],
  40: [6, 30, 58, 86, 114, 142, 170],
};

// Error Correction Level M RS block specification: [ecPerBlock, c1, d1, c2, d2]
const RS_BLOCKS_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
  11: [30, 1, 50, 4, 51],
  12: [22, 6, 36, 2, 37],
  13: [22, 8, 37, 1, 38],
  14: [24, 4, 40, 5, 41],
  15: [24, 5, 41, 5, 42],
  16: [28, 7, 45, 3, 46],
  17: [28, 10, 46, 1, 47],
  18: [26, 9, 43, 4, 44],
  19: [26, 3, 44, 11, 45],
  20: [26, 3, 41, 13, 42],
  21: [26, 17, 42, 0, 0],
  22: [28, 17, 46, 0, 0],
  23: [28, 4, 47, 14, 48],
  24: [28, 6, 45, 14, 46],
  25: [28, 8, 47, 13, 48],
  26: [28, 19, 46, 4, 47],
  27: [28, 22, 45, 3, 46],
  28: [28, 3, 45, 23, 46],
  29: [28, 21, 45, 7, 46],
  30: [28, 19, 47, 10, 48],
  31: [28, 2, 46, 29, 47],
  32: [28, 10, 46, 23, 47],
  33: [28, 14, 46, 21, 47],
  34: [28, 14, 46, 23, 47],
  35: [28, 12, 47, 26, 48],
  36: [28, 6, 47, 34, 48],
  37: [28, 29, 46, 14, 47],
  38: [28, 13, 46, 32, 47],
  39: [28, 40, 47, 7, 48],
  40: [28, 18, 47, 31, 48],
};

// GF(256) exp/log tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildRsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(dataBytes, ecLen) {
  const gen = buildRsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return res;
}

function getBchFormatBits(maskPattern) {
  // ECC Level M = 0b00
  const data = (0b00 << 3) | (maskPattern & 7);
  let rem = data << 10;
  const gen = 0x537;
  for (let bit = 14; bit >= 10; bit--) {
    if ((rem >> bit) & 1) {
      rem ^= gen << (bit - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function getBchVersionBits(version) {
  let rem = version << 12;
  const gen = 0x1f25;
  for (let bit = 17; bit >= 12; bit--) {
    if ((rem >> bit) & 1) {
      rem ^= gen << (bit - 12);
    }
  }
  return (version << 12) | rem;
}

function encodeDataCodewords(bytes, version) {
  const [, c1, d1, c2, d2] = RS_BLOCKS_M[version];
  const totalDataCw = c1 * d1 + c2 * d2;
  const maxBits = totalDataCw * 8;
  const ccBits = version <= 9 ? 8 : 16;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, ccBits);
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  const termLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Convert bits to bytes and append pad bytes 0xEC, 0x11
  const codewords = new Uint8Array(totalDataCw);
  const byteCount = bits.length / 8;
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    codewords[i] = b;
  }
  let padIdx = 0;
  for (let i = byteCount; i < totalDataCw; i++) {
    codewords[i] = padIdx % 2 === 0 ? 0xec : 0x11;
    padIdx++;
  }
  return codewords;
}

function interleaveCodewords(dataCw, version) {
  const [ecLen, c1, d1, c2, d2] = RS_BLOCKS_M[version];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < c1; i++) {
    const blk = dataCw.slice(offset, offset + d1);
    dataBlocks.push(blk);
    ecBlocks.push(rsRemainder(blk, ecLen));
    offset += d1;
  }
  for (let i = 0; i < c2; i++) {
    const blk = dataCw.slice(offset, offset + d2);
    dataBlocks.push(blk);
    ecBlocks.push(rsRemainder(blk, ecLen));
    offset += d2;
  }

  const out = [];
  const maxDataLen = Math.max(d1, d2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) out.push(blk[i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (const ec of ecBlocks) {
      out.push(ec[i]);
    }
  }
  return new Uint8Array(out);
}

function createEmptyGrid(size) {
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));
  return { size, modules, isFunc };
}

function setFunc(grid, r, c, dark) {
  if (r < 0 || c < 0 || r >= grid.size || c >= grid.size) return;
  grid.modules[r][c] = dark ? 1 : 0;
  grid.isFunc[r][c] = 1;
}

function drawFinderPattern(grid, r0, c0) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || c < 0 || r >= grid.size || c >= grid.size) continue;
      const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      setFunc(grid, r, c, inOuter && (onBorder || inInner));
    }
  }
}

function drawAlignmentPattern(grid, cr, cc) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      setFunc(grid, cr + dr, cc + dc, dist !== 1);
    }
  }
}

function placeFunctionPatterns(grid, version) {
  const n = grid.size;
  drawFinderPattern(grid, 0, 0);
  drawFinderPattern(grid, 0, n - 7);
  drawFinderPattern(grid, n - 7, 0);

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    const dark = i % 2 === 0;
    setFunc(grid, 6, i, dark);
    setFunc(grid, i, 6, dark);
  }

  // Dark module
  setFunc(grid, 4 * version + 9, 8, true);

  // Reserve format info cells
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunc(grid, 8, i, false);
      setFunc(grid, i, 8, false);
    }
  }
  for (let i = n - 8; i < n; i++) setFunc(grid, 8, i, false);
  for (let i = n - 7; i < n; i++) setFunc(grid, i, 8, false);

  // Version info for V7..40
  if (version >= 7) {
    const vBits = getBchVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      setFunc(grid, a, b, bit === 1);
      setFunc(grid, b, a, bit === 1);
    }
  }

  // Alignment patterns
  const pts = ALIGNMENT_POSITIONS[version] || [];
  for (const pr of pts) {
    for (const pc of pts) {
      if ((pr === 6 && pc === 6) || (pr === 6 && pc === n - 7) || (pr === n - 7 && pc === 6)) {
        continue;
      }
      drawAlignmentPattern(grid, pr, pc);
    }
  }
}

function placeDataCodewords(grid, allCodewords) {
  const n = grid.size;
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  let up = true;

  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < n; step++) {
      const r = up ? n - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!grid.isFunc[r][c]) {
          let dark = 0;
          if (bitIdx < totalBits) {
            dark = (allCodewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          }
          grid.modules[r][c] = dark;
          bitIdx++;
        }
      }
    }
    up = !up;
  }
}

function shouldMask(mask, r, c) {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function applyMaskAndFormat(baseGrid, mask) {
  const n = baseGrid.size;
  const modules = baseGrid.modules.map((row, r) => {
    const out = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      out[c] = !baseGrid.isFunc[r][c] && shouldMask(mask, r, c) ? row[c] ^ 1 : row[c];
    }
    return out;
  });

  const fmt = getBchFormatBits(mask);
  const putBit = (r, c, bitIdx) => {
    modules[r][c] = (fmt >> bitIdx) & 1;
  };

  // Format copy 1 (top-left, MSB bit 14 at (8,0) .. LSB bit 0 at (0,8))
  for (let i = 0; i <= 5; i++) putBit(8, i, 14 - i);
  putBit(8, 7, 8);
  putBit(8, 8, 7);
  putBit(7, 8, 6);
  for (let i = 0; i <= 5; i++) putBit(5 - i, 8, 5 - i);

  // Format copy 2 (bottom-left + top-right)
  for (let i = 0; i < 7; i++) putBit(n - 1 - i, 8, 14 - i);
  for (let i = 0; i < 8; i++) putBit(8, n - 8 + i, 7 - i);

  return modules;
}

function evaluatePenalty(modules) {
  const n = modules.length;
  let penalty = 0;
  let darkCount = 0;

  // N1 (runs >= 5) + N3 (1:1:3:1:1 finder-like with 4 light margin)
  for (let r = 0; r < n; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    let colRunColor = modules[0][r];
    let colRunLen = 1;

    for (let c = 0; c < n; c++) {
      if (modules[r][c]) darkCount++;
      if (c > 0) {
        if (modules[r][c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runColor = modules[r][c];
          runLen = 1;
        }
        if (modules[c][r] === colRunColor) {
          colRunLen++;
        } else {
          if (colRunLen >= 5) penalty += 3 + (colRunLen - 5);
          colRunColor = modules[c][r];
          colRunLen = 1;
        }
      }

      if (c <= n - 11) {
        const matchRowA =
          modules[r][c] === 1 &&
          modules[r][c + 1] === 0 &&
          modules[r][c + 2] === 1 &&
          modules[r][c + 3] === 1 &&
          modules[r][c + 4] === 1 &&
          modules[r][c + 5] === 0 &&
          modules[r][c + 6] === 1 &&
          modules[r][c + 7] === 0 &&
          modules[r][c + 8] === 0 &&
          modules[r][c + 9] === 0 &&
          modules[r][c + 10] === 0;
        const matchRowB =
          modules[r][c] === 0 &&
          modules[r][c + 1] === 0 &&
          modules[r][c + 2] === 0 &&
          modules[r][c + 3] === 0 &&
          modules[r][c + 4] === 1 &&
          modules[r][c + 5] === 0 &&
          modules[r][c + 6] === 1 &&
          modules[r][c + 7] === 1 &&
          modules[r][c + 8] === 1 &&
          modules[r][c + 9] === 0 &&
          modules[r][c + 10] === 1;
        if (matchRowA || matchRowB) penalty += 40;

        const matchColA =
          modules[c][r] === 1 &&
          modules[c + 1][r] === 0 &&
          modules[c + 2][r] === 1 &&
          modules[c + 3][r] === 1 &&
          modules[c + 4][r] === 1 &&
          modules[c + 5][r] === 0 &&
          modules[c + 6][r] === 1 &&
          modules[c + 7][r] === 0 &&
          modules[c + 8][r] === 0 &&
          modules[c + 9][r] === 0 &&
          modules[c + 10][r] === 0;
        const matchColB =
          modules[c][r] === 0 &&
          modules[c + 1][r] === 0 &&
          modules[c + 2][r] === 0 &&
          modules[c + 3][r] === 0 &&
          modules[c + 4][r] === 1 &&
          modules[c + 5][r] === 0 &&
          modules[c + 6][r] === 1 &&
          modules[c + 7][r] === 1 &&
          modules[c + 8][r] === 1 &&
          modules[c + 9][r] === 0 &&
          modules[c + 10][r] === 1;
        if (matchColA || matchColB) penalty += 40;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
    if (colRunLen >= 5) penalty += 3 + (colRunLen - 5);
  }

  // N2: 2x2 blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  // N4: dark ratio deviation from 50%
  const ratio = (darkCount * 100) / (n * n);
  const prev5 = Math.floor(Math.abs(Math.floor(ratio) - 50) / 5);
  const next5 = Math.floor(Math.abs(Math.ceil(ratio) - 50) / 5);
  penalty += Math.min(prev5, next5) * 10;

  return penalty;
}

/**
 * テキストからQRコードマトリクス（Level M / UTF-8 Byteモード）を生成する.
 * @param {string} text
 * @returns {{ version: number, size: number, modules: Uint8Array[], mask: number }}
 */
export function encodeQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let version = -1;
  for (let v = 1; v <= 40; v++) {
    const [, c1, d1, c2, d2] = RS_BLOCKS_M[v];
    const totalDataBits = (c1 * d1 + c2 * d2) * 8;
    const ccBits = v <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= totalDataBits) {
      version = v;
      break;
    }
  }
  if (version < 0) {
    throw new Error("URLが長すぎるためQRコードを生成できません");
  }

  const dataCw = encodeDataCodewords(bytes, version);
  const allCw = interleaveCodewords(dataCw, version);
  const size = 4 * version + 17;
  const baseGrid = createEmptyGrid(size);
  placeFunctionPatterns(baseGrid, version);
  placeDataCodewords(baseGrid, allCw);

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMaskAndFormat(baseGrid, mask);
    const pen = evaluatePenalty(candidate);
    if (pen < bestPenalty) {
      bestPenalty = pen;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return {
    version,
    size,
    modules: bestModules,
    mask: bestMask,
  };
}

/**
 * QRコードを指定のcanvas要素に描画する.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {{ targetSize?: number, quietModules?: number, caption?: string }} [options]
 * @returns {{ version: number, size: number, width: number, height: number }}
 */
export function renderQrToCanvas(canvas, text, options = {}) {
  const { targetSize = 360, quietModules = 4, caption = "" } = options;
  const qr = encodeQrMatrix(text);
  const totalMods = qr.size + quietModules * 2;
  const scale = Math.max(4, Math.floor(targetSize / totalMods));
  const qrPx = totalMods * scale;
  const footerH = caption ? Math.max(44, Math.round(qrPx * 0.14)) : 0;

  canvas.width = qrPx;
  canvas.height = qrPx + footerH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#000000";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        ctx.fillRect(
          (c + quietModules) * scale,
          (r + quietModules) * scale,
          scale,
          scale
        );
      }
    }
  }

  if (caption) {
    ctx.fillStyle = "#1e293b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let fontSize = Math.max(13, Math.round(footerH * 0.4));
    ctx.font = `700 ${fontSize}px "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif`;
    const maxTextWidth = qrPx - 24;
    while (fontSize > 10 && ctx.measureText(caption).width > maxTextWidth) {
      fontSize -= 1;
      ctx.font = `700 ${fontSize}px "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif`;
    }
    ctx.fillText(caption, qrPx / 2, qrPx + footerH / 2 - 2);
  }

  return {
    version: qr.version,
    size: qr.size,
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * QRコードのPNG DataURLを生成する.
 * @param {string} text
 * @param {{ targetSize?: number, caption?: string }} [options]
 * @returns {string}
 */
export function generateQrPngDataUrl(text, options = {}) {
  const canvas = document.createElement("canvas");
  renderQrToCanvas(canvas, text, options);
  return canvas.toDataURL("image/png");
}

/**
 * 訓練ページURLのQRコードPNG画像を生成してダウンロードする.
 * @param {string} url
 * @param {string} deckName
 * @returns {string} ダウンロードに使用したファイル名
 */
export function downloadQrPng(url, deckName = "hug_deck") {
  const safeBase =
    String(deckName || "hug_deck")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 60) || "hug_deck";
  const filename = `HUG訓練QR_${safeBase}.png`;
  const dataUrl = generateQrPngDataUrl(url, {
    targetSize: 520,
    caption: deckName ? `HUG訓練: ${deckName}` : "",
  });

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return filename;
}
