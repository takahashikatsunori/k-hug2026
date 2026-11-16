"""マルチユーザーHUG台紙配置（admin.html / coop.html）のE2Eテスト."""

from __future__ import annotations

from pathlib import Path
from playwright.sync_api import expect


def test_coop_admin_and_multi_member_realtime_sync_and_qr_pdf(context, e2e_server, tmp_path: Path):
    """管理者1タブ＋メンバー2タブで、部屋作成・QR URL参加・スマホレイアウト・ドラッグ配置・戻し通知・進行支援・履歴管理・持ち帰りPDFが一貫動作する."""
    errors: list[str] = []

    admin_page = context.new_page()
    admin_page.set_viewport_size({"width": 1280, "height": 860})
    admin_page.on("pageerror", lambda err: errors.append(f"admin pageerror: {err}"))
    admin_page.on(
        "console",
        lambda m: errors.append(f"admin console {m.type}: {m.text}") if m.type == "error" else None,
    )

    admin_page.goto(f"{e2e_server['base_url']}/admin.html?localSync=1")
    expect(admin_page.get_by_test_id("admin-setup")).to_be_visible()

    # 任意サイズ(10x)を設定して開始
    admin_page.get_by_test_id("ad-size-custom").click()
    mult_input = admin_page.get_by_test_id("ad-custom-mult")
    mult_input.fill("10")
    mult_input.dispatch_event("change")
    expect(admin_page.get_by_test_id("ad-create-btn")).to_be_enabled(timeout=10000)
    admin_page.get_by_test_id("ad-create-btn").click()

    expect(admin_page.locator("#ad-console")).to_be_visible(timeout=15000)
    expect(admin_page.locator("#ad-mon-canvas")).to_have_attribute("data-mm-width", "11890")
    expect(admin_page.locator("#ad-mon-canvas")).to_have_attribute("data-mm-height", "8410")

    # 1はん の参加用QRモーダルからメンバー直リンクURLを取得
    admin_page.get_by_test_id("ad-qr-join-g1").click()
    join_url = admin_page.get_by_test_id("ad-qr-url").input_value()
    assert "coop.html?room=" in join_url and "group=g1" in join_url
    admin_page.locator(".co-modal-backdrop [data-act='close']").click()

    # メンバー1（スマホ幅390px・誰でもモード）とメンバー2（PC幅・一般モードへ切替）がニックネームのみで参加
    m1 = context.new_page()
    m1.set_viewport_size({"width": 390, "height": 844})
    m1.on("pageerror", lambda err: errors.append(f"m1 pageerror: {err}"))
    m1.goto(join_url)
    expect(m1.get_by_test_id("coop-preset-group")).to_contain_text("1はん")
    m1.get_by_test_id("co-nick-input").fill("たろう")
    m1.get_by_test_id("co-join-btn").click()
    expect(m1.get_by_test_id("coop-play-view")).to_be_visible(timeout=15000)

    # メッセージ未送信・タイマー未起動時はバナー・タイマーともに非表示であり、スマホヘッダーが1行に収まっていること
    expect(m1.get_by_test_id("coop-banner")).to_be_hidden()
    expect(m1.locator("#co-timer-badge")).to_be_hidden()
    topbar_box = m1.locator(".co-topbar").bounding_box()
    assert topbar_box is not None and topbar_box["height"] <= 62

    m2 = context.new_page()
    m2.set_viewport_size({"width": 1024, "height": 768})
    m2.on("pageerror", lambda err: errors.append(f"m2 pageerror: {err}"))
    m2.goto(join_url)
    m2.get_by_test_id("co-lang-toggle").click()  # 一般モードへ切替
    m2.get_by_test_id("co-nick-input").fill("はなこ")
    m2.get_by_test_id("co-join-btn").click()
    expect(m2.get_by_test_id("coop-play-view")).to_be_visible(timeout=15000)
    expect(m2.locator(".co-hand-label")).to_contain_text("手札")
    expect(m1.locator(".co-hand-label")).to_contain_text("てふだ")

    # 管理者が「1枚配る」＋「1世帯まとめて配る」＋ メッセージ ＋ タイマーを実行
    admin_page.get_by_test_id("ad-deal-one").click()
    admin_page.get_by_test_id("ad-deal-household").click()
    admin_page.get_by_test_id("ad-msg-input").fill("そうだんタイム！")
    admin_page.get_by_test_id("ad-msg-send").click()
    admin_page.locator("[data-timer='3']").click()

    # メンバー双方の手札・バナー・タイマーがリアルタイム同期される
    expect(m1.get_by_test_id("coop-banner")).to_be_visible()
    expect(m1.get_by_test_id("coop-banner")).to_contain_text("そうだんタイム！")
    expect(m2.get_by_test_id("coop-banner")).to_contain_text("そうだんタイム！")
    expect(m1.locator("#co-timer-badge")).to_be_visible()
    expect(m1.get_by_test_id("coop-hand-count")).not_to_have_text("0")
    expect(m2.get_by_test_id("coop-hand-count")).not_to_have_text("0")

    # 管理者で「消去」を押すとメンバー画面のメッセージバナーが確実に非表示になること
    admin_page.locator("#ad-msg-clear").click()
    expect(m1.get_by_test_id("coop-banner")).to_be_hidden(timeout=5000)
    expect(m2.get_by_test_id("coop-banner")).to_be_hidden(timeout=5000)

    # メンバー1が手札の最初のカード（No.0）を台紙ステージへ直接ドラッグ＆ドロップ配置
    first_hand_card = m1.locator("#co-hand .co-hand-card").first
    hc_box = first_hand_card.bounding_box()
    st_box = m1.locator("#co-stage").bounding_box()
    assert hc_box is not None and st_box is not None
    m1.mouse.move(hc_box["x"] + hc_box["width"] / 2, hc_box["y"] + hc_box["height"] / 2)
    m1.mouse.down()
    m1.mouse.move(st_box["x"] + st_box["width"] / 2, st_box["y"] + st_box["height"] / 2, steps=10)
    m1.mouse.up()

    # メンバー1・メンバー2・管理者ライブモニターに即座に配置反映され、管理者側バッジにも「さん」が付くこと
    expect(m1.get_by_test_id("coop-placed-card-0")).to_be_visible(timeout=10000)
    expect(m2.get_by_test_id("coop-placed-card-0")).to_be_visible(timeout=10000)
    mon_card = admin_page.locator("#ad-mon-cards [data-testid='coop-placed-card-0']")
    expect(mon_card).to_be_visible(timeout=10000)
    expect(mon_card.locator(".coop-card-badge")).to_have_text("たろうさん")

    # クラスタ丸ボタン(1)をタップしてカード周辺へ拡大し、「おおきくみる」時にカードNoや名前のテキスト表示がないこと
    m1.get_by_test_id("bd-cluster").first.click()
    m1.wait_for_timeout(450)
    m1.get_by_test_id("coop-placed-card-0").click()
    expect(m1.locator("#co-selbar")).to_be_visible()
    expect(m1.locator("#co-sel-label")).to_have_count(0)
    m1.locator("#co-sel-zoom").click()
    preview = m1.get_by_test_id("coop-preview-dialog")
    expect(preview).to_be_visible()
    expect(preview.locator(".co-modal-title")).to_have_count(0)
    preview.locator("[data-act='close']").click()

    # カードを手札に戻すと「てふだにもどされたよ」トーストが表示され（新規配布トーストではないこと）、同期される
    m1.locator("#co-sel-return").click()
    expect(m1.locator("#co-toast-wrap")).to_contain_text("てふだに もどされたよ")
    expect(m1.get_by_test_id("coop-placed-card-0")).to_have_count(0)
    expect(m2.get_by_test_id("coop-placed-card-0")).to_have_count(0)

    # 再度手札タップから中央配置してPDF確認
    m1.get_by_test_id("coop-hand-card-0").click()
    m1.get_by_test_id("coop-place-center").click()
    expect(m1.get_by_test_id("coop-placed-card-0")).to_be_visible(timeout=10000)

    # 持ち帰りPDF QRのURLを開いてPDFダウンロードが成功すること
    admin_page.get_by_test_id("ad-qr-pdf-g1").click()
    pdf_url = admin_page.get_by_test_id("ad-qr-url").input_value()
    assert "action=pdf" in pdf_url
    admin_page.locator(".co-modal-backdrop [data-act='close']").click()

    pdf_page = context.new_page()
    pdf_page.on("pageerror", lambda err: errors.append(f"pdf pageerror: {err}"))
    pdf_page.goto(pdf_url)
    expect(pdf_page.get_by_test_id("coop-pdf-view")).to_be_visible()
    with pdf_page.expect_download(timeout=20000) as dl_info:
        pdf_page.get_by_test_id("co-dl-pdf-btn").click()
    dl = dl_info.value
    out_pdf = tmp_path / dl.suggested_filename
    dl.save_as(str(out_pdf))
    assert out_pdf.read_bytes().startswith(b"%PDF-")

    # 管理者画面：履歴から前の訓練に戻れる＆履歴削除ができること
    admin_page.get_by_test_id("ad-new-room-btn").click()
    expect(admin_page.get_by_test_id("ad-history-card")).to_be_visible()
    admin_page.locator("[data-open-room]").first.click()
    expect(admin_page.locator("#ad-console")).to_be_visible(timeout=10000)
    expect(admin_page.locator("#ad-mon-cards [data-testid='coop-placed-card-0']")).to_be_visible(
        timeout=10000
    )

    # コンソールの履歴モーダルから削除
    admin_page.get_by_test_id("ad-history-btn").click()
    expect(admin_page.get_by_test_id("ad-history-modal")).to_be_visible()
    admin_page.locator("[data-del-room]").first.click()
    expect(admin_page.get_by_test_id("admin-setup")).to_be_visible()

    assert errors == []
