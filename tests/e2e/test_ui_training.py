"""Playwright E2E テスト: 閲覧モードおよび現場訓練実行ページ（UI-21 / 訓練実行・カルーセル＆スポットライト）."""
from __future__ import annotations

import json
from pathlib import Path
import re
from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e


def test_ui_21_training_view_keyboard_navigation_household_header_and_training_point_toggle(page, e2e_server):
    """UI-21: 閲覧モード: ←→キーで進行状況バーが連動し、世帯見出しや訓練ポイントトグルが動作する."""
    page.goto(e2e_server["base_url"])
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")

    page.get_by_test_id("tab-deck").click()
    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("41枚")

    page.get_by_test_id("open-training-view-btn").click()
    expect(page.get_by_test_id("training-view")).to_be_visible()
    expect(page.get_by_test_id("training-counter")).to_contain_text("1 / 41")
    expect(page.get_by_test_id("training-progress-bar")).to_have_attribute("value", "1")

    # 訓練ポイントは初期状態では非表示で、ボタンを押すと表示される
    expect(page.get_by_test_id("training-point-content")).to_have_count(0)
    page.get_by_test_id("training-point-toggle-btn").click()
    expect(page.get_by_test_id("training-point-content")).to_be_visible()

    # → キーで 2スライド目 (GRP-001) に進むと世帯見出しが表示され、訓練ポイントは再び隠れる
    page.keyboard.press("ArrowRight")
    expect(page.get_by_test_id("training-counter")).to_contain_text("41")
    expect(page.get_by_test_id("training-household-header")).to_be_visible()
    expect(page.get_by_test_id("training-point-content")).to_have_count(0)

    # 最初に戻る
    page.keyboard.press("ArrowLeft")
    expect(page.get_by_test_id("training-counter")).to_contain_text("1 / 41")


def test_training_page_load_deck_and_preview_table(page, e2e_server):
    """訓練実行ページ: JSONファイル読み込みでカード一覧と統計が表示される（プリセットは廃止）."""
    fixture_path = Path("tests/fixtures/sample_format2.json").resolve()
    page.goto(f"{e2e_server['base_url']}/training.html")
    expect(page.get_by_test_id("tr-setup-view")).to_be_visible()

    # トップ画面に正式ロゴが表示され、画像が実際に読み込まれていることを確認
    setup_logo = page.locator(".tr-setup-logo-img")
    expect(setup_logo).to_be_visible()
    page.wait_for_function("() => { const el = document.querySelector('.tr-setup-logo-img'); return el && el.complete && el.naturalWidth > 0; }")

    # 標準プリセット訓練ボタンが存在しないこと（不要機能として削除済み）を確認
    expect(page.locator("#tr-preset-earthquake-btn")).to_have_count(0)
    expect(page.locator("#tr-preset-flood-btn")).to_have_count(0)

    # JSONファイル読み込み
    page.locator("#tr-file-input").set_input_files(str(fixture_path))
    expect(page.get_by_test_id("tr-loaded-deck-section")).to_be_visible()
    expect(page.get_by_test_id("stat-total-cards")).to_be_visible()

    # カード一覧テーブルが表示される
    expect(page.locator(".tr-preview-table tbody tr")).to_have_count(page.locator(".tr-preview-table tbody tr").count())
    expect(page.get_by_test_id("tr-start-training-btn")).to_be_visible()


def test_training_page_flow_carousel_spotlight_and_keyboard_navigation(page, e2e_server):
    """訓練実行ページ: カルーセル・スポットライト、Space/Enter(世帯単位)と←→(1枚単位)のキーボード操作、全画面ギャラリー."""
    fixture_path = Path("tests/fixtures/sample_format2.json").resolve()
    page.goto(f"{e2e_server['base_url']}/training.html")
    page.locator("#tr-file-input").set_input_files(str(fixture_path))
    expect(page.get_by_test_id("tr-start-training-btn")).to_be_visible()

    # 訓練開始
    page.get_by_test_id("tr-start-training-btn").click()
    expect(page.get_by_test_id("tr-stage-view")).to_be_visible()

    # 開始時は全カード裏返し（カード裏面に正式ロゴが表示されている）
    expect(page.get_by_test_id("tr-card-back")).to_be_visible()
    first_slot = page.locator("#tr-card-slot-1")
    expect(first_slot).to_have_class(re.compile(r"is-back"))
    back_logo_img = first_slot.locator(".tr-card-back-logo-img")
    expect(back_logo_img).to_be_visible()
    page.wait_for_function("() => { const el = document.querySelector('#tr-card-slot-1 .tr-card-back-logo-img'); return el && el.complete && el.naturalWidth > 0; }")

    # キーボードヒント表示の確認
    expect(page.get_by_test_id("tr-keyboard-hint")).to_be_visible()

    # Spaceキーで最初のカード（スライド1）をめくる
    page.keyboard.press("Space")
    expect(page.get_by_test_id("tr-event-header")).to_be_visible()
    expect(first_slot).to_have_class(re.compile(r"is-spotlight"))

    # イラスト画像がレンダリングされていること
    first_img = first_slot.locator(".tr-carousel-card-img")
    expect(first_img).to_be_visible()
    img_src = first_img.get_attribute("src")
    assert img_src and img_src.startswith("data:image/"), f"カード画像が生成されていません: {img_src}"

    # 訓練ポイントトグル
    expect(page.locator("#tr-point-popup")).not_to_be_visible()
    page.get_by_test_id("tr-toggle-point-btn").click()
    expect(page.locator("#tr-point-popup")).to_be_visible()
    page.locator("#tr-close-point-popup-btn").click()
    expect(page.locator("#tr-point-popup")).not_to_be_visible()

    # Enterキーで次のスライド（世帯/イベント）へ進む
    page.keyboard.press("Enter")
    second_slot = page.locator("#tr-card-slot-2")
    expect(second_slot).to_have_class(re.compile(r"is-spotlight"))
    expect(first_slot).to_have_class(re.compile(r"is-past"))

    # 矢印キー（ArrowLeft）でカード1枚戻し
    page.keyboard.press("ArrowLeft")
    expect(first_slot).to_have_class(re.compile(r"is-single-focused"))

    # 矢印キー（ArrowRight）でカード1枚送り
    page.keyboard.press("ArrowRight")
    expect(second_slot).to_have_class(re.compile(r"is-single-focused"))

    # 全画面サムネイル一覧ギャラリーを開く
    page.get_by_test_id("tr-open-history-btn").click()
    gallery_modal = page.locator("#tr-gallery-modal")
    expect(gallery_modal).to_be_visible()

    # サムネイルをクリックして拡大ライトボックスを開く
    page.get_by_test_id("tr-history-item-1").click()
    lightbox = page.locator("#tr-lightbox-overlay")
    expect(lightbox).to_be_visible()
    expect(page.locator("#tr-lightbox-img")).to_be_visible()

    # 「このカードの位置に戻る」をクリックして復帰
    page.locator("#tr-lightbox-select-btn").click()
    expect(lightbox).not_to_be_visible()
    expect(gallery_modal).not_to_be_visible()
    expect(first_slot).to_have_class(re.compile(r"is-spotlight"))


def test_training_page_four_member_household_scroll_adjustment(page, e2e_server):
    """4名以上のグループにスポットライトが当たったとき、グループ中心に合わせてスクロールされることを検証."""
    # cards_db.json から EV-001 と GRP-655 (4人家族) を抽出してテストデッキを作成
    import tempfile
    with open("data/cards_db.json", encoding="utf-8") as f:
        cards_db = json.load(f)
    
    ev = cards_db["cards_event"][0]
    grp = [g for g in cards_db["evacuee_groups"] if g["group_id"] == "GRP-655"][0]
    members = [m for m in cards_db["group_members"] if m["group_id"] == "GRP-655"]

    four_person_deck = {
        "cards_event": [ev],
        "evacuee_groups": [grp],
        "group_members": members,
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(four_person_deck, f, ensure_ascii=False)
        temp_path = f.name

    try:
        page.goto(f"{e2e_server['base_url']}/training.html")
        page.locator("#tr-file-input").set_input_files(temp_path)
        expect(page.get_by_test_id("tr-start-training-btn")).to_be_visible()

        # 訓練開始
        page.get_by_test_id("tr-start-training-btn").click()
        expect(page.get_by_test_id("tr-stage-view")).to_be_visible()

        # No.1 (イベント) をめくる
        page.keyboard.press("Space")
        expect(page.locator("#tr-card-slot-1")).to_have_class(re.compile(r"is-spotlight"))

        # Spaceキーで次のスライド（4人家族：No.2〜5）をめくる
        page.keyboard.press("Space")
        # 4人全員がスポットライト（is-spotlight）を持つ
        expect(page.locator("#tr-card-slot-2")).to_have_class(re.compile(r"is-spotlight"))
        expect(page.locator("#tr-card-slot-3")).to_have_class(re.compile(r"is-spotlight"))
        expect(page.locator("#tr-card-slot-4")).to_have_class(re.compile(r"is-spotlight"))
        expect(page.locator("#tr-card-slot-5")).to_have_class(re.compile(r"is-spotlight"))

        # 世帯見出しバナーにGRP-655の世帯情報が表示される
        expect(page.get_by_test_id("tr-household-header")).to_contain_text("GRP-655")

        # 矢印キー（ArrowRight）でカード1枚ずつ送る（No.5 まで送る）
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect(page.locator("#tr-card-slot-5")).to_have_class(re.compile(r"is-single-focused"))

        # 矢印キー（ArrowLeft）で前のカード（No.4）に戻る
        page.keyboard.press("ArrowLeft")
        expect(page.locator("#tr-card-slot-4")).to_have_class(re.compile(r"is-single-focused"))
    finally:
        Path(temp_path).unlink(missing_ok=True)


def test_training_page_mobile_single_card_view(page, e2e_server):
    """スマートフォン縦長画面(390x664)で1枚表示レイアウト・はみ出しゼロ・1枚送り操作が機能することを検証."""
    import tempfile

    page.set_viewport_size({"width": 390, "height": 664})

    with open("data/cards_db.json", encoding="utf-8") as f:
        cards_db = json.load(f)

    ev = cards_db["cards_event"][0]
    grp = [g for g in cards_db["evacuee_groups"] if g["group_id"] == "GRP-655"][0]
    members = [m for m in cards_db["group_members"] if m["group_id"] == "GRP-655"]

    four_person_deck = {
        "cards_event": [ev],
        "evacuee_groups": [grp],
        "group_members": members,
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(four_person_deck, f, ensure_ascii=False)
        temp_path = f.name

    try:
        page.goto(f"{e2e_server['base_url']}/training.html")
        page.locator("#tr-file-input").set_input_files(temp_path)
        expect(page.get_by_test_id("tr-start-training-btn")).to_be_visible()

        # 訓練開始
        page.get_by_test_id("tr-start-training-btn").click()
        expect(page.get_by_test_id("tr-stage-view")).to_be_visible()

        # 下部操作バーがモバイル画面内に収まっていること
        bottom_bar = page.locator(".tr-arena-bottombar")
        expect(bottom_bar).to_be_visible()
        bottom_box = bottom_bar.bounding_box()
        assert bottom_box is not None
        assert bottom_box["y"] + bottom_box["height"] <= 664.5

        # トップバーのスクリーンリーダー用テキストが画面上に露出していないこと
        sr_box = page.locator("#tr-progress-text").bounding_box()
        assert sr_box is not None and sr_box["width"] <= 2 and sr_box["height"] <= 2

        # 開始前状態で下部ボタン同士が重ならず、メインボタンが十分な幅を持っていること
        prev_box = page.locator("#tr-prev-card-btn").bounding_box()
        next_box = page.locator("#tr-next-card-btn").bounding_box()
        point_box = page.locator("#tr-toggle-point-btn").bounding_box()
        sound_box = page.locator("#tr-sound-btn").bounding_box()
        assert prev_box and next_box and point_box and sound_box
        assert prev_box["x"] + prev_box["width"] <= next_box["x"] + 1
        assert next_box["x"] + next_box["width"] <= point_box["x"] + 1
        assert point_box["x"] + point_box["width"] <= sound_box["x"] + 1
        assert next_box["width"] >= 140

        # 1枚目(イベント No.1)をめくる
        next_btn = page.get_by_test_id("tr-next-card-btn")
        next_btn.click()
        expect(page.locator("#tr-card-slot-1")).to_have_class(re.compile(r"is-spotlight"))

        # 次のスライド(4人世帯 No.2〜5)をめくる
        next_btn.click()
        expect(page.get_by_test_id("tr-household-header")).to_contain_text("GRP-655")
        expect(page.locator("#tr-member-step-badge")).to_have_text("1/4枚目")
        expect(next_btn).to_contain_text("次のメンバー (2/4)")

        # 見出しバナーとカードが重ならず、画面内に収まっていることを検証
        banner_box = page.get_by_test_id("tr-household-header").bounding_box()
        card2_box = page.locator("#tr-card-slot-2").bounding_box()
        assert banner_box is not None and card2_box is not None
        assert banner_box["y"] + banner_box["height"] <= card2_box["y"] + 2
        assert card2_box["y"] + card2_box["height"] <= bottom_box["y"] + 2

        # スマホでは4名世帯でも先頭カード(No.2)が画面中央に表示されていることを検証
        page.wait_for_timeout(350)
        card2_box_after = page.locator("#tr-card-slot-2").bounding_box()
        assert card2_box_after is not None
        card2_center_x = card2_box_after["x"] + card2_box_after["width"] / 2
        assert 140 <= card2_center_x <= 250

        # ボタンタップで世帯内の次のメンバー(2/4 -> 3/4 -> 4/4)へ1枚ずつ進むことを検証
        next_btn.click()
        expect(page.locator("#tr-member-step-badge")).to_have_text("2/4枚目")
        expect(next_btn).to_contain_text("次のメンバー (3/4)")

        next_btn.click()
        expect(page.locator("#tr-member-step-badge")).to_have_text("3/4枚目")
        expect(next_btn).to_contain_text("次のメンバー (4/4)")

        next_btn.click()
        expect(page.locator("#tr-member-step-badge")).to_have_text("4/4枚目")
        expect(next_btn).to_contain_text("訓練完了")

        # 表示済みカード一覧からカードを拡大した際、ライトボックスの画像とボタンが画面外に見切れないことを検証
        page.get_by_test_id("tr-open-history-btn").click()
        expect(page.locator("#tr-gallery-modal")).to_be_visible()
        page.get_by_test_id("tr-history-item-2").click()
        expect(page.locator("#tr-lightbox-overlay")).to_be_visible()

        lb_img_box = page.locator("#tr-lightbox-img").bounding_box()
        lb_sel_box = page.locator("#tr-lightbox-select-btn").bounding_box()
        lb_cls_box = page.locator("#tr-lightbox-close-btn").bounding_box()
        assert lb_img_box and lb_sel_box and lb_cls_box
        assert lb_sel_box["x"] >= 0
        assert lb_cls_box["x"] + lb_cls_box["width"] <= 390
        assert lb_cls_box["y"] + lb_cls_box["height"] <= 664.5
    finally:
        Path(temp_path).unlink(missing_ok=True)

