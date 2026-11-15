"""スマホHUG訓練シミュレーター（小平第五小学校モデル・見取り図配置訓練） E2E テスト."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e


def _build_custom_test_deck(tmp_dir: Path) -> Path:
    """テスト用の世帯（高齢者・妊婦・ペット連れ・車いす）＋イベント（五小マンホールトイレ・感染症発生・救急搬送）デッキJSONを作成する."""
    cards_db = json.loads(Path("data/cards_db.json").read_text(encoding="utf-8"))

    # 1. ペット連れ世帯を探す
    pet_mem = next(m for m in cards_db["group_members"] if m.get("data_type") == "ペット")
    pet_gid = pet_mem["group_id"]
    grp_pet = next(g for g in cards_db["evacuee_groups"] if g["group_id"] == pet_gid)
    mems_pet = [m for m in cards_db["group_members"] if m["group_id"] == pet_gid]

    # 2. 車いす・要配慮者の世帯を探す (GRP-655 または最初に見つかる車いす世帯)
    grp_wheel = next(
        (
            g
            for g in cards_db["evacuee_groups"]
            if g["group_id"] != pet_gid
            and ("車いす" in (g.get("theme") or "") or g["group_id"] == "GRP-655")
        ),
        cards_db["evacuee_groups"][0],
    )
    mems_wheel = [m for m in cards_db["group_members"] if m["group_id"] == grp_wheel["group_id"]]

    # 3. 特徴的なイベントカードを抽出
    # - 五小マンホールトイレ設営 (EV-847 or EV-774)
    ev_toilet = next(
        (e for e in cards_db["cards_event"] if e["card_id"] in ("EV-847", "EV-774")),
        cards_db["cards_event"][0],
    )
    # - 感染症発症 (EV-879 or EV-880)
    ev_infection = next(
        (e for e in cards_db["cards_event"] if e["card_id"] in ("EV-879", "EV-880")),
        cards_db["cards_event"][1],
    )
    # - 救急搬送 (EV-875)
    ev_ambulance = next(
        (e for e in cards_db["cards_event"] if e["card_id"] == "EV-875"),
        cards_db["cards_event"][2],
    )

    events = [ev_toilet, ev_infection, ev_ambulance]
    groups = [grp_pet, grp_wheel]
    members = mems_pet + mems_wheel

    seq = []
    cno = 1
    for m in mems_pet:
        seq.append(
            {
                "card_number": cno,
                "kind": "pet" if m.get("data_type") == "ペット" else "person",
                "original_id": m["member_id"],
                "group_id": grp_pet["group_id"],
            }
        )
        cno += 1

    seq.append(
        {
            "card_number": cno,
            "kind": "event",
            "original_id": ev_toilet["card_id"],
            "group_id": None,
        }
    )
    cno += 1

    for m in mems_wheel:
        seq.append(
            {
                "card_number": cno,
                "kind": "pet" if m.get("data_type") == "ペット" else "person",
                "original_id": m["member_id"],
                "group_id": grp_wheel["group_id"],
            }
        )
        cno += 1

    seq.append(
        {
            "card_number": cno,
            "kind": "event",
            "original_id": ev_infection["card_id"],
            "group_id": None,
        }
    )
    cno += 1

    seq.append(
        {
            "card_number": cno,
            "kind": "event",
            "original_id": ev_ambulance["card_id"],
            "group_id": None,
        }
    )

    deck_json = {
        "cards_event": events,
        "evacuee_groups": groups,
        "group_members": members,
        "_web_deck_meta": {"card_sequence": seq},
    }
    p = tmp_dir / "hug_game_custom_deck.json"
    p.write_text(json.dumps(deck_json, ensure_ascii=False), encoding="utf-8")
    return p


def test_hug_game_setup_loads_server_decks_and_starts_on_smartphone(page, e2e_server):
    """スマホ画面(390x844)でサーバ保存デッキ（五小rev5・基本セット等）の選択とゲーム設定変更ができ、横はみ出しゼロで起動する."""
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{e2e_server['base_url']}/hug-game.html")

    setup_view = page.get_by_test_id("hg-setup-view")
    expect(setup_view).to_be_visible()

    # サーバ保存済みデッキ一覧に「五小rev5」「基本セット」が含まれていること
    setup_text = setup_view.inner_text()
    assert "五小rev5" in setup_text
    assert "基本セット" in setup_text

    # デフォルトで五小rev5が読み込まれていること
    expect(page.get_by_test_id("hg-active-deck-banner")).to_contain_text("五小rev5")

    # ロビーのファン型イラストカード3枚が正常に読み込まれていること
    fan_imgs = page.locator('[data-testid="hg-hero-card-fan"] img')
    expect(fan_imgs).to_have_count(3)
    for i in range(3):
        expect(fan_imgs.nth(i)).to_be_visible()
        assert fan_imgs.nth(i).evaluate("el => el.complete && el.naturalWidth > 0") is True

    # ゲーム設定の切り替えテスト（30枚ショート、2タップ確認モード → ワンタップに戻す）
    page.get_by_test_id("hg-opt-limit-30").click()
    expect(page.get_by_test_id("hg-opt-limit-30")).to_have_class("hg-pill-opt active")
    expect(page.get_by_test_id("hg-stat-cards")).to_contain_text("30")

    page.get_by_test_id("hg-opt-tap-two").click()
    expect(page.get_by_test_id("hg-opt-tap-two")).to_have_class("hg-pill-opt active")
    page.get_by_test_id("hg-opt-tap-one").click()
    expect(page.get_by_test_id("hg-opt-tap-one")).to_have_class("hg-pill-opt active")

    # スマホ幅で横スクロールが発生していないこと
    no_h_overflow = page.evaluate(
        "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
    )
    assert no_h_overflow is True

    # 訓練スタート
    page.get_by_test_id("hg-start-game-btn").click()
    play_view = page.get_by_test_id("hg-play-view")
    expect(play_view).to_be_visible()

    # プレイ画面でもスマホ幅で横はみ出しゼロであること
    no_play_h_overflow = page.evaluate(
        "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
    )
    assert no_play_h_overflow is True

    # 6つのエリアタブ（校庭・門、体育館、校舎1F、校舎2F、校舎3F、転出/在宅）すべてが存在し切り替えられること
    for area_id, sample_room in [
        ("grounds", "manhole-toilet"),
        ("gym", "gym-a"),
        ("floor1", "f1-infirmary"),
        ("floor2", "f2-family"),
        ("floor3", "f3-isolation-a"),
        ("external", "ext-hospital"),
    ]:
        tab = page.get_by_test_id(f"hg-tab-{area_id}")
        expect(tab).to_be_visible()
        tab.click()
        expect(page.get_by_test_id(f"hg-room-{sample_room}")).to_be_visible()


def test_hug_game_full_workflow_placement_pet_separation_inspector_events_and_report(
    page, e2e_server, tmp_path: Path
):
    """スマホ画面で世帯配置・ペット渡り廊下自動分離・内訳/移動モーダル・五小イベント対応・Undo・完了評価レポートまで一貫動作する."""
    page.set_viewport_size({"width": 390, "height": 844})
    deck_path = _build_custom_test_deck(tmp_path)
    deck_data = json.loads(deck_path.read_text(encoding="utf-8"))
    seq = deck_data["_web_deck_meta"]["card_sequence"]
    pet_cno = next(s["card_number"] for s in seq if s["kind"] == "pet")
    first_human_cno = next(s["card_number"] for s in seq if s["kind"] == "person")
    first_gid = seq[0]["group_id"]
    wheel_human_cno = next(
        s["card_number"] for s in seq if s["kind"] == "person" and s["group_id"] != first_gid
    )
    event_cnos = [s["card_number"] for s in seq if s["kind"] == "event"]

    page.goto(f"{e2e_server['base_url']}/hug-game.html")
    expect(page.get_by_test_id("hg-setup-view")).to_be_visible()

    # カスタムデッキJSONを読み込む
    page.get_by_test_id("hg-json-file-input").set_input_files(str(deck_path))
    expect(page.get_by_test_id("hg-active-deck-banner")).to_contain_text("hug_game_custom_deck")

    # ワンタップ配置・世帯まとめ・ペット自動分離ONで訓練開始
    page.get_by_test_id("hg-start-game-btn").click()
    expect(page.get_by_test_id("hg-play-view")).to_be_visible()

    # Step 1: ペット連れ世帯の到着 -> イラスト表示＆公式カードインライン切替＆体育館A区画配置
    expect(page.get_by_test_id("hg-card-dock")).to_be_visible()
    expect(page.get_by_test_id("hg-pet-split-bar")).to_be_visible()
    first_illust = page.locator('[data-testid^="hg-member-illust-"]').first
    expect(first_illust).to_be_visible()
    assert first_illust.evaluate("el => el.complete && el.naturalWidth > 0") is True

    # ドック内の「🃏 公式カード」↔「🎨 イラスト」表示切替が動作すること
    page.get_by_test_id("hg-toggle-card-view-btn").click()
    real_card_img = page.locator('[data-testid^="hg-dock-real-card-"]').first
    expect(real_card_img).to_be_visible()
    page.wait_for_function(
        "() => { const el = document.querySelector('[data-testid^=\"hg-dock-real-card-\"]'); return Boolean(el && el.complete && el.naturalWidth > 0); }"
    )
    page.get_by_test_id("hg-toggle-card-view-btn").click()
    expect(page.locator('[data-testid^="hg-member-illust-"]').first).to_be_visible()

    page.get_by_test_id("hg-tab-gym").click()
    page.get_by_test_id("hg-room-gym-a").click()

    # Undoボタンで一度戻せることを検証
    undo_btn = page.get_by_test_id("hg-undo-btn")
    expect(undo_btn).to_be_enabled()
    undo_btn.click()
    # Undo後、再びStep 1の世帯カードに戻っていること
    expect(page.get_by_test_id("hg-progress-pill")).to_contain_text("(1/5)")

    # 公式HUGカード画像モーダルを開いて閉じられること
    page.get_by_test_id("hg-open-card-img-btn").click()
    expect(page.get_by_test_id("hg-card-img-modal")).to_be_visible()
    page.locator("#hg-card-modal-close").click()
    expect(page.get_by_test_id("hg-card-img-modal")).not_to_be_visible()

    # 再び体育館A区画に配置（人間は体育館A、ペットは渡り廊下へ自動分離）
    page.get_by_test_id("hg-tab-gym").click()
    page.get_by_test_id("hg-room-gym-a").click()

    # Step 2: 五小マンホールトイレ設営イベント（イベントイラスト表示・選択肢なし・自由対応メモ）
    expect(page.get_by_test_id("hg-progress-pill")).to_contain_text("(2/5)")
    ev_illust = page.get_by_test_id("hg-event-illust")
    expect(ev_illust).to_be_visible()
    assert ev_illust.evaluate("el => el.complete && el.naturalWidth > 0") is True
    expect(page.get_by_test_id("hg-event-choices")).to_have_count(0)

    # 3Dミニチュア・カメラ視点操作（全館俯瞰 ↔ 階別拡大、回転、ズーム、3D/平面切替、リセット）
    expect(page.get_by_test_id("hg-camera-controls")).to_be_visible()
    page.get_by_test_id("hg-cam-scope-btn").click()
    expect(page.get_by_test_id("hg-all-campus-diorama")).to_be_visible()
    page.get_by_test_id("hg-cam-scope-btn").click()
    expect(page.get_by_test_id("hg-all-campus-diorama")).to_have_count(0)
    page.get_by_test_id("hg-cam-rot-left").click()
    page.get_by_test_id("hg-cam-zoom-in").click()
    page.get_by_test_id("hg-cam-tilt-btn").click()
    page.get_by_test_id("hg-cam-reset").click()

    # 配置済みの体育館A区画に立体コマが表示され、渡り廊下にペットコマ・1/15が反映されていること
    page.get_by_test_id("hg-tab-gym").click()
    expect(page.locator('[data-testid="hg-room-avatars-gym-a"] img.hg-room-avatar-img').first).to_be_visible()

    # 校庭・門タブのマンホールトイレをタップして運用状態を変更し、渡り廊下にペットコマがあること
    page.get_by_test_id("hg-tab-grounds").click()
    expect(page.get_by_test_id("hg-room-count-corridor-pet")).to_contain_text("1/15")
    expect(page.get_by_test_id(f"hg-pawn-{pet_cno}")).to_be_visible()
    page.get_by_test_id("hg-room-manhole-toilet").click()
    expect(page.get_by_test_id("hg-room-modal")).to_be_visible()
    page.locator('[data-status-preset="稼働中(10基)"]').click()
    page.locator("#hg-room-modal-close").click()
    expect(page.get_by_test_id("hg-room-manhole-toilet")).to_contain_text("稼働中(10基)")

    # イベント対応メモを記入して次ステップへ進む
    memo_1 = "マンホールトイレ10基を設営し照明と目隠しテントを配置"
    page.get_by_test_id("hg-event-memo-input").fill(memo_1)
    page.get_by_test_id("hg-event-memo-submit-btn").click()

    # Step 3: 車いす/2世帯目の到着 -> 校舎1F 福祉教室(f1-welfare)へ配置
    expect(page.get_by_test_id("hg-progress-pill")).to_contain_text("(3/5)")
    page.get_by_test_id("hg-tab-floor1").click()
    page.get_by_test_id("hg-room-f1-welfare").click()

    # 3Dミニチュア上の避難者コマを直接タップして別階の部屋へ移動
    page.get_by_test_id("hg-tab-gym").click()
    page.get_by_test_id(f"hg-pawn-{first_human_cno}").click()
    expect(page.get_by_test_id("hg-pawn-move-bar")).to_be_visible()
    page.get_by_test_id("hg-tab-floor2").click()
    page.get_by_test_id("hg-room-f2-general-a").click()
    expect(page.get_by_test_id("hg-room-count-f2-general-a")).to_contain_text("/20")

    # Step 4: 感染症発症イベント（選択肢・自動ボタンなし）-> コマを3F隔離室へ直接移動＆対応メモ記録
    expect(page.get_by_test_id("hg-progress-pill")).to_contain_text("(4/5)")
    expect(page.get_by_test_id("hg-execute-infection-btn")).to_have_count(0)
    page.get_by_test_id("hg-tab-floor2").click()
    page.get_by_test_id(f"hg-pawn-{first_human_cno}").click()
    page.get_by_test_id("hg-tab-floor3").click()
    page.get_by_test_id("hg-room-f3-isolation-a").click()
    expect(page.get_by_test_id("hg-room-count-f3-isolation-a")).to_contain_text("/12")

    memo_2 = "感染疑い者を3F第一隔離室へ退避し消毒を実施"
    page.get_by_test_id("hg-event-memo-input").fill(memo_2)
    page.get_by_test_id("hg-event-memo-submit-btn").click()

    # Step 5: 救急搬送イベント（選択肢・自動ボタンなし）-> 世帯から個人単位を選択して病院へ移動＆対応メモ記録
    expect(page.get_by_test_id("hg-progress-pill")).to_contain_text("(5/5)")
    expect(page.get_by_test_id("hg-execute-transfer-btn")).to_have_count(0)
    page.get_by_test_id("hg-tab-floor1").click()
    page.get_by_test_id(f"hg-pawn-{wheel_human_cno}").click()
    expect(page.get_by_test_id("hg-pawn-move-bar")).to_be_visible()
    if page.get_by_test_id("hg-pawn-scope-person").count() > 0:
        page.get_by_test_id("hg-pawn-scope-person").click()
    page.get_by_test_id("hg-tab-external").click()
    page.get_by_test_id("hg-room-ext-hospital").click()
    expect(page.get_by_test_id("hg-room-count-ext-hospital")).to_contain_text("1名")

    memo_3 = "呼吸苦の傷病者1名を救急搬送へ引き継ぎ"
    page.get_by_test_id("hg-event-memo-input").fill(memo_3)
    page.get_by_test_id("hg-event-memo-submit-btn").click()

    # 全5ステップ完了後、訓練結果・振り返りレポート画面で記録した全イベントメモが確認できること
    report_view = page.get_by_test_id("hg-report-view")
    expect(report_view).to_be_visible()
    expect(page.get_by_test_id("hg-report-score")).to_be_visible()
    expect(page.get_by_test_id("hg-report-event-memos")).to_be_visible()
    expect(page.get_by_test_id(f"hg-report-memo-{event_cnos[0]}")).to_have_value(memo_1)
    expect(page.get_by_test_id(f"hg-report-memo-{event_cnos[1]}")).to_have_value(memo_2)
    expect(page.get_by_test_id(f"hg-report-memo-{event_cnos[2]}")).to_have_value(memo_3)
    expect(report_view).to_contain_text("小平第五小学校 エリア別 最終配置結果")
    expect(report_view).to_contain_text("ペット同行避難の飼育区画分離")


def test_hug_game_url_deck_param_two_tap_and_staged_floor_unlock(page, e2e_server):
    """URLパラメータ ?deck=基本セット での自動読込、段階的フロア解錠、2タップ確認配置モードが動作する."""
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{e2e_server['base_url']}/hug-game.html?deck=基本セット")

    expect(page.get_by_test_id("hg-setup-view")).to_be_visible()
    expect(page.get_by_test_id("hg-active-deck-banner")).to_contain_text("基本セット")

    # 30枚・2タップ確認モード・段階的フロア開放をONにして開始
    page.get_by_test_id("hg-opt-limit-30").click()
    page.get_by_test_id("hg-opt-tap-two").click()
    page.get_by_test_id("hg-opt-unlock-staged").click()
    page.get_by_test_id("hg-start-game-btn").click()
    expect(page.get_by_test_id("hg-play-view")).to_be_visible()

    # 校舎2Fタブを開くと未開放バナーが表示され、ワンタップで一括開放できること
    page.get_by_test_id("hg-tab-floor2").click()
    unlock_btn = page.get_by_test_id("hg-unlock-floor-btn")
    expect(unlock_btn).to_be_visible()
    unlock_btn.click()
    expect(unlock_btn).not_to_be_visible()

    # 最初のカードが世帯カードなら1タップ目で選択され、確定ボタンで配置されることを確認
    if page.get_by_test_id("hg-members-strip").count() > 0:
        page.get_by_test_id("hg-tab-gym").click()
        page.get_by_test_id("hg-room-gym-b").click()
        confirm_btn = page.get_by_test_id("hg-confirm-two-tap-btn")
        expect(confirm_btn).to_be_visible()
        confirm_btn.click()
        expect(page.get_by_test_id("hg-progress-pill")).to_contain_text("(2/")


def test_hug_game_loads_newly_saved_server_deck_and_downloads_report_json(
    page, e2e_server, tmp_path: Path
):
    """DB管理ツールで新規保存したデッキを /api/decks 経由でスマホHUG訓練に読み込み、途中講評・結果JSON保存まで動作する."""
    base_url = e2e_server["base_url"]
    page.goto(base_url)
    page.get_by_test_id("load-demo-btn").click()
    expect(page.get_by_test_id("count-units")).to_have_text("30")
    page.get_by_test_id("tab-deck").click()

    custom_deck_name = "第五小スマホ実践デッキ"
    page.get_by_test_id("save-deck-name-input").fill(custom_deck_name)
    page.get_by_test_id("save-deck-btn").click()
    expect(page.get_by_test_id("deck-share-panel")).to_be_visible()
    expect(page.get_by_test_id("open-hug-game-link")).to_be_visible()

    # スマホ画面サイズに切り替えて新規保存デッキ名指定で hug-game.html を開く
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{base_url}/hug-game.html?deck={custom_deck_name}")
    expect(page.get_by_test_id("hg-setup-view")).to_be_visible()
    expect(page.get_by_test_id("hg-active-deck-banner")).to_contain_text(custom_deck_name)

    page.get_by_test_id("hg-start-game-btn").click()
    expect(page.get_by_test_id("hg-play-view")).to_be_visible()

    # インゲーム設定メニューから途中結果の振り返り講評へ遷移し、JSONレポートをダウンロードできること
    page.get_by_test_id("hg-open-menu-btn").click()
    expect(page.get_by_test_id("hg-ingame-menu")).to_be_visible()
    page.get_by_test_id("hg-finish-now-btn").click()

    expect(page.get_by_test_id("hg-report-view")).to_be_visible()
    with page.expect_download() as dl_info:
        page.get_by_test_id("hg-report-download-btn").click()
    dl = dl_info.value
    assert dl.suggested_filename.startswith("hug_training_report_")
    assert dl.suggested_filename.endswith(".json")
    saved_report = tmp_path / dl.suggested_filename
    dl.save_as(str(saved_report))
    payload = json.loads(saved_report.read_text(encoding="utf-8"))
    assert payload["deck_title"] == custom_deck_name
    assert "score" in payload

