"""Playwright E2E テスト: カード一覧・検索・モーダル・保存・出力・再読み込み (UI-01〜06, UI-13, UI-14, UI-26)."""
from __future__ import annotations

import csv
import io
import json
import urllib.request

from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e


def _load_demo_via_ui(page, base_url: str) -> None:
    page.goto(base_url)
    load_btn = page.get_by_test_id("load-demo-btn")
    expect(load_btn).to_be_visible()
    load_btn.click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")


def test_ui_01_load_demo_displays_30_units_and_badges(page, e2e_server):
    """UI-01: 起動 → 「デモデータを読み込む」 → 一覧にカードが30単位表示され、件数のバッジが 20/10/19/2."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    expect(page.get_by_test_id("count-events")).to_have_text("20")
    expect(page.get_by_test_id("count-households")).to_have_text("10")
    expect(page.get_by_test_id("count-persons")).to_have_text("19")
    expect(page.get_by_test_id("count-pets")).to_have_text("2")

    cards = page.locator('[data-testid="card-grid"] > .hug-card')
    expect(cards).to_have_count(30)


def test_ui_02_switch_views_updates_cards_and_counts(page, e2e_server):
    """UI-02: 種別の表示を切り替える（イベント/世帯/人物/ペット） → 表示されるカードの種別と件数が変わる."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    cards = page.locator('[data-testid="card-grid"] > .hug-card')

    page.get_by_test_id("view-btn-event").click()
    expect(cards).to_have_count(20)

    page.get_by_test_id("view-btn-household").click()
    expect(cards).to_have_count(10)

    page.get_by_test_id("view-btn-person").click()
    expect(cards).to_have_count(19)

    page.get_by_test_id("view-btn-pet").click()
    expect(cards).to_have_count(2)


def test_ui_03_keyword_search_blanket(page, e2e_server):
    """UI-03: キーワード検索「毛布」 → EV-006 だけ表示される."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    page.get_by_test_id("view-btn-event").click()
    kw = page.get_by_test_id("keyword-input")
    kw.fill("毛布")
    kw.dispatch_event("change")

    expect(page.get_by_test_id("count-events")).to_have_text("1")
    cards = page.locator('[data-testid="card-grid"] > .hug-card')
    expect(cards).to_have_count(1)
    expect(page.get_by_test_id("card-EV-006")).to_be_visible()


def test_ui_04_multi_select_infrastructure_filter(page, e2e_server):
    """UI-04: 絞り込みでインフラを複数選択（停電・断水）、テスト用データ → 期待どおりの件数。チップが複数選択の状態になる."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    # FI-20 と同じく EV-001=match[断水], EV-002=exclude[停電], EV-003=match[ガス停止] に設定
    base = e2e_server["base_url"]
    for cid, patch in [
        ("EV-001", {"match_infrastructure": ["断水"]}),
        ("EV-002", {"exclude_infrastructure": ["停電"]}),
        ("EV-003", {"match_infrastructure": ["ガス停止"]}),
    ]:
        with urllib.request.urlopen(f"{base}/api/events/{cid}") as r:
            ev = json.loads(r.read().decode("utf-8"))
        ev.update(patch)
        req = urllib.request.Request(
            f"{base}/api/events/{cid}",
            data=json.dumps(ev).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        urllib.request.urlopen(req)

    page.get_by_test_id("view-btn-event").click()
    chip_power = page.get_by_test_id("multichip-filter-infrastructure-停電")
    chip_water = page.get_by_test_id("multichip-filter-infrastructure-断水")

    chip_power.click()
    chip_water.click()

    expect(chip_power).to_have_attribute("data-active", "true")
    expect(chip_water).to_have_attribute("data-active", "true")
    expect(page.get_by_test_id("count-events")).to_have_text("18")


def test_ui_05_clear_filters_restores_all_records(page, e2e_server):
    """UI-05: 絞り込みをクリアする → 全件に戻る."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    page.get_by_test_id("view-btn-event").click()
    kw = page.get_by_test_id("keyword-input")
    kw.fill("毛布")
    kw.dispatch_event("change")
    expect(page.get_by_test_id("count-events")).to_have_text("1")
    expect(page.locator('[data-testid="card-grid"] > .hug-card')).to_have_count(1)

    page.get_by_test_id("filter-clear-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")
    expect(page.locator('[data-testid="card-grid"] > .hug-card')).to_have_count(30)


def test_ui_06_card_detail_modal_prerequisite_navigation_and_esc_close(page, e2e_server):
    """UI-06: カードをクリックすると詳細モーダルが開き、Esc で閉じる → 全項目と関連カードのリンクが表示される。前提カードのリンクで EV-001 に移動できる."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    # EV-002 (前提カード = EV-001) をクリック
    page.get_by_test_id("card-EV-002").click()
    modal = page.get_by_test_id("detail-modal")
    expect(modal).to_be_visible()
    expect(page.get_by_test_id("modal-record-id")).to_have_text("EV-002")

    # 前提カード EV-001 のリンクをクリックして移動
    link_ev001 = page.get_by_test_id("modal-link-EV-001")
    expect(link_ev001).to_be_visible()
    link_ev001.click()
    expect(page.get_by_test_id("modal-record-id")).to_have_text("EV-001")

    # Esc キーで閉じる
    page.keyboard.press("Escape")
    expect(modal).to_have_count(0)


def test_ui_13_save_search_and_reopen_from_saved_tab(page, e2e_server):
    """UI-13: 検索結果を保存して、「保存済み」タブから再表示する → 同じ結果が表示される."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    page.get_by_test_id("view-btn-event").click()
    kw = page.get_by_test_id("keyword-input")
    kw.fill("毛布")
    kw.dispatch_event("change")
    expect(page.get_by_test_id("count-events")).to_have_text("1")
    expect(page.locator('[data-testid="card-grid"] > .hug-card')).to_have_count(1)

    page.get_by_test_id("save-search-name-input").fill("毛布の検索テスト")
    page.get_by_test_id("save-search-btn").click()

    # クリアして全件に戻す
    page.get_by_test_id("filter-clear-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")

    # 「保存済み」タブへ移動し、再表示をクリック
    page.get_by_test_id("tab-saved").click()
    page.locator(".open-saved-search-btn").first.click()

    expect(page.get_by_test_id("count-events")).to_have_text("1")
    expect(page.locator('[data-testid="card-grid"] > .hug-card')).to_have_count(1)
    expect(page.get_by_test_id("card-EV-006")).to_be_visible()


def test_ui_14_download_search_results_csv_and_json(page, e2e_server):
    """UI-14: 検索結果の CSV/JSON をダウンロードする → ファイルがダウンロードされ、内容が正しい."""
    _load_demo_via_ui(page, e2e_server["base_url"])

    page.get_by_test_id("view-btn-event").click()
    kw = page.get_by_test_id("keyword-input")
    kw.fill("毛布")
    kw.dispatch_event("change")
    expect(page.get_by_test_id("count-events")).to_have_text("1")
    expect(page.locator('[data-testid="card-grid"] > .hug-card')).to_have_count(1)

    # JSON ダウンロード検証
    with page.expect_download() as dl_json_info:
        page.get_by_test_id("export-search-json-btn").click()
    dl_json = dl_json_info.value
    json_bytes = Path_read_bytes(dl_json.path())
    parsed_json = json.loads(json_bytes.decode("utf-8"))
    assert [e["card_id"] for e in parsed_json["cards_event"]] == ["EV-006"]

    # CSV ダウンロード検証
    with page.expect_download() as dl_csv_info:
        page.get_by_test_id("export-search-cardcsv-btn").click()
    dl_csv = dl_csv_info.value
    csv_bytes = Path_read_bytes(dl_csv.path())
    assert csv_bytes.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8-sig"))))
    assert len(rows) == 2  # ヘッダ + EV-006 の1行
    assert rows[1][1] == "イベント"


def Path_read_bytes(p) -> bytes:
    with open(p, "rb") as f:
        return f.read()


def test_ui_26_page_reload_persists_data(page, e2e_server):
    """UI-26: 再読み込み（F5）する → データが残っている（永続化）."""
    _load_demo_via_ui(page, e2e_server["base_url"])
    expect(page.get_by_test_id("count-units")).to_have_text("30")

    page.reload()
    expect(page.get_by_test_id("count-units")).to_have_text("30")
    expect(page.get_by_test_id("count-events")).to_have_text("20")
    expect(page.get_by_test_id("count-households")).to_have_text("10")
