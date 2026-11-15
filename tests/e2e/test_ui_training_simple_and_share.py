"""シンプル訓練ページ・保存デッキURL共有＆QRダウンロード・表示改善 E2E テスト."""
from __future__ import annotations

import json
import tempfile
import urllib.parse
from pathlib import Path

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e


def _make_household_and_event_deck(tmp_dir: Path) -> Path:
    """テスト用のイベント+4人世帯デッキJSONを生成する."""
    cards_db = json.loads(Path("data/cards_db.json").read_text(encoding="utf-8"))
    ev1 = next(e for e in cards_db["cards_event"] if e.get("relative_timing"))
    grp655 = next(g for g in cards_db["evacuee_groups"] if g["group_id"] == "GRP-655")
    mems655 = [m for m in cards_db["group_members"] if m["group_id"] == "GRP-655"]
    assert len(mems655) == 4

    deck_json = {
        "cards_event": [ev1],
        "evacuee_groups": [grp655],
        "group_members": mems655,
        "_web_deck_meta": {
            "card_sequence": [
                {"card_number": 1, "kind": "event", "original_id": ev1["card_id"], "group_id": None}
            ]
            + [
                {
                    "card_number": i + 2,
                    "kind": "pet" if m.get("data_type") == "ペット" else "person",
                    "original_id": m["member_id"],
                    "group_id": "GRP-655",
                }
                for i, m in enumerate(mems655)
            ]
        },
    }
    deck_path = tmp_dir / "test_hh4_event_deck.json"
    deck_path.write_text(json.dumps(deck_json, ensure_ascii=False), encoding="utf-8")
    return deck_path


def _load_demo_and_open_deck(page, base_url: str) -> None:
    page.goto(base_url)
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")
    page.get_by_test_id("tab-deck").click()
    expect(page.get_by_test_id("save-deck-btn")).to_be_visible()


def test_db_tool_deck_save_shows_share_url_copy_and_qr_download(page, e2e_server, tmp_path: Path):
    """DBツールでデッキ保存後、簡易訓練ページのURL表示・コピー・QRコードPNGダウンロードができ、保存済み一覧からも開ける."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    deck_name = "小平訓練デッキ2026"
    page.get_by_test_id("save-deck-name-input").fill(deck_name)
    page.get_by_test_id("save-deck-btn").click()

    # 保存後すぐにインライン共有パネルが表示される
    share_panel = page.get_by_test_id("deck-share-panel")
    expect(share_panel).to_be_visible()

    url_input = share_panel.get_by_test_id("deck-share-url-input")
    url_val = url_input.input_value()
    parsed = urllib.parse.urlparse(url_val)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
        "https://takahashikatsunori.github.io/k-hug2026/training-simple.html"
    )
    qs = urllib.parse.parse_qs(parsed.query)
    assert qs.get("deck") == [deck_name]

    # QRコードがキャンバスに描画されていること（非白ピクセル存在確認）
    qr_has_dark_pixels = page.evaluate(
        """() => {
            const c = document.querySelector('[data-testid="deck-share-qr-canvas"]');
            if (!c) return false;
            const ctx = c.getContext('2d');
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] < 40 && data[i+1] < 40 && data[i+2] < 40) return true;
            }
            return false;
        }"""
    )
    assert qr_has_dark_pixels is True

    # URLコピーボタンをクリック
    share_panel.get_by_test_id("copy-deck-url-btn").click()
    expect(page.locator("#toast-container")).to_contain_text("URL")

    # QRコード画像ダウンロードボタンをクリックしてPNGファイルが保存されること
    with page.expect_download() as dl_info:
        share_panel.get_by_test_id("download-deck-qr-btn").click()
    download = dl_info.value
    assert download.suggested_filename.endswith(".png")
    assert "小平訓練デッキ2026" in download.suggested_filename
    dl_path = tmp_path / download.suggested_filename
    download.save_as(str(dl_path))
    raw_bytes = dl_path.read_bytes()
    assert raw_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    # ツールバーの「URL・QR」ボタンからモーダルを開けること
    page.get_by_test_id("share-saved-deck-btn").click()
    share_modal = page.get_by_test_id("deck-share-modal")
    expect(share_modal).to_be_visible()
    expect(share_modal.get_by_test_id("deck-share-url-input")).to_have_value(url_val)
    share_modal.locator("#deck-share-modal-close-x").click()
    expect(share_modal).not_to_be_visible()

    # 保存済みタブの一覧からも「訓練URL・QR」ボタンで開けること
    page.get_by_test_id("tab-saved").click()
    share_saved_btn = page.locator(".share-saved-deck-btn").first
    expect(share_saved_btn).to_be_visible()
    share_saved_btn.click()
    expect(page.get_by_test_id("deck-share-modal")).to_be_visible()


def test_simple_training_url_param_auto_load_and_defaults(page, e2e_server):
    """training-simple.html?deck=<名> でサーバー上のデッキを自動読込し、スタートするだけのタイトル画面から世帯単位・手動で開始できる."""
    # まずDBにデモデータと保存済みデッキを登録
    _load_demo_and_open_deck(page, e2e_server["base_url"])
    deck_name = "URL自動読込テスト"
    page.get_by_test_id("save-deck-name-input").fill(deck_name)
    page.get_by_test_id("save-deck-btn").click()
    expect(page.get_by_test_id("deck-share-panel")).to_be_visible()

    # 簡易訓練ページへ ?deck= 付きでアクセス
    encoded_name = urllib.parse.quote(deck_name)
    page.goto(f"{e2e_server['base_url']}/training-simple.html?deck={encoded_name}")

    title_view = page.get_by_test_id("tr-simple-title-view")
    expect(title_view).to_be_visible()
    expect(page.get_by_test_id("tr-simple-deck-name")).to_contain_text(deck_name)
    start_btn = page.get_by_test_id("tr-start-training-btn")
    expect(start_btn).to_be_visible()

    # タイトル画面はスタートするだけ（設定ラジオ・ファイルドロップ等は表に出ない）
    expect(page.locator("#tr-dropzone")).to_have_count(0)
    expect(page.locator(".tr-config-grid")).to_have_count(0)

    # 訓練スタート
    start_btn.click()
    expect(page.get_by_test_id("tr-card-arena")).to_be_visible()
    # デフォルトは手動進行なので自動タイマーピルは非表示
    expect(page.locator("#tr-auto-timer-pill")).to_be_hidden()

    # 最初のカードをめくる（デフォルト世帯単位）
    page.get_by_test_id("tr-next-card-btn").click()
    expect(page.get_by_test_id("tr-progress-counter")).to_contain_text("No.")


def test_simple_training_top_right_menu_json_server_and_settings(page, e2e_server):
    """簡易訓練ページ右上のメニューからJSON読込・サーバーデッキ読込・設定変更（1枚ずつ/自動タイマー）ができる."""
    # サーバーに1つデッキを保存しておく
    _load_demo_and_open_deck(page, e2e_server["base_url"])
    page.get_by_test_id("save-deck-name-input").fill("メニュー読込用デッキ")
    page.get_by_test_id("save-deck-btn").click()
    expect(page.get_by_test_id("deck-share-panel")).to_be_visible()

    # パラメータなしでシンプルページを開く
    page.goto(f"{e2e_server['base_url']}/training-simple.html")
    expect(page.get_by_test_id("tr-simple-title-view")).to_be_visible()
    expect(page.get_by_test_id("tr-simple-empty")).to_be_visible()

    # 右上のメニューボタン位置チェック（画面右上に配置されている）
    menu_btn = page.get_by_test_id("tr-simple-menu-btn")
    expect(menu_btn).to_be_visible()
    box = menu_btn.bounding_box()
    assert box is not None
    assert box["x"] > 600 and box["y"] < 80

    # メニューを開いてサーバーデッキを読み込む
    menu_btn.click()
    menu = page.get_by_test_id("tr-simple-menu")
    expect(menu).to_be_visible()
    srv_sel = menu.get_by_test_id("tr-menu-server-select")
    expect(srv_sel).to_contain_text("メニュー読込用デッキ")
    opt_val = srv_sel.locator("option").nth(1).get_attribute("value")
    srv_sel.select_option(opt_val)
    menu.get_by_test_id("tr-menu-load-server-btn").click()

    expect(page.get_by_test_id("tr-simple-deck-name")).to_contain_text("メニュー読込用デッキ")

    # メニューからJSONファイルを読み込むこともできる
    menu_btn.click()
    menu = page.get_by_test_id("tr-simple-menu")
    fixture_path = Path("tests/fixtures/sample_format2.json").resolve()
    menu.get_by_test_id("tr-menu-file-input").set_input_files(str(fixture_path))
    expect(page.get_by_test_id("tr-simple-deck-name")).to_contain_text("sample_format2")

    # 訓練スタートして実行中ステージ右上メニューから設定変更
    page.get_by_test_id("tr-start-training-btn").click()
    expect(page.get_by_test_id("tr-card-arena")).to_be_visible()

    stage_menu_btn = page.get_by_test_id("tr-simple-menu-btn")
    expect(stage_menu_btn).to_be_visible()
    stage_menu_btn.click()
    menu = page.get_by_test_id("tr-simple-menu")
    menu.get_by_test_id("tr-menu-unit-single").click()
    menu.get_by_test_id("tr-menu-mode-auto").click()
    menu.get_by_test_id("tr-simple-menu-close-btn").click()

    # ステージ上で自動タイマーピルが表示される
    expect(page.locator("#tr-auto-timer-pill")).to_be_visible()

    # メニューから手動に戻す
    stage_menu_btn.click()
    menu = page.get_by_test_id("tr-simple-menu")
    menu.get_by_test_id("tr-menu-mode-manual").click()
    menu.get_by_test_id("tr-simple-menu-close-btn").click()
    expect(page.locator("#tr-auto-timer-pill")).to_be_hidden()


def test_training_banner_omits_origin_timing_and_gallery_lightbox_views_all_household_cards(page, e2e_server):
    """カード表示中のバナーで不要な発生時期・避難元を省き大きく表示し、表示済み一覧の拡大表示で世帯全員のカードが見られる（PC・スマホ両対応）."""
    with tempfile.TemporaryDirectory() as tmpdir:
        deck_path = _make_household_and_event_deck(Path(tmpdir))

        # 1. PC表示での確認
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(f"{e2e_server['base_url']}/training-simple.html")
        page.get_by_test_id("tr-simple-menu-btn").click()
        page.get_by_test_id("tr-menu-file-input").set_input_files(str(deck_path))
        page.get_by_test_id("tr-start-training-btn").click()

        # イベントカード (No.1): 発生時期は非表示、その他情報（種別・No・イベント名）が大きく表示される
        page.get_by_test_id("tr-next-card-btn").click()
        ev_hdr = page.get_by_test_id("tr-event-header")
        expect(ev_hdr).to_be_visible()
        ev_text = ev_hdr.inner_text()
        assert "No.1:" in ev_text
        assert "発生時期" not in ev_text
        ev_font_px = page.evaluate(
            "parseFloat(getComputedStyle(document.querySelector('[data-testid=\"tr-event-header\"] .tr-stage-banner-title')).fontSize)"
        )
        assert ev_font_px >= 19.0

        # 世帯カード (No.2〜5, GRP-655 4名): 避難元は非表示、世帯ID・名前・枚目・人数/ペット数は表示される
        page.get_by_test_id("tr-next-card-btn").click()
        hh_hdr = page.get_by_test_id("tr-household-header")
        expect(hh_hdr).to_be_visible()
        hh_text = hh_hdr.inner_text()
        assert "GRP-655" in hh_text
        assert "1/4枚目" in hh_text
        assert "4名" in hh_text
        assert "避難元" not in hh_text
        hh_font_px = page.evaluate(
            "parseFloat(getComputedStyle(document.querySelector('[data-testid=\"tr-household-header\"] .tr-stage-banner-title')).fontSize)"
        )
        assert hh_font_px >= 19.0

        # 表示済み一覧 -> 世帯サムネイルクリック -> 拡大表示で先頭以外のメンバーカードも見られること
        page.locator("#tr-open-history-btn").click()
        expect(page.locator("#tr-gallery-modal")).to_be_visible()
        page.get_by_test_id("tr-history-item-2").click()

        lightbox = page.locator("#tr-lightbox-overlay")
        expect(lightbox).to_be_visible()
        expect(page.get_by_test_id("tr-lightbox-counter")).to_contain_text("1 / 4")
        expect(page.get_by_test_id("tr-lightbox-members")).to_be_visible()
        img_src_1 = page.locator("#tr-lightbox-img").get_attribute("src")

        # 「次のカード」ボタンで2人目へ切り替え
        page.get_by_test_id("tr-lightbox-next-btn").click()
        expect(page.get_by_test_id("tr-lightbox-counter")).to_contain_text("2 / 4")
        page.wait_for_timeout(150)
        img_src_2 = page.locator("#tr-lightbox-img").get_attribute("src")
        assert img_src_2 and img_src_2 != img_src_1

        # メンバーボタン直接クリックで3人目へ切り替え
        page.get_by_test_id("tr-lightbox-member-btn-2").click()
        expect(page.get_by_test_id("tr-lightbox-counter")).to_contain_text("3 / 4")
        page.wait_for_timeout(150)
        img_src_3 = page.locator("#tr-lightbox-img").get_attribute("src")
        assert img_src_3 and img_src_3 != img_src_1 and img_src_3 != img_src_2

        # 「このカードの位置に戻る」でNo.4（3人目）にフォーカスして戻る
        page.locator("#tr-lightbox-select-btn").click()
        expect(lightbox).to_be_hidden()
        expect(page.locator("#tr-card-slot-4")).to_have_class(
            __import__("re").compile(r"is-single-focused")
        )

        # 2. スマートフォン縦長画面 (390x664) 最適化チェック
        page.set_viewport_size({"width": 390, "height": 664})
        page.goto(f"{e2e_server['base_url']}/training-simple.html")
        expect(page.get_by_test_id("tr-simple-title-view")).to_be_visible()
        page.get_by_test_id("tr-simple-menu-btn").click()
        page.get_by_test_id("tr-menu-file-input").set_input_files(str(deck_path))
        page.get_by_test_id("tr-start-training-btn").click()

        # イベント & 世帯バナーが横はみ出しせず大きく表示される
        page.get_by_test_id("tr-next-card-btn").click()
        ev_mob_box = page.get_by_test_id("tr-event-header").bounding_box()
        assert ev_mob_box is not None and ev_mob_box["x"] >= 0 and ev_mob_box["x"] + ev_mob_box["width"] <= 392
        ev_mob_font = page.evaluate(
            "parseFloat(getComputedStyle(document.querySelector('[data-testid=\"tr-event-header\"] .tr-stage-banner-title')).fontSize)"
        )
        assert ev_mob_font >= 17.5

        page.get_by_test_id("tr-next-card-btn").click()
        hh_mob_hdr = page.get_by_test_id("tr-household-header")
        expect(hh_mob_hdr).to_be_visible()
        assert "避難元" not in hh_mob_hdr.inner_text()
        assert "GRP-655" in hh_mob_hdr.inner_text()

        # スマホでも表示済み一覧 -> 拡大ライトボックス内の複数人切替UIが画面内に収まり操作できること
        page.locator("#tr-open-history-btn").click()
        page.get_by_test_id("tr-history-item-2").click()
        expect(lightbox).to_be_visible()
        page.get_by_test_id("tr-lightbox-member-btn-3").click()
        expect(page.get_by_test_id("tr-lightbox-counter")).to_contain_text("4 / 4")

        for sel in (
            "#tr-lightbox-topbar",
            "#tr-lightbox-img",
            "#tr-lightbox-members",
            "#tr-lightbox-select-btn",
            "#tr-lightbox-close-btn",
        ):
            b = page.locator(sel).bounding_box()
            assert b is not None, f"{sel} missing bounding_box on mobile"
            assert b["y"] >= 0 and b["y"] + b["height"] <= 665, f"{sel} vertical overflow: {b}"
            assert b["x"] >= -1 and b["x"] + b["width"] <= 391, f"{sel} horizontal overflow: {b}"


def test_simple_training_static_github_pages_fallback_loads_basic_set(page, e2e_server):
    """GitHub Pages環境（/api/* が 404 の静的環境）でも ?deck=基本セット が data/cards_db.json から自動読込・開始できる."""
    page.route("**/api/**", lambda route: route.fulfill(status=404, body="Not Found"))
    encoded = urllib.parse.quote("基本セット")
    page.goto(f"{e2e_server['base_url']}/training-simple.html?deck={encoded}")

    expect(page.get_by_test_id("tr-simple-deck-name")).to_contain_text("基本セット")
    expect(page.get_by_test_id("stat-total-cards")).to_contain_text("200")
    page.get_by_test_id("tr-start-training-btn").click()
    page.get_by_test_id("tr-next-card-btn").click()
    expect(page.get_by_test_id("tr-progress-counter")).to_contain_text("1")


def test_mobile_card_position_and_size_invariant_across_banner_lengths(page, e2e_server, tmp_path: Path):
    """スマホ表示で裏返し・短いイベント・長いイベント・長い世帯名の全カードで表示位置(Y)・サイズ(W,H)が一定であることを検証."""
    cards_db = json.loads(Path("data/cards_db.json").read_text(encoding="utf-8"))
    ev_short = next(e for e in cards_db["cards_event"] if len(e.get("event_name", "")) <= 12)
    ev_long = max(cards_db["cards_event"], key=lambda e: len(e.get("event_name", "")))
    grp_long = max(cards_db["evacuee_groups"], key=lambda g: len(g.get("group_name", "")))
    mems_long = [m for m in cards_db["group_members"] if m["group_id"] == grp_long["group_id"]]
    assert len(mems_long) >= 2

    seq = [
        {"card_number": 1, "kind": "event", "original_id": ev_short["card_id"], "group_id": None},
        {"card_number": 2, "kind": "event", "original_id": ev_long["card_id"], "group_id": None},
    ] + [
        {
            "card_number": i + 3,
            "kind": "pet" if m.get("data_type") == "ペット" else "person",
            "original_id": m["member_id"],
            "group_id": grp_long["group_id"],
        }
        for i, m in enumerate(mems_long)
    ]
    deck_json = {
        "cards_event": [ev_short, ev_long],
        "evacuee_groups": [grp_long],
        "group_members": mems_long,
        "_web_deck_meta": {"card_sequence": seq},
    }
    deck_path = tmp_path / "invariant_size_deck.json"
    deck_path.write_text(json.dumps(deck_json, ensure_ascii=False), encoding="utf-8")

    for vp in ({"width": 390, "height": 800}, {"width": 390, "height": 664}):
        page.set_viewport_size(vp)
        page.goto(f"{e2e_server['base_url']}/training-simple.html")
        page.get_by_test_id("tr-simple-menu-btn").click()
        page.get_by_test_id("tr-menu-file-input").set_input_files(str(deck_path))
        page.get_by_test_id("tr-start-training-btn").click()

        page.wait_for_timeout(200)
        box_wait = page.locator("#tr-card-slot-1").bounding_box()

        # No.1 (短いイベント)
        page.get_by_test_id("tr-next-card-btn").click()
        page.wait_for_timeout(400)
        box_short_ev = page.locator("#tr-card-slot-1").bounding_box()

        # No.2 (長いイベント)
        page.get_by_test_id("tr-next-card-btn").click()
        page.wait_for_timeout(400)
        box_long_ev = page.locator("#tr-card-slot-2").bounding_box()

        # No.3 (最長世帯名 1枚目)
        page.get_by_test_id("tr-next-card-btn").click()
        page.wait_for_timeout(400)
        box_hh_1 = page.locator("#tr-card-slot-3").bounding_box()

        # No.4 (同世帯 2枚目)
        page.get_by_test_id("tr-next-card-btn").click()
        page.wait_for_timeout(400)
        box_hh_2 = page.locator("#tr-card-slot-4").bounding_box()

        boxes = [box_wait, box_short_ev, box_long_ev, box_hh_1, box_hh_2]
        assert all(b is not None for b in boxes), f"Missing box on viewport {vp}: {boxes}"

        # Y位置・幅・高さがすべて一定（±1.5px以内）で、X中心も画面中央付近に揃うこと
        base = box_short_ev
        for idx, b in enumerate(boxes):
            assert abs(b["y"] - base["y"]) <= 1.5, f"Y shifted at step {idx} ({vp}): {b} vs {base}"
            assert abs(b["width"] - base["width"]) <= 1.5, f"Width changed at step {idx} ({vp}): {b} vs {base}"
            assert abs(b["height"] - base["height"]) <= 1.5, f"Height changed at step {idx} ({vp}): {b} vs {base}"
            cx = b["x"] + b["width"] / 2
            assert abs(cx - vp["width"] / 2) <= 25, f"Card not centered horizontally at step {idx} ({vp}): {b}"
            # バナーおよび下部バーと重ならないこと
            banner_row_box = page.locator(".tr-stage-banner-row").bounding_box()
            bottom_bar_box = page.locator(".tr-arena-bottombar").bounding_box()
            assert banner_row_box["y"] + banner_row_box["height"] <= b["y"] + 1
            assert b["y"] + b["height"] <= bottom_bar_box["y"] + 1
