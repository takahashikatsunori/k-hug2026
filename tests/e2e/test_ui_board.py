"""台紙配置シミュレーション (/board.html) E2E テスト."""
from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e


def _build_small_board_deck(tmp_dir: Path) -> Path:
    """イベント2枚＋避難者世帯2組を含む小規模デッキJSONを作成する."""
    cards_db = json.loads(Path("data/cards_db.json").read_text(encoding="utf-8"))
    events = cards_db["cards_event"][:2]
    grp1 = cards_db["evacuee_groups"][0]
    grp2 = cards_db["evacuee_groups"][1]
    mems1 = [m for m in cards_db["group_members"] if m["group_id"] == grp1["group_id"]]
    mems2 = [m for m in cards_db["group_members"] if m["group_id"] == grp2["group_id"]]

    seq = []
    cno = 1
    seq.append({"card_number": cno, "kind": "event", "original_id": events[0]["card_id"], "group_id": None})
    cno += 1
    for m in mems1:
        seq.append(
            {
                "card_number": cno,
                "kind": "pet" if m.get("data_type") == "ペット" else "person",
                "original_id": m["member_id"],
                "group_id": grp1["group_id"],
            }
        )
        cno += 1
    seq.append({"card_number": cno, "kind": "event", "original_id": events[1]["card_id"], "group_id": None})
    cno += 1
    for m in mems2:
        seq.append(
            {
                "card_number": cno,
                "kind": "pet" if m.get("data_type") == "ペット" else "person",
                "original_id": m["member_id"],
                "group_id": grp2["group_id"],
            }
        )
        cno += 1

    deck_json = {
        "cards_event": events,
        "evacuee_groups": [grp1, grp2],
        "group_members": mems1 + mems2,
        "_web_deck_meta": {"card_sequence": seq},
    }
    p = tmp_dir / "board_test_deck.json"
    p.write_text(json.dumps(deck_json, ensure_ascii=False), encoding="utf-8")
    return p


def _assert_no_horizontal_overflow(page) -> None:
    ok = page.evaluate(
        "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
    )
    assert ok is True


def test_board_setup_smartphone_and_url_params_with_relative_scale(page, e2e_server):
    """スマホ(390x844)でURLパラメータ直リンクが開け、5小トリアージ図と縦横4倍/8倍/16倍の相対サイズ比が正しく適用される."""
    page.set_viewport_size({"width": 390, "height": 844})
    encoded_deck = urllib.parse.quote("基本セット")
    page.goto(f"{e2e_server['base_url']}/board.html?deck={encoded_deck}&size=4x")

    setup_view = page.get_by_test_id("bd-setup-view")
    expect(setup_view).to_be_visible()
    expect(page.get_by_test_id("bd-deck-summary")).to_contain_text("基本セット")
    expect(page.get_by_test_id("bd-board-opt-goshou_triage_20260716")).to_have_class(
        re.compile(r"\bactive\b")
    )
    expect(page.get_by_test_id("bd-size-4x")).to_have_class(re.compile(r"\bactive\b"))

    # サムネイルキャンバスが白紙でない（描画完了）ことを確認
    thumb_canvas = page.locator('[data-testid="bd-board-opt-goshou_triage_20260716"] canvas')
    expect(thumb_canvas).to_have_class(re.compile(r"\bis-ready\b"))
    has_ink = thumb_canvas.evaluate(
        """(c) => {
            const ctx = c.getContext('2d');
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] > 0 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) return true;
            }
            return false;
        }"""
    )
    assert has_ink is True

    _assert_no_horizontal_overflow(page)

    # 縦横16倍 に切り替えて開始し、台紙(19024x13456mm)とカード(55x91mm)の実寸比を検証
    page.get_by_test_id("bd-size-16x").click()
    expect(page.get_by_test_id("bd-size-16x")).to_have_class(re.compile(r"\bactive\b"))
    page.get_by_test_id("bd-start-btn").click()

    play_view = page.get_by_test_id("bd-play-view")
    expect(play_view).to_be_visible()
    _assert_no_horizontal_overflow(page)

    # 台紙描画完了待ち
    expect(page.locator("#bd-board-loading")).to_have_count(0, timeout=15000)

    sheet = page.locator("#bd-base-canvas")
    assert sheet.get_attribute("data-mm-width") == "19024"
    assert sheet.get_attribute("data-mm-height") == "13456"

    # スマホ幅で1枚引いてプレビューから配置（配置時は自動でカード周辺にフォーカスズームされる）
    page.get_by_test_id("bd-draw-btn").click()
    preview = page.get_by_test_id("bd-preview")
    expect(preview).to_be_visible()
    place_btn = preview.locator('[data-testid="bd-place-empty-btn"], [data-testid="bd-place-center-btn"]').first
    place_btn.click()
    expect(page.get_by_test_id("bd-progress")).to_contain_text("1/")

    stage = page.get_by_test_id("bd-stage")
    expect(stage).not_to_have_class(re.compile(r"\bis-cluster\b"))
    expect(page.locator("#bd-card-world .bd-card").first).to_be_visible()

    # カードの実寸ワールド座標幅・高さが 55x91 (mm) であり台紙(2378x1682)の約1/43幅であること
    card_mm = page.locator("#bd-card-world .bd-card").first.evaluate(
        "el => ({ w: parseFloat(getComputedStyle(el).width), h: parseFloat(getComputedStyle(el).height) })"
    )
    assert card_mm["w"] == 55
    assert card_mm["h"] == 91

    # 全体表示(⤢)へズームアウトするとスマホ画面(縦横16倍全体)では枚数丸ボタン(1)になり、タップで再びズームインする
    page.get_by_test_id("bd-zoom-fit").click()
    page.wait_for_timeout(420)
    expect(stage).to_have_class(re.compile(r"\bis-cluster\b"))

    cluster_btn = page.get_by_test_id("bd-cluster").first
    expect(cluster_btn).to_be_visible()
    expect(cluster_btn).to_have_text("1")
    cluster_btn.click()
    page.wait_for_timeout(450)
    expect(stage).not_to_have_class(re.compile(r"\bis-cluster\b"))
    expect(page.locator("#bd-card-world .bd-card").first).to_be_visible()


def test_board_draw_drag_overlap_cluster_undo_and_pdf_download(page, e2e_server, tmp_path: Path):
    """PCでカード1枚ずつドロー・ドラッグ配置・移動・重なり許可・クラスタ拡大・Undo・PDF出力が一貫動作する."""
    page.set_viewport_size({"width": 1280, "height": 800})
    deck_path = _build_small_board_deck(tmp_path)

    page.goto(f"{e2e_server['base_url']}/board.html")
    expect(page.get_by_test_id("bd-setup-view")).to_be_visible()

    # JSONファイル読込 + 規定の縦横8倍サイズ（9512x6728mm）で開始
    page.get_by_test_id("bd-json-input").set_input_files(str(deck_path))
    expect(page.get_by_test_id("bd-deck-summary")).to_contain_text("board_test_deck")
    expect(page.get_by_test_id("bd-size-8x")).to_have_class(re.compile(r"\bactive\b"))
    page.get_by_test_id("bd-start-btn").click()

    expect(page.get_by_test_id("bd-play-view")).to_be_visible()
    expect(page.locator("#bd-board-loading")).to_have_count(0, timeout=15000)

    sheet = page.locator("#bd-base-canvas")
    assert sheet.get_attribute("data-mm-width") == "9512"
    assert sheet.get_attribute("data-mm-height") == "6728"

    initial_remaining = int(page.get_by_test_id("bd-deck-count").inner_text())
    assert initial_remaining >= 4

    # 1枚目（イベントカード No.1）を引く → プレビュー自動表示 → 「空いている場所に置く」
    page.get_by_test_id("bd-draw-btn").click()
    expect(page.get_by_test_id("bd-deck-count")).to_have_text(str(initial_remaining - 1))
    preview = page.get_by_test_id("bd-preview")
    expect(preview).to_be_visible()
    preview.get_by_test_id("bd-place-empty-btn").click()
    expect(page.get_by_test_id("bd-card-1")).to_be_visible()
    expect(page.get_by_test_id("bd-progress")).to_contain_text(f"1/{initial_remaining}")

    # 2枚目（避難者カード No.2）を引く → 手札に残してから、手札からステージへドラッグ配置
    page.get_by_test_id("bd-draw-btn").click()
    preview = page.get_by_test_id("bd-preview")
    expect(preview).to_be_visible()
    preview.get_by_test_id("bd-preview-close-btn").click()
    expect(preview).not_to_be_visible()

    hand_card2 = page.get_by_test_id("bd-hand-card-2")
    expect(hand_card2).to_be_visible()
    hbox = hand_card2.bounding_box()
    stage_box = page.get_by_test_id("bd-stage").bounding_box()
    assert hbox is not None and stage_box is not None

    drop_x = stage_box["x"] + stage_box["width"] * 0.45
    drop_y = stage_box["y"] + stage_box["height"] * 0.45
    page.mouse.move(hbox["x"] + hbox["width"] / 2, hbox["y"] + hbox["height"] / 2)
    page.mouse.down()
    page.mouse.move(drop_x, drop_y, steps=12)
    page.mouse.up()

    card2 = page.get_by_test_id("bd-card-2")
    expect(card2).to_be_visible()
    expect(page.get_by_test_id("bd-progress")).to_contain_text(f"2/{initial_remaining}")

    # 3枚目を引いて「画面の中央に置く」→ その後 No.2 と重なる位置へドラッグ移動（重なり許可）
    page.get_by_test_id("bd-draw-btn").click()
    preview = page.get_by_test_id("bd-preview")
    expect(preview).to_be_visible()
    preview.get_by_test_id("bd-place-center-btn").click()
    card3 = page.get_by_test_id("bd-card-3")
    expect(card3).to_be_visible()

    c2_box = card2.bounding_box()
    c3_box = card3.bounding_box()
    assert c2_box is not None and c3_box is not None

    # No.3 を No.2 に一部重なる位置へ移動
    target_x = c2_box["x"] + c2_box["width"] * 0.4
    target_y = c2_box["y"] + c2_box["height"] * 0.4
    page.mouse.move(c3_box["x"] + c3_box["width"] / 2, c3_box["y"] + c3_box["height"] / 2)
    page.mouse.down()
    page.mouse.move(target_x, target_y, steps=10)
    page.mouse.up()

    c2_after = card2.bounding_box()
    c3_after = card3.bounding_box()
    assert c2_after is not None and c3_after is not None
    # 2枚が重なって存在していること
    overlap_x = min(c2_after["x"] + c2_after["width"], c3_after["x"] + c3_after["width"]) - max(
        c2_after["x"], c3_after["x"]
    )
    overlap_y = min(c2_after["y"] + c2_after["height"], c3_after["y"] + c3_after["height"]) - max(
        c2_after["y"], c3_after["y"]
    )
    assert overlap_x > 0 and overlap_y > 0

    # Undo で No.3 の移動を取り消してから再度前面へ・または手札に戻す確認
    page.get_by_test_id("bd-undo-btn").click()
    c3_undone = card3.bounding_box()
    assert c3_undone is not None
    assert abs(c3_undone["x"] - c3_box["x"]) < 3.0

    # 途中段階でPDFダウンロードができること
    with page.expect_download() as dl_mid:
        page.get_by_test_id("bd-pdf-btn").click()
    mid_download = dl_mid.value
    assert mid_download.suggested_filename.endswith(".pdf")
    mid_path = tmp_path / mid_download.suggested_filename
    mid_download.save_as(str(mid_path))
    pdf_bytes = mid_path.read_bytes()
    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 10000

    # ズームアウトしてカードが小さくなると枚数バブル(.bd-cluster)だけが表示される
    stage = page.get_by_test_id("bd-stage")
    for _ in range(3):
        if "is-cluster" in (stage.get_attribute("class") or ""):
            break
        page.get_by_test_id("bd-zoom-out").click()
        page.wait_for_timeout(320)

    expect(stage).to_have_class(re.compile(r"\bis-cluster\b"))
    assert card2.evaluate("el => getComputedStyle(el).display") == "none"

    clusters = page.get_by_test_id("bd-cluster")
    assert clusters.count() >= 1
    total_cluster_cards = sum(int(clusters.nth(i).inner_text()) for i in range(clusters.count()))
    assert total_cluster_cards == 3

    # 丸い枚数ボタンを押すとそれらのカードが収まるくらいにズームインし、カードが再表示される
    clusters.first.click()
    expect(stage).not_to_have_class(re.compile(r"\bis-cluster\b"))
    expect(card2).to_be_visible()

    # 配置済みカードを選択して「手札へ」戻せること
    card3.click()
    expect(page.get_by_test_id("bd-selbar")).to_be_visible()
    page.get_by_test_id("bd-sel-return").click()
    expect(page.get_by_test_id("bd-progress")).to_contain_text(f"2/{initial_remaining}")
    expect(page.get_by_test_id("bd-hand-card-3")).to_be_visible()


def test_board_custom_pdf_upload_and_github_pages_share_modal(page, e2e_server):
    """手元の台紙PDF追加およびDBツールの共有モーダルからGitHub Pages用board.html直リンクURLを取得できる."""
    # 1. 手元のPDF台紙追加
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(f"{e2e_server['base_url']}/board.html")
    expect(page.get_by_test_id("bd-setup-view")).to_be_visible()

    sample_pdf = Path("static/boards/goshou_triage_20260716.pdf").resolve()
    page.get_by_test_id("bd-pdf-upload-input").set_input_files(str(sample_pdf))
    expect(page.locator(".bd-board-opt.active")).to_contain_text("goshou_triage_20260716")

    # 2. DB管理ツールでデモ読込→保存→共有モーダルで台紙配置訓練URLへ切替
    page.goto(e2e_server["base_url"])
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")
    page.get_by_test_id("tab-deck").click()

    deck_name = "台紙共有テスト2026"
    page.get_by_test_id("save-deck-name-input").fill(deck_name)
    page.get_by_test_id("save-deck-btn").click()

    share_panel = page.get_by_test_id("deck-share-panel")
    expect(share_panel).to_be_visible()
    share_panel.get_by_test_id("switch-qr-board-btn").click()

    board_url = share_panel.get_by_test_id("deck-share-url-input").input_value()
    parsed = urllib.parse.urlparse(board_url)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
        "https://takahashikatsunori.github.io/k-hug2026/board.html"
    )
    assert urllib.parse.parse_qs(parsed.query).get("deck") == [deck_name]
    expect(share_panel.get_by_test_id("open-board-sim-link")).to_be_visible()


def test_board_static_github_pages_fallback_and_index_link(page, e2e_server):
    """GitHub Pages等の静的配信(/api/*が404)でもboard.html直リンクで五小rev5読込〜配置でき、index.htmlからも開ける."""
    page.set_viewport_size({"width": 1280, "height": 800})
    page.route("**/api/**", lambda route: route.fulfill(status=404, body="Not Found"))

    # index.html のヘッダーリンクから遷移できること
    page.goto(f"{e2e_server['base_url']}/deck.html")
    board_link = page.get_by_test_id("wd-header-board-btn")
    expect(board_link).to_be_visible()
    assert board_link.get_attribute("href") == "./board.html?source=local"

    # GitHub Pages 直リンク相当 (?deck=五小rev5)
    encoded_deck = urllib.parse.quote("五小rev5")
    page.goto(f"{e2e_server['base_url']}/board.html?deck={encoded_deck}")
    expect(page.get_by_test_id("bd-deck-summary")).to_contain_text("五小rev5")
    page.get_by_test_id("bd-start-btn").click()
    expect(page.get_by_test_id("bd-play-view")).to_be_visible()
    expect(page.locator("#bd-board-loading")).to_have_count(0, timeout=15000)

    # 1枚引いて配置できること
    page.get_by_test_id("bd-draw-btn").click()
    preview = page.get_by_test_id("bd-preview")
    expect(preview).to_be_visible()
    preview.locator('[data-testid="bd-place-empty-btn"], [data-testid="bd-place-center-btn"]').first.click()
    expect(page.get_by_test_id("bd-progress")).to_contain_text("1/")
