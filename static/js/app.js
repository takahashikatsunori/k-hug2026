/**
 * HUGカードデータベース管理ツール メインアプリケーションエントリポイント.
 */
import { api } from "./api.js";
import { store } from "./store.js";
import { prebuildCardBaseImages } from "./cardCanvas.js";
import { renderListView } from "./views/listView.js";
import { renderEventEditor } from "./views/eventEditor.js";
import { renderHouseholdEditor } from "./views/householdEditor.js";
import { renderImageView } from "./views/imageView.js";
import { renderDeckView } from "./views/deckView.js";
import { renderSavedView } from "./views/savedView.js";
import { renderIoView } from "./views/ioView.js";
import { renderVersionView } from "./views/versionView.js";
import { showToast } from "./components/toast.js";

/**
 * 全体の件数集計をリフレッシュする.
 */
async function refreshTotalCounts() {
  try {
    const [res, imgStatus] = await Promise.all([
      api.search({
        view: "all",
        keyword: "",
        fields: [],
        training: null,
        sort: "id",
      }),
      api.getImagesStatus().catch(() => null),
    ]);
    store.totalCounts = res.counts || {
      events: 0,
      households: 0,
      persons: 0,
      pets: 0,
      units: 0,
    };
    if (imgStatus) {
      store.updateImageStatus(imgStatus);
      if (Array.isArray(imgStatus.cards)) {
        prebuildCardBaseImages(imgStatus.cards);
      }
    }
    updateHeaderBadges();
  } catch {
    // 初期エラーは無視
  }
}

function updateHeaderBadges() {
  const c = store.totalCounts || {};
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val ?? 0);
  };
  setTxt("hdr-cnt-events", c.events);
  setTxt("hdr-cnt-households", c.households);
  setTxt("hdr-cnt-persons", c.persons);
  setTxt("hdr-cnt-pets", c.pets);
}

/**
 * 指定されたタブに切り替えて描画する.
 * @param {string} tabName
 */
export async function switchTab(tabName) {
  store.activeTab = tabName;
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  const mainContainer = document.getElementById("app-main");
  if (!mainContainer) return;

  if (tabName === "list") {
    await renderListView(mainContainer, {
      onNavigateEditor: async (mode, id) => {
        store.editorMode = mode;
        store.editingId = id;
        await switchTab("editor");
      },
      onDataChanged: refreshTotalCounts,
    });
  } else if (tabName === "editor") {
    await renderEditorShell(mainContainer);
  } else if (tabName === "images") {
    await renderImageView(mainContainer, {
      onDataChanged: refreshTotalCounts,
    });
  } else if (tabName === "deck") {
    await renderDeckView(mainContainer);
  } else if (tabName === "saved") {
    await renderSavedView(mainContainer, {
      onSwitchTab: switchTab,
    });
  } else if (tabName === "io") {
    await renderIoView(mainContainer, {
      onDataChanged: refreshTotalCounts,
    });
  } else if (tabName === "versions") {
    await renderVersionView(mainContainer, {
      onDataChanged: refreshTotalCounts,
    });
  }
}

/**
 * エディタタブのシェル（イベント / 世帯 切替）を描画する.
 * @param {HTMLElement} container
 */
async function renderEditorShell(container) {
  const isEvent = store.editorMode === "event";
  container.innerHTML = `
    <div class="editor-shell">
      <div class="editor-mode-bar">
        <div class="editor-mode-buttons">
          <button
            type="button"
            class="btn ${isEvent ? "btn-primary" : ""}"
            id="editor-mode-event"
            data-testid="editor-mode-event"
          >
            イベント作成・編集
          </button>
          <button
            type="button"
            class="btn ${!isEvent ? "btn-primary" : ""}"
            id="editor-mode-household"
            data-testid="editor-mode-household"
          >
            世帯・構成員作成・編集
          </button>
        </div>
        <div>
          <button
            type="button"
            class="btn btn-sm"
            id="editor-reset-btn"
            data-testid="editor-reset-btn"
          >
            新規作成モードにリセット
          </button>
        </div>
      </div>
      <div id="editor-body"></div>
    </div>
  `;

  const bodyEl = container.querySelector("#editor-body");

  container
    .querySelector("#editor-mode-event")
    .addEventListener("click", async () => {
      store.editorMode = "event";
      store.editingId = null;
      await renderEditorShell(container);
    });

  container
    .querySelector("#editor-mode-household")
    .addEventListener("click", async () => {
      store.editorMode = "household";
      store.editingId = null;
      await renderEditorShell(container);
    });

  container
    .querySelector("#editor-reset-btn")
    .addEventListener("click", async () => {
      store.editingId = null;
      await renderEditorShell(container);
    });

  const onSaved = async () => {
    store.editingId = null;
    await refreshTotalCounts();
    await switchTab("list");
  };

  if (isEvent) {
    await renderEventEditor(bodyEl, store.editingId, { onSaved });
  } else {
    await renderHouseholdEditor(bodyEl, store.editingId, { onSaved });
  }
}

/**
 * アプリケーションの初期化.
 */
async function initApp() {
  try {
    store.schema = await api.getSchema();
    store.subscribe((reason) => {
      if (reason === "counts") {
        updateHeaderBadges();
      }
    });

    document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (tab === "editor" && store.activeTab !== "editor") {
          store.editingId = null;
        }
        switchTab(tab);
      });
    });

    const hdrVerBtn = document.getElementById("header-create-version-btn");
    if (hdrVerBtn) {
      hdrVerBtn.addEventListener("click", async () => {
        try {
          const v = await api.createVersion("クイック保存", "ヘッダからの作成");
          showToast(`バージョン「${v.label}」を作成しました`, "success");
          if (store.activeTab === "versions") {
            await switchTab("versions");
          }
        } catch (err) {
          showToast(err.detail || "バージョン作成に失敗しました", "error");
        }
      });
    }

    await refreshTotalCounts();
    await switchTab("list");
  } catch (err) {
    showToast(err.detail || err.message || "初期化に失敗しました", "error");
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}
