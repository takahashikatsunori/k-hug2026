"""Playwright E2E テスト: デッキ構築・休日自動入力・矛盾解決・並べ替え・再計算通知・出力 (UI-16〜20, UI-22)."""
from __future__ import annotations

import csv
import io
import json

from playwright.sync_api import expect
import pytest

pytestmark = pytest.mark.e2e


def _load_demo_and_open_deck(page, base_url: str) -> None:
    page.goto(base_url)
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")
    page.get_by_test_id("tab-deck").click()


def test_ui_16_date_picker_auto_populates_holiday_types_and_allows_manual_override(page, e2e_server):
    """UI-16: デッキ構築: 日付を選ぶと休日種別が自動で入り、手動で上書きできる → チップの状態が変わる."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    date_input = page.get_by_test_id("deck-date-input")
    date_input.fill("2026-05-03")
    date_input.dispatch_event("change")

    chip_weekend = page.get_by_test_id("multichip-deck-holiday_type-土日")
    chip_holiday = page.get_by_test_id("multichip-deck-holiday_type-祝日")
    chip_gw = page.get_by_test_id("multichip-deck-holiday_type-大型連休")
    chip_weekday = page.get_by_test_id("multichip-deck-holiday_type-平日")

    expect(chip_weekend).to_have_attribute("data-active", "true")
    expect(chip_holiday).to_have_attribute("data-active", "true")
    expect(chip_gw).to_have_attribute("data-active", "true")
    expect(chip_weekday).to_have_attribute("data-active", "false")

    # 手動で「平日」をON、「大型連休」をOFFに上書きできること
    chip_weekday.click()
    chip_gw.click()
    expect(chip_weekday).to_have_attribute("data-active", "true")
    expect(chip_gw).to_have_attribute("data-active", "false")


def test_ui_17_build_deck_s2_shows_41_cards_and_9_conflicts(page, e2e_server):
    """UI-17: S2 でデッキを構築する → 統計が 41枚。「進行度の矛盾 9件」のダイアログが出る."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("41枚")
    expect(page.get_by_test_id("conflict-count-badge")).to_have_text("進行度の矛盾 9件")


def test_ui_18_resolve_all_conflicts_phase_first(page, e2e_server):
    """UI-18: 矛盾のダイアログで「すべて進行度を優先」 → 矛盾0件になり、順番の一覧が更新される."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    expect(page.get_by_test_id("conflict-count-badge")).to_have_text("進行度の矛盾 9件")
    page.get_by_test_id("resolve-all-phase-first-btn").click()

    expect(page.get_by_test_id("conflict-count-badge")).to_have_text("進行度の矛盾 0件")
    # 進行度優先順 (OR-17) では GRP-009, GRP-010 (初日) が EV-008 (2日目) より前に来る
    unit_ids = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="deck-unit-list"] > li'))
            .map(li => li.dataset.unitId)"""
    )
    assert unit_ids.index("GRP-009") < unit_ids.index("GRP-010") < unit_ids.index("EV-008")


def test_ui_19_manual_reorder_buttons_and_prerequisite_violation_rejection(page, e2e_server):
    """UI-19: 手動で並べ替える（↑↓ボタンとドラッグ） → 順番が変わる。前提カードより前に置こうとすると拒否のメッセージが出る."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    # #2 (GRP-001) の「↑」ボタンを押して #1 (EV-001) と入れ替える
    page.get_by_test_id("unit-up-GRP-001").click()
    expect(page.get_by_test_id("unit-pos-GRP-001")).to_have_text("#1")
    expect(page.get_by_test_id("unit-pos-EV-001")).to_have_text("#2")

    # EV-002 (前提: EV-001) を EV-001 より前にドラッグ＆ドロップしようとすると拒否メッセージが出る
    ev002 = page.get_by_test_id("deck-unit-EV-002")
    grp001 = page.get_by_test_id("deck-unit-GRP-001")
    ev002.drag_to(grp001)

    err_box = page.get_by_test_id("deck-reorder-error")
    expect(err_box).to_be_visible()
    expect(err_box).to_contain_text("前提カード")


def test_ui_20_saved_deck_notifies_when_card_edited(page, e2e_server):
    """UI-20: デッキの条件を保存し、カードを編集してから開き直す → 「再計算しました／手動調整を再適用しますか？」の通知が出る."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    # 手動調整を1つ入れてからデッキ条件を保存
    page.get_by_test_id("unit-up-GRP-001").click()
    expect(page.get_by_test_id("unit-pos-GRP-001")).to_have_text("#1")

    page.get_by_test_id("save-deck-name-input").fill("保存テストデッキ")
    page.get_by_test_id("save-deck-btn").click()

    # 一覧に戻り EV-001 を編集して保存
    page.get_by_test_id("tab-list").click()
    page.get_by_test_id("card-EV-001").click()
    page.get_by_test_id("modal-edit-btn").click()
    page.get_by_test_id("input-event-event_name").fill("編集後のイベント名")
    page.get_by_test_id("save-event-btn").click()

    # 保存済みタブからデッキを開き直す
    page.get_by_test_id("tab-saved").click()
    page.locator(".open-saved-deck-btn").first.click()

    banner = page.get_by_test_id("deck-changed-banner")
    expect(banner).to_be_visible()
    expect(banner).to_contain_text("再計算しました")
    expect(page.get_by_test_id("reapply-saved-adjustments-btn")).to_be_visible()


def test_ui_22_download_deck_json_and_csv(page, e2e_server):
    """UI-22: デッキの JSON/CSV をダウンロードする → DE-14 / CS-12 の内容."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    with page.expect_download() as dl_json_info:
        page.get_by_test_id("export-deck-json-btn").click()
    dl_json = dl_json_info.value
    with open(dl_json.path(), "rb") as f:
        deck_json = json.loads(f.read().decode("utf-8"))
    assert len(deck_json["cards_event"]) == 20
    assert len(deck_json["evacuee_groups"]) == 10
    assert len(deck_json["group_members"]) == 21
    # DE-14: card_id と member_id が 1〜41 の連番に置換されていること
    all_nums = {int(e["card_id"]) for e in deck_json["cards_event"]} | {
        int(m["member_id"]) for m in deck_json["group_members"]
    }
    assert all_nums == set(range(1, 42))

    with page.expect_download() as dl_csv_info:
        page.get_by_test_id("export-deck-csv-btn").click()
    dl_csv = dl_csv_info.value
    with open(dl_csv.path(), "rb") as f:
        csv_bytes = f.read()
    assert csv_bytes.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8-sig"))))
    assert len(rows) == 42  # ヘッダ1 + 41枚
    assert [r[0] for r in rows[1:]] == [str(i) for i in range(1, 42)]


def test_ui_23_exclude_and_restore_units_in_deck_without_deleting_from_db(page, e2e_server):
    """UI-23: デッキ構築でカード/単位をデッキから除外・復帰でき、データベースの件数は変わらない."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("41枚")
    expect(page.get_by_test_id("hdr-count-events")).to_have_text("20")
    expect(page.get_by_test_id("hdr-count-households")).to_have_text("10")

    # 1. 一覧行の「✕ デッキから除外」ボタンで GRP-001 (2名) を除外
    page.get_by_test_id("unit-exclude-GRP-001").click()
    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("39枚")
    # ヘッダのDB件数はイベント20・世帯10のまま（DBからは削除されていない）
    expect(page.get_by_test_id("hdr-count-events")).to_have_text("20")
    expect(page.get_by_test_id("hdr-count-households")).to_have_text("10")
    expect(page.get_by_test_id("excluded-unit-GRP-001")).to_be_visible()

    # 2. デッキ単位（EV-003）をクリックして詳細モーダルを開くと、DB削除ボタンではなくデッキ除外ボタンが表示される
    page.get_by_test_id("deck-unit-EV-003").click()
    expect(page.get_by_test_id("modal-delete-btn")).to_have_count(0)
    exclude_btn = page.get_by_test_id("modal-deck-exclude-btn")
    expect(exclude_btn).to_be_visible()
    expect(exclude_btn).to_contain_text("このデッキから除外")
    exclude_btn.click()

    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("37枚")  # EV-003 + 前提連鎖EV-004
    expect(page.get_by_test_id("hdr-count-events")).to_have_text("20")

    # 3. 除外された単位リストの「＋ デッキに戻す」ボタンで EV-003 を戻す
    page.get_by_test_id("unit-restore-EV-003").click()
    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("39枚")

    # 4. 「手動除外をすべて戻す」で GRP-001 も戻す
    page.get_by_test_id("restore-all-excluded-btn").click()
    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("41枚")



def test_ui_saved_deck_load_delete_and_web_json_import(page, e2e_server, tmp_path: Path):
    """デッキ画面上で保存済みデッキの呼び出し・削除およびWebエクスポートJSONの取り込みが動作する."""
    _load_demo_and_open_deck(page, e2e_server["base_url"])

    # 1. デッキに名前を付けて保存
    save_input = page.get_by_test_id("save-deck-name-input")
    save_input.fill("地域防災訓練デッキA")
    page.get_by_test_id("save-deck-btn").click()

    # セレクトボックスに選択肢が自動反映される
    saved_select = page.get_by_test_id("deck-saved-list-select")
    expect(saved_select).to_contain_text("地域防災訓練デッキA")
    load_btn = page.get_by_test_id("load-saved-deck-btn")
    del_btn = page.get_by_test_id("delete-saved-deck-btn")
    expect(load_btn).to_be_enabled()
    expect(del_btn).to_be_enabled()

    # 2. 条件を変更して枚数を減らす (地震 -> 豪雨)
    disaster_select = page.get_by_test_id("deck-disaster-select")
    disaster_select.select_option("豪雨")
    # 枚数が変わる
    expect(page.get_by_test_id("deck-stat-total-cards")).not_to_have_text("41枚")

    # 3. 保存済みデッキから「地域防災訓練デッキA」を呼び出す
    saved_select.select_option(label=saved_select.locator("option").all_inner_texts()[-1])
    load_btn.click()
    expect(page.get_by_test_id("deck-stat-total-cards")).to_have_text("41枚")
    expect(disaster_select).to_have_value("地震")

    # 4. 保存済みデッキを削除する
    page.once("dialog", lambda dialog: dialog.accept())
    del_btn.click()
    expect(saved_select).not_to_contain_text("地域防災訓練デッキA")

    # 5. Webエクスポート形式のデッキJSONを作成してインポート
    web_json_content = {
        "cards_event": [{"card_id": "EV-001", "event_name": "地震発生"}],
        "evacuee_groups": [{"group_id": "GRP-001", "group_name": "山田家", "evacuation_origin": "小川東町１丁目"}],
        "group_members": [{"member_id": "M-001", "group_id": "GRP-001", "data_type": "人物", "evacuation_origin": "小川東町１丁目"}],
        "_web_deck_meta": {
            "version": "6.2",
            "conditions": {
                "disaster_type": "地震",
                "shelter": "小平第五小学校",
                "max_events": "2",
                "max_households": "2",
                "origin_overrides": {"GRP-001": "小川東町１丁目"}
            },
            "origin_overrides": {"GRP-001": "小川東町１丁目"},
            "card_sequence": [
                {"card_number": 1, "original_id": "EV-001", "kind": "event", "group_id": None},
                {"card_number": 2, "original_id": "M-001", "kind": "person", "group_id": "GRP-001", "evacuation_origin": "小川東町１丁目"}
            ]
        }
    }
    json_path = tmp_path / "web_exported_deck.json"
    json_path.write_text(json.dumps(web_json_content, ensure_ascii=False), encoding="utf-8")

    # input[type=file] にファイルをセット
    file_input = page.get_by_test_id("deck-json-file-input")
    file_input.set_input_files(str(json_path))

    # デッキが再構築され、保存名入力欄に「web_exported_deck」が提案される
    expect(save_input).to_have_value("web_exported_deck")
    expect(disaster_select).to_have_value("地震")

    # 避難者台帳ビューで町丁目「小川東町１丁目」が反映されていることを確認
    page.get_by_test_id("deck-submode-ledger").click()
    ledger_text = page.locator("#deck-ledger-section").inner_text()
    assert "小川東町１丁目" in ledger_text

    # この状態でデッキを保存
    page.get_by_test_id("save-deck-btn").click()
    expect(saved_select).to_contain_text("web_exported_deck")

    # 別の条件にしてから再呼び出ししても「小川東町１丁目」が残っていることを確認
    disaster_select.select_option("豪雨")
    saved_select.select_option(label=saved_select.locator("option").all_inner_texts()[-1])
    load_btn.click()
    page.get_by_test_id("deck-submode-ledger").click()
    restored_ledger = page.locator("#deck-ledger-section").inner_text()
    assert "小川東町１丁目" in restored_ledger
