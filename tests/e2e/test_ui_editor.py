"""Playwright E2E テスト: イベント・世帯の新規作成・編集・削除 (UI-07 〜 UI-12)."""
from __future__ import annotations

import json
import urllib.request

from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e


def _load_demo(page, base_url: str) -> None:
    page.goto(base_url)
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")


def test_ui_07_create_event_with_tristate_chips_and_live_preview(page, e2e_server):
    """UI-07: イベントを新規作成する（3状態チップで「合致」「排除」を設定） → プレビューにすぐ反映され、保存すると EV-021 が一覧に出る。JSONで match/exclude に正しく入っている."""
    base = e2e_server["base_url"]
    _load_demo(page, base)

    page.get_by_test_id("tab-editor").click()
    page.get_by_test_id("input-event-event_name").fill("新規給水車到着イベント")
    page.get_by_test_id("input-event-source").fill("水道局")
    page.get_by_test_id("input-event-content").fill("給水車が校庭に到着しました。")
    page.get_by_test_id("multichip-event-category-行政対応").click()

    # 3状態チップ: 地震=合致(1回クリック), 豪雨=排除(2回クリック)
    chip_eq = page.get_by_test_id("trichip-disaster_types-地震")
    chip_rain = page.get_by_test_id("trichip-disaster_types-豪雨")
    chip_eq.click()
    chip_rain.click()
    chip_rain.click()

    # リアルタイムプレビューに反映されていること
    preview = page.get_by_test_id("event-live-preview")
    expect(preview).to_contain_text("新規給水車到着イベント")
    expect(preview.get_by_test_id("badge-match-disaster_types-地震")).to_be_visible()
    expect(preview.get_by_test_id("badge-exclude-disaster_types-豪雨")).to_be_visible()

    # 保存すると一覧に戻り、EV-021 が表示される
    page.get_by_test_id("save-event-btn").click()
    expect(page.get_by_test_id("card-EV-021")).to_be_visible()

    # サーバーの JSON に match / exclude が正しく格納されていること
    with urllib.request.urlopen(f"{base}/api/events/EV-021") as r:
        ev21 = json.loads(r.read().decode("utf-8"))
    assert ev21["match_disaster_types"] == ["地震"]
    assert ev21["exclude_disaster_types"] == ["豪雨"]


def test_ui_08_save_event_with_missing_required_fields_shows_red_error(page, e2e_server):
    """UI-08: 必須項目が空のまま保存する → 赤いエラー表示が出て、保存できない."""
    page.goto(e2e_server["base_url"])
    page.get_by_test_id("tab-editor").click()

    # イベント名や本文が空のまま保存ボタンをクリック
    page.get_by_test_id("save-event-btn").click()

    err_box = page.get_by_test_id("event-validation-errors")
    expect(err_box).to_be_visible()
    expect(err_box).to_contain_text("必須")


def test_ui_09_edit_event_ev020_timing_to_head_moves_it_up_in_deck_order(page, e2e_server):
    """UI-09: イベントを編集する（EV-020 の時期を「先頭」に変える） → デッキ順の一覧で上位に移る（順番の再計算）."""
    _load_demo(page, e2e_server["base_url"])

    # EV-020 の詳細を開き、「編集」をクリック
    page.get_by_test_id("card-EV-020").click()
    page.get_by_test_id("modal-edit-btn").click()

    # 相対発生時期の「最後（振り返り・収束）」「終盤」を外して「先頭（開所・初期）」を選択し、優先度も 0 に設定
    for old_label in ("終盤", "最後（振り返り・収束）"):
        chip_old = page.get_by_test_id(f"multichip-event-relative_timing-{old_label}")
        if chip_old.get_attribute("data-active") == "true":
            chip_old.click()
    page.get_by_test_id("multichip-event-relative_timing-先頭（開所・初期）").click()
    page.get_by_test_id("input-event-priority").fill("0")

    page.get_by_test_id("save-event-btn").click()
    expect(page.locator('[data-testid="card-grid"] > .hug-card')).to_have_count(30)

    # デッキ順の一覧で EV-020 が上位（先頭グループ 5件以内）に移動していること
    first_five_ids = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="card-grid"] > .hug-card'))
            .slice(0, 5)
            .map(el => el.dataset.cardId || el.dataset.groupId)"""
    )
    assert "EV-020" in first_five_ids


def test_ui_10_delete_prerequisite_event_shows_confirm_dialog_with_dependents(page, e2e_server):
    """UI-10: 前提カードになっているイベントを削除する → 確認ダイアログに依存しているカードが表示され、確定すると削除される."""
    _load_demo(page, e2e_server["base_url"])

    page.get_by_test_id("card-EV-001").click()
    page.get_by_test_id("modal-delete-btn").click()

    confirm_modal = page.get_by_test_id("confirm-modal")
    expect(confirm_modal).to_be_visible()
    expect(page.get_by_test_id("confirm-details")).to_contain_text("EV-002")

    page.get_by_test_id("confirm-ok-btn").click()
    expect(page.get_by_test_id("count-events")).to_have_text("19")
    expect(page.get_by_test_id("card-EV-001")).to_have_count(0)


def test_ui_11_create_household_with_2_persons_and_1_pet(page, e2e_server):
    """UI-11: 世帯を新規作成する（人物2名とペット1匹を行として追加） → 人数が自動で表示される。ペットの行にはペット用の項目だけが出る."""
    _load_demo(page, e2e_server["base_url"])

    page.get_by_test_id("tab-editor").click()
    page.get_by_test_id("editor-mode-household").click()

    page.get_by_test_id("input-group-group_name").fill("新規テスト世帯")

    # 初期状態は人物1名 → 人物を1名追加、ペットを1匹追加
    page.get_by_test_id("add-person-row-btn").click()
    page.get_by_test_id("add-pet-row-btn").click()

    expect(page.get_by_test_id("live-member-count")).to_have_text("2")
    expect(page.get_by_test_id("live-pet-count")).to_have_text("1")

    # 行 #0, #1 は人物用項目のみ、行 #2 (ペット) はペット用項目のみ表示されること
    expect(page.get_by_test_id("person-only-fields-0")).to_be_visible()
    expect(page.get_by_test_id("pet-only-fields-0")).to_have_count(0)

    expect(page.get_by_test_id("pet-only-fields-2")).to_be_visible()
    expect(page.get_by_test_id("person-only-fields-2")).to_have_count(0)

    page.get_by_test_id("save-household-btn").click()
    expect(page.get_by_test_id("count-households")).to_have_text("11")
    expect(page.get_by_test_id("count-persons")).to_have_text("21")
    expect(page.get_by_test_id("count-pets")).to_have_text("3")


def test_ui_12_delete_household_cascades_members(page, e2e_server):
    """UI-12: 世帯を削除する → 構成員も一覧から消える."""
    _load_demo(page, e2e_server["base_url"])

    # GRP-001 (人物2名) を削除
    page.get_by_test_id("card-GRP-001").click()
    page.get_by_test_id("modal-delete-btn").click()

    expect(page.get_by_test_id("count-households")).to_have_text("9")
    expect(page.get_by_test_id("count-persons")).to_have_text("17")
    expect(page.get_by_test_id("card-GRP-001")).to_have_count(0)
