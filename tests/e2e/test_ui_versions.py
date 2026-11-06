"""Playwright E2E テスト: バージョン作成・差分・復元・コンソールエラーゼロ確認 (UI-23, UI-24, UI-27)."""
from __future__ import annotations

from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e


def _load_demo(page, base_url: str) -> None:
    page.goto(base_url)
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")


def test_ui_23_create_version_delete_card_and_restore(page, e2e_server):
    """UI-23: バージョンを作成 → カードを削除 → 復元 → 削除したカードが戻る。復元前の自動バージョンが一覧に出る."""
    _load_demo(page, e2e_server["base_url"])

    # バージョンを作成
    page.get_by_test_id("tab-versions").click()
    page.get_by_test_id("version-label-input").fill("削除前スナップショット")
    page.get_by_test_id("create-version-btn").click()
    expect(page.locator(".version-row")).to_have_count(2)  # auto_import + manual

    # 一覧に戻り EV-020 を削除
    page.get_by_test_id("tab-list").click()
    page.get_by_test_id("card-EV-020").click()
    page.get_by_test_id("modal-delete-btn").click()
    expect(page.get_by_test_id("count-events")).to_have_text("19")
    expect(page.get_by_test_id("card-EV-020")).to_have_count(0)

    # バージョンタブから「削除前スナップショット」を復元
    page.get_by_test_id("tab-versions").click()
    manual_row = page.locator('.version-row[data-version-kind="manual"]').first
    manual_row.locator(".version-restore-btn").click()
    page.get_by_test_id("confirm-ok-btn").click()

    # 復元前の自動バージョン (auto_restore) が一覧に追加されていること
    expect(page.locator('.version-row[data-version-kind="auto_restore"]')).to_have_count(1)

    # 一覧に戻ると EV-020 が復活して 20 件に戻っていること
    page.get_by_test_id("tab-list").click()
    expect(page.get_by_test_id("count-events")).to_have_text("20")
    expect(page.get_by_test_id("card-EV-020")).to_be_visible()


def test_ui_24_version_diff_viewer(page, e2e_server):
    """UI-24: バージョンの差分を表示する → 追加・削除・変更が表示される."""
    _load_demo(page, e2e_server["base_url"])

    page.get_by_test_id("tab-versions").click()
    page.get_by_test_id("version-label-input").fill("差分基準バージョン")
    page.get_by_test_id("create-version-btn").click()

    # EV-020 を削除して差分を作る
    page.get_by_test_id("tab-list").click()
    page.get_by_test_id("card-EV-020").click()
    page.get_by_test_id("modal-delete-btn").click()
    expect(page.get_by_test_id("count-events")).to_have_text("19")

    page.get_by_test_id("tab-versions").click()
    manual_row = page.locator('.version-row[data-version-kind="manual"]').first
    manual_row.locator(".version-diff-btn").click()

    diff_panel = page.get_by_test_id("version-diff-panel")
    expect(diff_panel).to_be_visible()
    expect(diff_panel).to_contain_text("EV-020")


def test_ui_27_zero_console_errors_across_navigation(page, e2e_server, monitor_console_errors):
    """UI-27: ブラウザのコンソール → すべての E2E テストを通して JS エラーが0件."""
    _load_demo(page, e2e_server["base_url"])
    for tab in ("list", "editor", "deck", "saved", "io", "versions", "list"):
        page.get_by_test_id(f"tab-{tab}").click()
    assert monitor_console_errors == []
