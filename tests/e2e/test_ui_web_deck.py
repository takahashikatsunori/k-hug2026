"""Web版 デッキ構築・ダウンロードページ (/deck.html / index.html) の E2E テスト."""
from __future__ import annotations

from pathlib import Path
import pytest

pytestmark = pytest.mark.e2e


def test_web_deck_initial_load_and_saved_decks(page, e2e_server):
    """① Webページ起動時に data/cards_db.json を読み込み、世帯単位のスタック行とDBが表示される."""
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.evaluate("localStorage.clear()")
    page.reload()

    # ヘッダーのデッキ枚数バッジとワークスペースが表示される
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")
    total_text = page.locator("[data-testid='wd-hdr-total']").inner_text()
    assert "枚" in total_text
    assert total_text != "0枚"

    # デッキ内の最初の単位サムネイルに Canvas 生成された data:image/png がバインドされる
    first_img = page.locator("[data-testid='wd-deck-unit-list'] .wd-thumb-img").first
    page.wait_for_function(
        "el => el && el.src && el.src.startsWith('data:image/png')",
        arg=first_img.element_handle(),
    )

    # 世帯行には世帯概要 (.wd-hh-summary) が表示されている
    assert page.locator("[data-testid='wd-deck-unit-list'] .wd-hh-summary").count() > 0

    # ① 条件・初期提案タブへ切り替え
    page.locator("[data-testid='wd-step-conditions']").click()
    page.wait_for_selector("[data-testid='wd-conditions-panel']")

    # 条件を設定して初期デッキを提案
    page.locator("[data-testid='wd-disaster-select']").select_option("地震")
    page.locator("[data-testid='wd-date-input']").fill("2026-01-01")
    page.locator("[data-testid='wd-max-events']").fill("5")
    page.locator("[data-testid='wd-max-households']").fill("3")
    page.locator("[data-testid='wd-propose-bottom-btn']").click()

    # 自動的に②ワークスペースに戻り、イベント枚数が5枚・世帯数が3組になっている
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")
    assert page.locator("[data-testid='wd-hdr-events']").inner_text() == "5"
    assert page.locator("[data-testid='wd-hdr-households']").inner_text() == "3組"


def test_web_deck_pc_unit_reorder_jump_expand_and_undo(page, e2e_server):
    """② PC画面で世帯単位の並べ替え・番号指定ジャンプ・詳細展開・拡大・DBからの追加・Undoが動作する."""
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.evaluate("localStorage.clear()")
    page.reload()

    # 操作確認用デッキを作成
    page.locator("[data-testid='wd-step-conditions']").click()
    page.wait_for_selector("[data-testid='wd-conditions-panel']")
    page.locator("[data-testid='wd-max-events']").fill("4")
    page.locator("[data-testid='wd-max-households']").fill("3")
    page.locator("[data-testid='wd-propose-bottom-btn']").click()
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")

    unit_rows = page.locator("[data-testid='wd-deck-unit-list'] > .wd-unit-row")
    initial_units = unit_rows.count()
    assert initial_units == 7

    first_key = unit_rows.nth(0).get_attribute("data-unit-key")
    second_key = unit_rows.nth(1).get_attribute("data-unit-key")

    # 1単位目の「▼ (step-down)」ボタンで 2単位目と入れ替わる
    unit_rows.nth(0).locator("[data-action='step-down']").click()
    assert unit_rows.nth(0).get_attribute("data-unit-key") == second_key
    assert unit_rows.nth(1).get_attribute("data-unit-key") == first_key

    # Undo で元の順序に戻る
    page.locator("[data-testid='wd-undo-btn']").click()
    assert unit_rows.nth(0).get_attribute("data-unit-key") == first_key

    # 番号指定ジャンプ (No. 入力 → ボタン) で先頭の単位を一気に後ろへ移動
    unit_rows.nth(0).locator(".wd-jump-input").fill("99")
    unit_rows.nth(0).locator("[data-action='jump']").click()
    assert unit_rows.nth(initial_units - 1).get_attribute("data-unit-key") == first_key

    # 行本体をクリックすると詳細ドロワー (.wd-unit-expand) が展開される
    unit_rows.nth(0).locator(".wd-unit-body").click()
    page.wait_for_selector("[data-testid='wd-unit-expand']")
    assert page.locator("[data-testid='wd-unit-expand']").is_visible()

    # デッキから1単位外す
    unit_rows.nth(0).locator("[data-action='remove']").click()
    assert unit_rows.count() == initial_units - 1

    # DBペインから未採用単位を1つデッキに追加する
    db_first_row = page.locator("[data-testid='wd-db-unit-list'] > .wd-unit-row").first
    added_key = db_first_row.get_attribute("data-unit-key")
    db_first_row.locator("[data-action='add']").click()
    assert unit_rows.count() == initial_units
    assert page.locator(f"[data-testid='wd-deck-unit-{added_key}']").count() == 1


def test_web_deck_smartphone_viewport_navigation_and_operations(page, e2e_server):
    """② スマホ画面 (390x844) でボトムナビ切替・DBから世帯/イベント単位追加が快適に動作する."""
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.evaluate("localStorage.clear()")
    page.reload()

    page.wait_for_selector("[data-testid='wd-mobile-bottom-nav']")
    assert page.locator("[data-testid='wd-mobile-bottom-nav']").is_visible()

    # 追加位置を「先頭 (No.1〜)」に設定
    page.locator("[data-testid='wd-insert-target-select']").select_option("start")

    # スマホで「②DBから追加」タブをタップ
    page.locator("[data-testid='wd-mob-nav-db']").click()
    page.wait_for_selector("[data-testid='wd-pane-db']")
    assert page.locator("[data-testid='wd-pane-db']").is_visible()

    # DBから最初の未採用単位を追加
    first_db_row = page.locator("[data-testid='wd-db-unit-list'] > .wd-unit-row").first
    target_unit_key = first_db_row.get_attribute("data-unit-key")
    first_db_row.locator("[data-action='add']").click()

    # 「②デッキ編集」タブに切り替えて先頭にその単位が追加されていることを確認
    page.locator("[data-testid='wd-mob-nav-deck']").click()
    page.wait_for_selector("[data-testid='wd-pane-deck']")
    first_deck_row = page.locator("[data-testid='wd-deck-unit-list'] > .wd-unit-row").first
    assert first_deck_row.get_attribute("data-unit-key") == target_unit_key


def test_web_deck_training_view_fixed_card_position_and_household_grouping(page, e2e_server):
    """③ 閲覧モードで世帯まとめ表示(横スクロール対応)とカード画像Y座標の固定、訓練ポイント切替が動作する."""
    import re
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")

    # ③ 閲覧モードを起動
    page.locator("[data-testid='wd-open-training-btn']").click()
    page.wait_for_selector("[data-testid='training-view']")

    # 初期状態では訓練ポイントボックスは非表示
    tp_box = page.locator("[data-testid='training-point-content']")
    assert tp_box.count() == 0

    # 訓練ポイントボタンで表示ON
    page.locator("[data-testid='training-point-toggle-btn']").click()
    assert tp_box.is_visible()

    # 世帯まとめ表示がデフォルトで有効
    group_chk = page.locator("#training-group-toggle-chk")
    assert group_chk.is_checked()

    # 「カード切替時も常に表示」をONにして複数枚めくり、世帯スライドで横スクロールコンテナが存在することを確認
    page.locator("[data-testid='training-point-always-chk']").check()
    found_hh_scroll = False
    for step in range(2, 8):
        page.locator("[data-testid='training-next-btn']").click()
        counter_text = page.locator("[data-testid='training-counter']").inner_text()
        assert re.search(r"^\d+(?:〜\d+)? / ", counter_text)
        if page.locator(".training-household-scroll").count() > 0:
            found_hh_scroll = True
            # 世帯メンバーカードが複数横並びになっていることを確認
            assert page.locator(".training-hh-member-col").count() >= 1
            break
    assert found_hh_scroll

    # 「世帯まとめて表示」チェックを外すと1枚ずつの表示になり、カード画像の見た目Y位置が固定されていることを確認
    group_chk.uncheck()
    stage_wrap = page.locator(".training-rendered-card-wrap")
    box_1 = stage_wrap.bounding_box()
    assert box_1 is not None

    for _ in range(3):
        prev_text = page.locator("[data-testid='training-counter']").inner_text()
        prev_num = int(prev_text.split(" / ")[0])
        page.locator("[data-testid='training-next-btn']").click()
        next_text = page.locator("[data-testid='training-counter']").inner_text()
        next_num = int(next_text.split(" / ")[0])
        assert next_num == prev_num + 1

        box_n = stage_wrap.bounding_box()
        assert box_n is not None
        assert abs(box_n["y"] - box_1["y"]) <= 1.5

    # 閲覧モードを終了
    page.locator("[data-testid='training-close-btn']").click()
    assert page.locator("[data-testid='training-view']").count() == 0


def test_web_deck_export_and_import_ledger_roundtrip(page, e2e_server, tmp_path: Path):
    """④・⑤ カード台帳(CSV)をエクスポートし、別状態からインポートしてデッキを完全復元できる."""
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.evaluate("localStorage.clear()")
    page.reload()

    # 特定枚数のデッキを作成
    page.locator("[data-testid='wd-step-conditions']").click()
    page.wait_for_selector("[data-testid='wd-conditions-panel']")
    page.locator("[data-testid='wd-max-events']").fill("4")
    page.locator("[data-testid='wd-max-households']").fill("2")
    page.locator("[data-testid='wd-propose-bottom-btn']").click()
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")

    expected_unit_keys = page.evaluate(
        "() => Array.from(document.querySelectorAll('[data-testid=\"wd-deck-unit-list\"] > .wd-unit-row')).map(el => el.dataset.unitKey)"
    )
    assert len(expected_unit_keys) == 6

    # ④ 出力・保存タブへ移動して 11列カード台帳CSVをダウンロード
    page.locator("[data-testid='wd-step-export']").click()
    page.wait_for_selector("[data-testid='wd-export-section']")

    with page.expect_download() as dl_info:
        page.locator("[data-testid='wd-dl-csv-btn']").click()
    download = dl_info.value
    csv_path = tmp_path / "exported_ledger.csv"
    download.save_as(str(csv_path))
    csv_content = csv_path.read_text(encoding="utf-8-sig")
    assert "カード番号,種別,氏名/イベント名" in csv_content

    # デッキを一度全解除する
    page.locator("[data-testid='wd-step-workspace']").click()
    page.wait_for_selector("[data-testid='wd-clear-deck-btn']")
    page.locator("[data-testid='wd-clear-deck-btn']").click()
    assert page.locator("[data-testid='wd-hdr-total']").inner_text() == "0枚"

    # ⑤ エクスポートしたCSV台帳をインポートして続きから再開
    page.locator("[data-testid='wd-header-import-btn']").click()
    page.wait_for_selector("[data-testid='wd-import-modal']")
    page.locator("[data-testid='wd-modal-file-input']").set_input_files(str(csv_path))

    # ワークスペースに復元された単位順序が一致することを確認
    page.wait_for_selector("[data-testid='wd-deck-unit-list'] > .wd-unit-row")
    restored_unit_keys = page.evaluate(
        "() => Array.from(document.querySelectorAll('[data-testid=\"wd-deck-unit-list\"] > .wd-unit-row')).map(el => el.dataset.unitKey)"
    )
    assert restored_unit_keys == expected_unit_keys


def test_web_deck_batch_origin_replace(page, e2e_server, tmp_path: Path):
    """避難元の町丁目を一括変更モーダルで内訳が表示され、置換後の町丁目がエクスポート/インポート後も完全保持される."""
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")

    # 初期提案で世帯カードを含むデッキを作成
    page.locator("[data-testid='wd-step-conditions']").click()
    page.wait_for_selector("[data-testid='wd-conditions-panel']")
    page.locator("[data-testid='wd-max-events']").fill("3")
    page.locator("[data-testid='wd-max-households']").fill("3")
    page.locator("[data-testid='wd-propose-bottom-btn']").click()
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")

    # 「📍 避難元の町丁目を一括変更」ボタンをクリック
    page.locator("[data-testid='wd-batch-origin-btn']").click()
    page.wait_for_selector("[data-testid='wd-batch-origin-modal']")

    # 内訳テーブルに行が存在し、町丁目名と人数・世帯数が表示されている
    origin_rows = page.locator(".wd-origin-row")
    assert origin_rows.count() > 0

    first_row = origin_rows.first
    orig_from = first_row.get_attribute("data-orig-from")
    assert orig_from is not None and len(orig_from) > 0

    # 1つ目の町丁目を「小川東町１丁目」に変更する
    select_box = first_row.locator(".wd-batch-town-select")
    select_box.select_option("小川東町１丁目")

    # 「💾 避難元の変更をデッキに適用する」をクリック
    page.locator("[data-testid='wd-origin-apply-btn']").click()

    # モーダルが閉じる
    page.wait_for_selector("[data-testid='wd-batch-origin-modal']", state="detached")

    # デッキ内の世帯行の概要またはカードデータに「小川東町１丁目」が反映されていることを確認
    deck_text = page.locator("[data-testid='wd-deck-unit-list']").inner_text()
    assert "小川東町１丁目" in deck_text

    # ④ 出力・保存タブへ移動してデッキJSONをダウンロード
    page.locator("[data-testid='wd-step-export']").click()
    page.wait_for_selector("[data-testid='wd-dl-json-btn']")
    with page.expect_download() as dl_info:
        page.locator("[data-testid='wd-dl-json-btn']").click()
    download = dl_info.value
    deck_json_path = tmp_path / "origin_replaced_deck.json"
    download.save_as(str(deck_json_path))

    # デッキを一度全解除
    page.locator("[data-testid='wd-step-workspace']").click()
    page.wait_for_selector("[data-testid='wd-clear-deck-btn']")
    page.locator("[data-testid='wd-clear-deck-btn']").click()
    assert page.locator("[data-testid='wd-hdr-total']").inner_text() == "0枚"

    # ⑤ エクスポートしたデッキJSONをインポート
    page.locator("[data-testid='wd-header-import-btn']").click()
    page.wait_for_selector("[data-testid='wd-import-modal']")
    page.locator("[data-testid='wd-modal-file-input']").set_input_files(str(deck_json_path))

    # インポート後も「小川東町１丁目」が保持されていることを確認
    page.wait_for_selector("[data-testid='wd-deck-unit-list'] > .wd-unit-row")
    restored_deck_text = page.locator("[data-testid='wd-deck-unit-list']").inner_text()
    assert "小川東町１丁目" in restored_deck_text


def test_web_deck_group_header_uses_deck_counts_on_single_member_remove_and_add(page, e2e_server):
    """Webデッキで世帯の一部メンバーを抜き差しすると、デッキ側人数に合わせて『○名中 ○番目』が更新されDB側画像と区別される."""
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(f"{e2e_server['base_url']}/deck.html")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector("[data-testid='wd-workspace-toolbar']")

    # デッキ内の複数名世帯を探して展開する
    hh_rows = page.locator("[data-testid='wd-deck-unit-list'] > .wd-unit-row[data-unit-key^='G:']")
    target_row = None
    target_key = None
    for i in range(hh_rows.count()):
        r = hh_rows.nth(i)
        r.locator(".wd-unit-body").click()
        if r.locator("[data-single-remove]").count() >= 2:
            target_row = r
            target_key = r.get_attribute("data-unit-key")
            break
    assert target_row is not None and target_key is not None

    # 1人外す前の先頭メンバー展開画像を待つ
    first_img = target_row.locator(".wd-expand-img").first
    page.wait_for_function(
        "el => el && el.src && el.src.startsWith('data:image/png')",
        arg=first_img.element_handle(),
    )
    img_before_src = first_img.get_attribute("src")

    # 2番目のメンバーだけデッキから外す
    target_row.locator("[data-single-remove]").nth(1).click()

    # 外した後のデッキ側先頭メンバー画像（総人数が1人減ったため画像が変わる）
    updated_row = page.locator(f"[data-testid='wd-deck-unit-list'] > .wd-unit-row[data-unit-key='{target_key}']")
    updated_first_img = updated_row.locator(".wd-expand-img").first
    page.wait_for_function(
        "([el, prev]) => el && el.src && el.src.startsWith('data:image/png') && el.src !== prev",
        arg=[updated_first_img.element_handle(), img_before_src],
    )
    img_after_src = updated_first_img.get_attribute("src")
    assert img_after_src != img_before_src

    # 上部ヘッダピル領域 (x=400..555, y=84..126) でもデッキ更新後にピクセルが変化していることを確認
    diff = page.evaluate(
        """async ([srcA, srcB]) => {
            const load = (u) => new Promise((res) => {
                const im = new Image();
                im.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = im.width; c.height = im.height;
                    const x = c.getContext('2d');
                    x.drawImage(im, 0, 0);
                    res(x.getImageData(400, 84, 155, 42).data);
                };
                im.src = u;
            });
            const a = await load(srcA);
            const b = await load(srcB);
            let cnt = 0;
            for (let i = 0; i < a.length; i += 4) {
                if (Math.abs(a[i] - b[i]) > 10 || Math.abs(a[i + 1] - b[i + 1]) > 10) cnt++;
            }
            return cnt;
        }""",
        [img_before_src, img_after_src],
    )
    assert diff > 20

    # サムネイル拡大モーダルから外したメンバーをデッキへ戻すと、元の総人数のカード画像に戻る
    updated_row.locator(".wd-unit-thumb").click()
    page.wait_for_selector("[data-testid='wd-household-zoom-modal'] [data-zoom-add]")
    page.locator("[data-testid='wd-household-zoom-modal'] [data-zoom-add]").first.click()
    page.wait_for_selector("[data-testid='wd-household-zoom-modal']", state="detached")

    restored_row = page.locator(f"[data-testid='wd-deck-unit-list'] > .wd-unit-row[data-unit-key='{target_key}']")
    restored_img = restored_row.locator(".wd-expand-img").first
    page.wait_for_function(
        "([el, expected]) => el && el.src === expected",
        arg=[restored_img.element_handle(), img_before_src],
    )

