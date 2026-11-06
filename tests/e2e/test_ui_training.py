"""Playwright E2E テスト: 閲覧モード（訓練モード, UI-21）."""
from __future__ import annotations

from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e


def test_ui_21_training_view_keyboard_navigation_household_header_and_training_point_toggle(page, e2e_server):
    """UI-21: 閲覧モード: ←→キーで1枚目から41枚目まで進み、戻る → 番号と進行状況バーが連動する。世帯の見出しが出る。訓練ポイントはボタンを押すまで隠れている."""
    page.goto(e2e_server["base_url"])
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")

    page.get_by_test_id("tab-deck").click()
    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("41枚")

    page.get_by_test_id("open-training-view-btn").click()
    expect(page.get_by_test_id("training-view")).to_be_visible()
    expect(page.get_by_test_id("training-counter")).to_have_text("1 / 41")
    expect(page.get_by_test_id("training-progress-bar")).to_have_attribute("value", "1")

    # 訓練ポイントは初期状態では非表示で、ボタンを押すと表示される
    expect(page.get_by_test_id("training-point-content")).to_have_count(0)
    page.get_by_test_id("training-point-toggle-btn").click()
    expect(page.get_by_test_id("training-point-content")).to_be_visible()

    # → キーで 2枚目 (GRP-001 の1人目 M-0001) に進むと世帯見出しが表示され、訓練ポイントは再び隠れる
    page.keyboard.press("ArrowRight")
    expect(page.get_by_test_id("training-counter")).to_have_text("2 / 41")
    expect(page.get_by_test_id("training-progress-bar")).to_have_attribute("value", "2")
    expect(page.get_by_test_id("training-household-header")).to_be_visible()
    expect(page.get_by_test_id("training-point-content")).to_have_count(0)

    # → キーで 41枚目まで進む
    for _ in range(39):
        page.keyboard.press("ArrowRight")
    expect(page.get_by_test_id("training-counter")).to_have_text("41 / 41")
    expect(page.get_by_test_id("training-progress-bar")).to_have_attribute("value", "41")

    # ← キーで 40枚目に戻る
    page.keyboard.press("ArrowLeft")
    expect(page.get_by_test_id("training-counter")).to_have_text("40 / 41")
