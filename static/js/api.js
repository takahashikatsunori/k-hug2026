/**
 * バックエンド API 通信クライアント.
 */

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} detail
   * @param {Array<{field: string, message: string, record_id?: string | null}>} errors
   * @param {string[]} [dependents]
   */
  constructor(status, detail, errors = [], dependents = []) {
    super(detail || `HTTP Error ${status}`);
    this.status = status;
    this.detail = detail || `HTTP Error ${status}`;
    this.errors = errors || [];
    this.dependents = dependents || [];
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (
    body &&
    !(body instanceof FormData) &&
    typeof body === "object"
  ) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const fetchOpts = { ...options, headers, body };
  let resp;
  let lastNetErr = null;
  const retryDelays = [250, 400, 600, 900, 1200];
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      resp = await fetch(path, fetchOpts);
      lastNetErr = null;
      break;
    } catch (err) {
      lastNetErr = err;
      if (attempt < retryDelays.length) {
        await new Promise((r) => setTimeout(r, retryDelays[attempt]));
      }
    }
  }
  if (lastNetErr || !resp) {
    throw lastNetErr || new Error("Failed to fetch");
  }
  if (resp.status === 204) {
    return null;
  }
  const contentType = resp.headers.get("content-type") || "";
  if (!resp.ok) {
    if (contentType.includes("application/json")) {
      const errJson = await resp.json();
      throw new ApiError(
        resp.status,
        errJson.detail || `Error ${resp.status}`,
        errJson.errors || [],
        errJson.dependents || []
      );
    }
    const text = await resp.text();
    throw new ApiError(resp.status, text || `Error ${resp.status}`);
  }
  if (contentType.includes("application/json")) {
    return resp.json();
  }
  return resp.blob();
}

export const api = {
  getSchema: () => request("/api/schema"),
  getHolidayTypes: (dateStr) =>
    request(`/api/holiday-types?date=${encodeURIComponent(dateStr)}`),

  // イベント
  listEvents: () => request("/api/events"),
  getEvent: (id) => request(`/api/events/${encodeURIComponent(id)}`),
  createEvent: (data) => request("/api/events", { method: "POST", body: data }),
  updateEvent: (id, data) =>
    request(`/api/events/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: data,
    }),
  deleteEvent: (id, force = false) =>
    request(`/api/events/${encodeURIComponent(id)}?force=${force}`, {
      method: "DELETE",
    }),

  // 世帯・構成員
  listHouseholds: () => request("/api/households"),
  getHousehold: (id) => request(`/api/households/${encodeURIComponent(id)}`),
  createHousehold: (data) =>
    request("/api/households", { method: "POST", body: data }),
  updateHousehold: (id, data) =>
    request(`/api/households/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: data,
    }),
  deleteHousehold: (id) =>
    request(`/api/households/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteMember: (id) =>
    request(`/api/members/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // 検索・保存済み検索
  search: (query) => request("/api/search", { method: "POST", body: query }),
  exportSearch: async (format, query) => {
    const resp = await fetch(
      `/api/search/export?format=${encodeURIComponent(format)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query || {}),
      }
    );
    if (!resp.ok) {
      const err = await resp.json();
      throw new ApiError(resp.status, err.detail, err.errors);
    }
    return resp.blob();
  },
  listSavedSearches: () => request("/api/saved-searches"),
  createSavedSearch: (data) =>
    request("/api/saved-searches", { method: "POST", body: data }),
  getSavedSearch: (id) => request(`/api/saved-searches/${id}`),
  deleteSavedSearch: (id) =>
    request(`/api/saved-searches/${id}`, { method: "DELETE" }),

  // 入出力
  importFiles: (files, mode = "replace", dryRun = false) => {
    const fd = new FormData();
    for (const f of files) {
      fd.append("files", f);
    }
    return request(
      `/api/import?mode=${encodeURIComponent(mode)}&dry_run=${dryRun}`,
      {
        method: "POST",
        body: fd,
      }
    );
  },
  importDemo: (mode = "replace") =>
    request(`/api/import/demo?mode=${encodeURIComponent(mode)}`, {
      method: "POST",
    }),
  exportAllJson: async () => {
    const resp = await fetch("/api/export/json");
    if (!resp.ok) throw new ApiError(resp.status, "Export failed");
    return resp.blob();
  },
  exportAllCsv: async (format = "cardcsv") => {
    const resp = await fetch(
      `/api/export/csv?format=${encodeURIComponent(format)}`
    );
    if (!resp.ok) throw new ApiError(resp.status, "CSV Export failed");
    return resp.blob();
  },
  clearAll: (confirmText, includeSaved = false) =>
    request("/api/clear", {
      method: "POST",
      body: { confirm: confirmText, include_saved: includeSaved },
    }),

  // デッキ
  buildDeck: (payload) =>
    request("/api/deck/build", { method: "POST", body: payload }),
  reorderDeck: (payload) =>
    request("/api/deck/reorder", { method: "POST", body: payload }),
  exportDeck: async (format, payload) => {
    const resp = await fetch(
      `/api/deck/export?format=${encodeURIComponent(format)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      }
    );
    if (!resp.ok) {
      const err = await resp.json();
      throw new ApiError(resp.status, err.detail, err.errors);
    }
    return resp.blob();
  },
  listSavedDecks: () => request("/api/decks"),
  createSavedDeck: (data) =>
    request("/api/decks", { method: "POST", body: data }),
  getSavedDeck: (id) => request(`/api/decks/${id}`),
  updateSavedDeck: (id, data) =>
    request(`/api/decks/${id}`, { method: "PUT", body: data }),
  deleteSavedDeck: (id) => request(`/api/decks/${id}`, { method: "DELETE" }),

  // バージョン
  listVersions: (kind = "") =>
    request(
      kind ? `/api/versions?kind=${encodeURIComponent(kind)}` : "/api/versions"
    ),
  createVersion: (label, note = "") =>
    request("/api/versions", { method: "POST", body: { label, note } }),
  updateVersion: (id, data) =>
    request(`/api/versions/${id}`, { method: "PATCH", body: data }),
  deleteVersion: (id) => request(`/api/versions/${id}`, { method: "DELETE" }),
  diffVersion: (id) => request(`/api/versions/${id}/diff`),
  restoreVersion: (id) =>
    request(`/api/versions/${id}/restore`, { method: "POST" }),
  exportVersion: async (id) => {
    const resp = await fetch(`/api/versions/${id}/export`);
    if (!resp.ok) throw new ApiError(resp.status, "Version export failed");
    return resp.blob();
  },

  // イラスト・バッチプロンプト管理
  getImagesStatus: () => request("/api/images/status"),
  syncImages: () => request("/api/images/sync", { method: "POST" }),
  uploadCardImage: (targetId, fileOrBase64) => {
    if (typeof fileOrBase64 === "string") {
      return request(`/api/images/${encodeURIComponent(targetId)}`, {
        method: "PUT",
        body: { image_base64: fileOrBase64 },
      });
    }
    const fd = new FormData();
    fd.append("file", fileOrBase64);
    return request(`/api/images/${encodeURIComponent(targetId)}`, {
      method: "PUT",
      body: fd,
    });
  },
  deleteCardImage: (targetId) =>
    request(`/api/images/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
    }),
  generateImageBatches: (payload = {}) =>
    request("/api/images/batches/generate", {
      method: "POST",
      body: payload,
    }),
  applyImageBatch: (batchId, slices) =>
    request(`/api/images/batches/${encodeURIComponent(batchId)}/apply`, {
      method: "POST",
      body: { slices },
    }),
  exportImagesZip: async () => {
    const resp = await fetch("/api/images/export/zip");
    if (!resp.ok) throw new ApiError(resp.status, "Image ZIP export failed");
    return resp.blob();
  },
  importImagesZip: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("/api/images/import/zip", {
      method: "POST",
      body: fd,
    });
  },
};
