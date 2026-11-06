"""Playwright E2E テスト: インポート（複数ファイル・ドライラン）と全件削除 (UI-15, UI-25)."""
from __future__ import annotations

from pathlib import Path
import json
import urllib.request

from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def test_ui_15_multi_file_import_preview_and_commit(page, e2e_server):
    """UI-15: インポート: 2つのファイルを同時に選び、プレビューを見てから確定 → 件数・ID対応表・警告が表示され、確定すると反映される."""
    page.goto(e2e_server["base_url"])
    page.get_by_test_id("tab-io").click()

    f1 = str(FIXTURES_DIR / "events_groups_only.json")
    f2 = str(FIXTURES_DIR / "members_only.json")

    file_input = page.get_by_test_id("import-file-input")
    file_input.set_input_files([f1, f2])

    preview_box = page.get_by_test_id("import-preview-box")
    expect(preview_box).to_be_visible()
    expect(page.get_by_test_id("import-preview-counts")).to_contain_text("20")
    expect(page.get_by_test_id("import-preview-counts")).to_contain_text("10")
    expect(page.get_by_test_id("import-preview-counts")).to_contain_text("21")
    expect(page.get_by_test_id("import-preview-id-map")).to_be_visible()
    expect(page.get_by_test_id("import-preview-warnings")).to_be_visible()
    expect(page.get_by_test_id("import-preview-warnings")).not_to_contain_text("[object Object]")

    # 追加モードに切り替えると ID 対応表および警告が正しく人間可読テキストで表示されること
    page.get_by_test_id("import-mode-select").select_option("append")
    expect(page.get_by_test_id("import-preview-warnings")).not_to_contain_text("[object Object]")
    page.get_by_test_id("import-mode-select").select_option("replace")

    commit_btn = page.get_by_test_id("import-commit-btn")
    expect(commit_btn).to_be_enabled()
    commit_btn.click()

    # 一覧タブへ移動して30単位が反映されていることを確認
    page.get_by_test_id("tab-list").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")


def test_ui_25_clear_all_requires_confirmation_string_and_creates_auto_clear_version(page, e2e_server):
    """UI-25: 全件削除: 「削除」と入力しないと確定ボタンが押せない → 入力すると実行され、一覧が空になる。auto_clear のバージョンができる."""
    base = e2e_server["base_url"]
    page.goto(base)
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")

    page.get_by_test_id("tab-io").click()
    clear_input = page.get_by_test_id("clear-confirm-input")
    clear_btn = page.get_by_test_id("clear-submit-btn")

    expect(clear_btn).to_be_disabled()
    clear_input.fill("キャンセル")
    expect(clear_btn).to_be_disabled()

    clear_input.fill("削除")
    expect(clear_btn).to_be_enabled()
    clear_btn.click()

    # 一覧に戻ると 0 件になっていること
    page.get_by_test_id("tab-list").click()
    expect(page.get_by_test_id("count-units")).to_have_text("0")

    # auto_clear バージョンが作成されていること
    with urllib.request.urlopen(f"{base}/api/versions?kind=auto_clear") as r:
        versions = json.loads(r.read().decode("utf-8"))
    assert len(versions) == 1
    assert versions[0]["kind"] == "auto_clear"
