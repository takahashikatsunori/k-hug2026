"""単体テスト: デッキ構築・連番化・ID置換・ハッシュ (DE-01 〜 DE-21)."""
from __future__ import annotations

import copy

from hugdb.deck import build_deck, inspect_saved_deck
from hugdb.repository import Repository
from hugdb.schema import EVENT_KEY_ORDER, GROUP_KEY_ORDER, MEMBER_KEY_ORDER


def test_de_01_s2_earthquake_kodaira5_total_41(s2_payload: dict):
    """DE-01: S2・地震・小平第五小学校 → イベント20件、世帯10件、人物19名、ペット2匹、計41枚."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        {"disaster_type": "地震", "shelter": "小平第五小学校"},
    )
    assert res.stats["events"] == 20
    assert res.stats["households"] == 10
    assert res.stats["persons"] == 19
    assert res.stats["pets"] == 2
    assert res.stats["total_cards"] == 41
    assert len(res.cards) == 41


def test_de_02_s2_heavy_rain_zero_cards(s2_payload: dict):
    """DE-02: S2・豪雨 → 0枚。除外理由は「合致条件外: 災害種類」が30単位."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        {"disaster_type": "豪雨", "shelter": "小平第五小学校"},
    )
    assert res.stats["total_cards"] == 0
    assert res.stats["excluded_units"] == 30
    assert res.stats["excluded_by_reason"]["合致条件外: 災害種類"] == 30


def test_de_03_unspecified_condition_dimensions_not_filtered(s2_payload: dict):
    """DE-03: 訓練条件の一部を未指定にする → その次元では絞り込まない."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        {},
    )
    assert res.stats["total_cards"] == 41


def test_de_04_holiday_type_auto_determined_from_date(s2_payload: dict):
    """DE-04: 休日種別は日付から自動で決める → holidays の結果を条件に使う."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][0]["match_holiday_type"] = ["祝日"]
    # 2026-11-03 は文化の日（祝日）
    res_hit = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"date": "2026-11-03"},
    )
    assert "祝日" in res_hit.resolved_holiday_types
    assert any(c.original_id == "EV-001" for c in res_hit.cards)

    # 2026-11-04 は平日
    res_miss = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"date": "2026-11-04"},
    )
    assert not any(c.original_id == "EV-001" for c in res_miss.cards)


def test_de_05_holiday_type_manual_override(s2_payload: dict):
    """DE-05: 休日種別を手動で上書きする → 上書きした値を優先する."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][0]["match_holiday_type"] = ["祝日"]
    # 2026-11-04 は平日だが手動で「祝日」に上書き
    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"date": "2026-11-04", "holiday_type": ["祝日"]},
    )
    assert any(c.original_id == "EV-001" for c in res.cards)


def test_de_06_prerequisite_missing_cascades_exclusion(s2_payload: dict):
    """DE-06: 前提カードが抽出されなかった（EV-001 が除外されると EV-002 も除外） → 理由は「前提カード EV-001 がデッキにない」."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][0]["exclude_weather"] = ["雨"]  # EV-001 を除外させる
    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"weather": ["雨"]},
    )
    ev2_excl = next(x for x in res.excluded if x["id"] == "EV-002")
    assert "前提カード EV-001 がデッキにない" in ev2_excl["reasons"]


def test_de_07_disaster_phase_filter_includes_matching_and_empty(s2_payload: dict):
    """DE-07: 進行度の絞り込み=[発災直後, 初日] → その進行度のカードと、進行度が空のカードだけ."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][-1]["disaster_phase"] = []  # EV-020 の進行度を空にする
    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"disaster_phase": ["発災直後", "初日"]},
    )
    ev_ids = {c.original_id for c in res.cards if c.kind == "event"}
    assert "EV-020" in ev_ids
    assert "EV-008" not in ev_ids  # 2日目


def test_de_08_max_events_limit_respects_priority_and_prerequisites(s2_payload: dict):
    """DE-08: 最大イベント数=5 → priority=0 は必ず入り、残りは priority の小さい順。前提が揃わないものは飛ばす."""
    data = copy.deepcopy(s2_payload)
    # EV-004 (prereq=EV-003) の priority を 1 にし、EV-003 の priority を 9 に下げて選ばれなくする
    for ev in data["cards_event"]:
        if ev["card_id"] == "EV-003":
            ev["priority"] = 9
        elif ev["card_id"] == "EV-004":
            ev["priority"] = 1

    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"max_events": 5},
    )
    assert res.stats["events"] == 5
    ev_ids = {c.original_id for c in res.cards if c.kind == "event"}
    assert "EV-001" in ev_ids  # priority=0
    assert "EV-003" not in ev_ids
    assert "EV-004" not in ev_ids  # 前提の EV-003 が入らないためスキップされる


def test_de_09_max_events_smaller_than_priority_zero_count(s2_payload: dict):
    """DE-09: 最大イベント数が priority=0 の件数より少ない → priority=0 は全部入れ、警告を出す."""
    data = copy.deepcopy(s2_payload)
    data["cards_event"][0]["priority"] = 0
    data["cards_event"][1]["priority"] = 0
    data["cards_event"][1]["prerequisite_card_id"] = None

    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
        {"max_events": 1},
    )
    assert res.stats["events"] == 2
    assert len(res.warnings) >= 1


def test_de_10_max_households_limit_order(s2_payload: dict):
    """DE-10: 最大世帯数=3 → 要即時対応 → 時期 → ID の順で採用する."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        {"max_households": 3},
    )
    assert res.stats["households"] == 3
    grp_ids = [u["id"] for u in res.units if u["kind"] == "household"]
    # GRP-001 と GRP-005 は「先頭・要即時対応」、GRP-002 は「序盤・要即時対応」
    assert set(grp_ids) == {"GRP-001", "GRP-005", "GRP-002"}


def test_de_11_sequential_numbering_1_to_n(s2_payload: dict):
    """DE-11: 連番 → 1〜N の重複のない連番になる."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    nums = [c.card_number for c in res.cards]
    assert nums == list(range(1, 42))


def test_de_12_household_cards_contiguous_person_then_pet(s2_payload: dict):
    """DE-12: 世帯のカードの並び → 世帯ごとにまとまって連続し、世帯の中は人物（元の順）→ペットの順."""
    data = copy.deepcopy(s2_payload)
    # 故意にペットを人物より前に配置しても、デッキでは人物→ペットの順になることを確認
    data["group_members"].reverse()
    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
    )
    grp4_cards = [c for c in res.cards if c.group_id == "GRP-004"]
    assert len(grp4_cards) == 2
    assert grp4_cards[0].card_number + 1 == grp4_cards[1].card_number
    assert [c.kind for c in grp4_cards] == ["person", "pet"]


def test_de_13_first_five_cards_of_s2(s2_payload: dict):
    """DE-13: S2 の先頭5枚が EV-001, 国語 太郎, 国語 花子, EV-002, 英語 健治 の順."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    first_five = [c.title for c in res.cards[:5]]
    assert first_five == [
        "本部長の決定",
        "国語 太郎",
        "国語 花子",
        "総合受付の設置",
        "英語 健治",
    ]


def test_de_14_export_json_ids_replaced(s2_payload: dict):
    """DE-14: 出力JSONのID → card_id と member_id は '1'〜'41'、group_id はデッキ順に GRP-001〜010."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    exp = res.export_payload
    ev_ids = [e["card_id"] for e in exp["cards_event"]]
    mem_ids = [m["member_id"] for m in exp["group_members"]]
    all_ids = sorted(ev_ids + mem_ids, key=int)
    assert all_ids == [str(i) for i in range(1, 42)]

    grp_ids = [g["group_id"] for g in exp["evacuee_groups"]]
    assert grp_ids == [f"GRP-{i:03d}" for i in range(1, 11)]
    # 2番目の世帯は元の GRP-005（英語家）だが、出力JSONでは GRP-002 になる
    assert exp["evacuee_groups"][1]["group_name"].startswith("英語家")
    assert exp["group_members"][2]["group_id"] == "GRP-002"


def test_de_15_export_json_prerequisite_card_id_remapped(s2_payload: dict):
    """DE-15: 出力JSONの前提カードID → EV-002 の前提カードが、EV-001 の新しい番号 '1' になる."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    exp_ev2 = next(e for e in res.export_payload["cards_event"] if e["event_name"] == "総合受付の設置")
    assert exp_ev2["card_id"] == "4"
    assert exp_ev2["prerequisite_card_id"] == "1"


def test_de_16_export_json_array_order_and_key_order(s2_payload: dict):
    """DE-16: 出力JSONの配列の順序がデッキ順であり、キー構成がサンプル形式と一致する."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    exp = res.export_payload
    assert [int(e["card_id"]) for e in exp["cards_event"]] == sorted(int(e["card_id"]) for e in exp["cards_event"])
    assert [int(m["member_id"]) for m in exp["group_members"]] == sorted(
        int(m["member_id"]) for m in exp["group_members"]
    )

    for e in exp["cards_event"]:
        assert tuple(e.keys()) == EVENT_KEY_ORDER
    for g in exp["evacuee_groups"]:
        assert tuple(g.keys()) == GROUP_KEY_ORDER
    for m in exp["group_members"]:
        assert tuple(m.keys()) == MEMBER_KEY_ORDER[m["data_type"]]


def test_de_17_empty_member_names_auto_generated_in_export(s2_payload: dict):
    """DE-17: 名前が空の構成員がいる → 自動生成した名前で埋める."""
    data = copy.deepcopy(s2_payload)
    data["group_members"][1]["name"] = ""  # 国語 花子 を空にする
    res = build_deck(
        data["cards_event"],
        data["evacuee_groups"],
        data["group_members"],
    )
    mem2 = res.export_payload["group_members"][1]
    assert mem2["name"].startswith("国語 ")
    assert len(mem2["name"]) > 3


def test_de_18_deck_stats(s2_payload: dict):
    """DE-18: 統計 → 件数、除外の理由別件数、未確認の矛盾の件数."""
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        resolutions={"EV-008": "keep"},
    )
    assert res.stats["conflicts_total"] == 9
    assert res.stats["conflicts_unacknowledged"] == 8


def test_de_19_resolutions_and_manual_order_reflected_in_numbering(s2_payload: dict):
    """DE-19: 矛盾の確認結果（resolutions）と手動の順番を渡す → 反映した順番で連番を付ける."""
    res_base = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    # 先頭2単位 (EV-001, GRP-001) を入れ替えて GRP-001 を先頭にする
    custom_order = ["GRP-001", "EV-001"] + res_base.unit_ids[2:]
    res_custom = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        manual_order=custom_order,
    )
    assert res_custom.cards[0].title == "国語 太郎"
    assert res_custom.cards[0].card_number == 1
    assert res_custom.cards[2].title == "本部長の決定"
    assert res_custom.cards[2].card_number == 3


def test_de_20_saved_deck_hash_comparison_on_card_edit(repo: Repository, s2_payload: dict):
    """DE-20: 保存時のハッシュと現在のハッシュの比較 → カードを編集すると changed=True になる."""
    events = copy.deepcopy(s2_payload["cards_event"])
    groups = copy.deepcopy(s2_payload["evacuee_groups"])
    members = copy.deepcopy(s2_payload["group_members"])

    deck1 = build_deck(events, groups, members, {"disaster_type": "地震"})
    saved = repo.create_saved_deck(
        "テストデッキ",
        {"disaster_type": "地震"},
        manual_order=["GRP-001", "EV-001"] + deck1.unit_ids[2:],
        content_hash=deck1.content_hash,
    )

    info_unchanged = inspect_saved_deck(saved, events, groups, members)
    assert info_unchanged["changed"] is False
    assert info_unchanged["can_reapply_manual"] is True

    # EV-020 の時期を変更
    events[-1]["relative_timing"] = ["先頭（開所・初期）"]
    info_changed = inspect_saved_deck(saved, events, groups, members)
    assert info_changed["changed"] is True
    assert info_changed["can_reapply_manual"] is True
    assert len(info_changed["computed_unit_ids"]) == 30


def test_de_21_roundtrip_export_json_reimport_and_build(s2_payload: dict):
    """DE-21: 出力JSONを置換インポート相当で再度デッキを作る → 例外なく、41枚のデッキになる（往復の互換性）."""
    deck1 = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        {"disaster_type": "地震", "shelter": "小平第五小学校"},
    )
    exported = deck1.export_payload
    deck2 = build_deck(
        exported["cards_event"],
        exported["evacuee_groups"],
        exported["group_members"],
        {"disaster_type": "地震", "shelter": "小平第五小学校"},
    )
    assert deck2.stats["total_cards"] == 41
    assert [c.title for c in deck2.cards] == [c.title for c in deck1.cards]


def test_de_22_manual_excluded_ids_excludes_units_and_cascades_prerequisites(s2_payload: dict):
    """DE-22: 手動除外 (excluded_ids) を指定すると、DBから削除せずにデッキから除外され、前提カード除外も連動する."""
    # EV-001（EV-002の前提）と M-0001（GRP-001の構成員 → 世帯GRP-001ごと除外）を指定
    res = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
        {"disaster_type": "地震", "shelter": "小平第五小学校"},
        excluded_ids=["EV-001", "M-0001"],
    )
    # EV-001 (1枚) + EV-002 (前提連鎖 1枚) + GRP-001 (2枚) = 4枚減って 37枚
    assert res.stats["total_cards"] == 37
    assert res.stats["events"] == 18
    assert res.stats["households"] == 9
    assert res.stats["excluded_by_reason"]["手動除外（デッキから除外）"] == 2

    ev1_excl = next(x for x in res.excluded if x["id"] == "EV-001")
    assert ev1_excl["manual"] is True
    assert "手動除外（デッキから除外）" in ev1_excl["reasons"]

    grp1_excl = next(x for x in res.excluded if x["id"] == "GRP-001")
    assert grp1_excl["manual"] is True
    assert "手動除外（デッキから除外）" in grp1_excl["reasons"]

    ev2_excl = next(x for x in res.excluded if x["id"] == "EV-002")
    assert ev2_excl["manual"] is False
    assert "前提カード EV-001 がデッキにない" in ev2_excl["reasons"]

