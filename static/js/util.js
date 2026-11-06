/**
 * 共通ユーティリティ関数群 (HTMLエスケープ、世帯人数計算、ダウンロード支援など).
 */

/**
 * XSS対策用 HTML エスケープ (JS-03).
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) {
    return "";
  }
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 構成員リストから人物数とペット数を分けて集計する (JS-04).
 * @param {Array<Record<string, any>>} members
 * @returns {{ member_count: number, pet_count: number, total: number }}
 */
export function computeHouseholdCounts(members) {
  if (!Array.isArray(members)) {
    return { member_count: 0, pet_count: 0, total: 0 };
  }
  let persons = 0;
  let pets = 0;
  for (const m of members) {
    if (!m || typeof m !== "object") continue;
    if (m.data_type === "ペット") {
      pets += 1;
    } else if (m.data_type === "人物") {
      persons += 1;
    }
  }
  return {
    member_count: persons,
    pet_count: pets,
    total: persons + pets,
  };
}

/**
 * Blob を指定ファイル名でブラウザダウンロードさせる.
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
}

/**
 * ISO日時文字列を読みやすいローカル日時に整形する.
 * @param {string | null | undefined} isoStr
 * @returns {string}
 */
export function formatDateTime(isoStr) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
  } catch {
    return String(isoStr);
  }
}
