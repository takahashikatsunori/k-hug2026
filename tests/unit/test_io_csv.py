"""単体テスト: CSV 出力 (CS-01 〜 CS-15)."""
from __future__ import annotations

import csv
import io
import zipfile

from hugdb.deck import build_deck
from hugdb.filtering import SearchQuery, execute_search
from hugdb.io_csv import (
    CARD_CSV_HEADERS,
    event_to_card_csv_row,
    export_deck_card_csv,
    export_full_csv_zip,
    export_records_card_csv,
    export_search_card_csv,
    member_to_card_csv_row,
)
from hugdb.schema import EVENT_KEY_ORDER, GROUP_KEY_ORDER, MEMBER_KEY_ORDER


def _parse_csv_bytes(raw: bytes) -> list[list[str]]:
    text = raw.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    return list(reader)


def test_cs_01_conversion_rule_example_exact_match(csv_example_payload: dict):
    """CS-01: 変換ルール.md の出力例（田中・伊藤の世帯）を再現するデータ → 6行の全セルが例と一致する."""
    csv_bytes = export_records_card_csv(
        csv_example_payload["cards_event"],
        csv_example_payload["evacuee_groups"],
        csv_example_payload["group_members"],
    )
    rows = _parse_csv_bytes(csv_bytes)
    expected = [
        [
            "カード番号",
            "種別",
            "氏名/イベント名",
            "避難元",
            "年齢",
            "性別",
            "属性",
            "詳細フラグ",
            "具体的な容姿・表情",
            "具体的なセリフ・状況",
            "判定ポイント",
        ],
        [
            "1",
            "避難者",
            "田中 太郎",
            "花小金井３丁目",
            "42",
            "男性",
            "世帯主",
            "力仕事",
            "自家用車で避難してきた父親。落ち着いた様子。",
            "「家族3人で乗用車で来ました。車はどこに置けばいいですか？」",
            "敷地内での車両誘導および駐車場管理の判断",
        ],
        [
            "2",
            "避難者",
            "田中 恵子",
            "花小金井３丁目",
            "39",
            "女性",
            "妻",
            "",
            "不安そうな表情で子供の手を握っている。",
            "「電気も水も止まってしまって不安です。」",
            "一般避難者エリアへの案内と生活情報の提供",
        ],
        [
            "3",
            "避難者",
            "田中 健太",
            "花小金井３丁目",
            "9",
            "男性",
            "子",
            "",
            "リュックサックを背負った小学生。",
            "「お腹すいたな…」",
            "子どものメンタルケアと配布物の確認",
        ],
        [
            "4",
            "避難者",
            "伊藤 芳雄",
            "花小金井１丁目",
            "78",
            "男性",
            "世帯主",
            "車椅子 骨折",
            "車椅子に乗っており足に包帯を巻いている。",
            "「地震で倒れて足の骨を折ってしまった。痛みがひどい…」",
            "要即時対応（高トリアージ）。救護所への優先案内とバリアフリー居住区の確保",
        ],
        [
            "5",
            "避難者",
            "伊藤 和子",
            "花小金井１丁目",
            "75",
            "女性",
            "妻",
            "",
            "疲弊した表情で夫の車椅子を押している。",
            "「夫の足が折れてしまって…助けてください。」",
            "要配慮者家族への寄り添いと医療スタッフとの連携",
        ],
        [
            "6",
            "避難者",
            "伊藤 慎一",
            "花小金井１丁目",
            "48",
            "男性",
            "子",
            "力仕事",
            "大きな荷物をいくつも抱えて付き添っている。",
            "「父のケガの手当を優先してください。」",
            "家族の同居配置と介護スペースの調整",
        ],
    ]
    assert rows == expected


def test_cs_02_header_columns():
    """CS-02: ヘッダが 11 列の規定文字列と一致する."""
    assert (
        ",".join(CARD_CSV_HEADERS)
        == "カード番号,種別,氏名/イベント名,避難元,年齢,性別,属性,詳細フラグ,具体的な容姿・表情,具体的なセリフ・状況,判定ポイント"
    )


def test_cs_03_s2_ev_001_row(s2_payload: dict):
    """CS-03: S2 の EV-001 の行が期待どおりである."""
    ev1 = s2_payload["cards_event"][0]
    row = event_to_card_csv_row(1, ev1)
    assert row == [
        "1",
        "イベント",
        "本部長の決定",
        "-",
        "-",
        "-",
        "五小地区代表会議",
        "行政対応 避難所管理",
        ev1["scene_description"],
        ev1["content"],
        ev1["training_point"],
    ]


def test_cs_04_s2_m_0001_person_row(s2_payload: dict):
    """CS-04: S2 の M-0001（人物）の行が期待どおりである."""
    grp1 = s2_payload["evacuee_groups"][0]
    m1 = s2_payload["group_members"][0]
    row = member_to_card_csv_row(1, m1, grp1)
    assert row == [
        "1",
        "避難者",
        "国語 太郎",
        "花小金井６丁目",
        "80",
        "男性",
        "世帯主",
        "認知症 慢性疾患あり",
        m1["appearance"],
        m1["statement"],
        m1["training_point"],
    ]


def test_cs_05_s2_m_0010_pet_row(s2_payload: dict):
    """CS-05: S2 の M-0010（ペット）の行が期待どおりである（セリフ列にも appearance が入る）."""
    grp4 = s2_payload["evacuee_groups"][3]
    m10 = next(m for m in s2_payload["group_members"] if m["member_id"] == "M-0010")
    row = member_to_card_csv_row(10, m10, grp4)
    assert row == [
        "10",
        "ペット",
        "コタロウ",
        "花小金井６丁目",
        "6",
        "男性",
        "ペット",
        "無駄吠え・夜鳴き 人懐こい",
        m10["appearance"],
        m10["appearance"],
        m10["training_point"],
    ]


def test_cs_06_health_condition_good_excluded_from_flags():
    """CS-06: health_condition=[良好] だけ → 詳細フラグに「良好」を入れない."""
    m = {"data_type": "人物", "vulnerabilities": [], "health_condition": ["良好"], "skills": []}
    row = member_to_card_csv_row(1, m, {})
    assert row[7] == ""


def test_cs_07_flags_order_vulnerabilities_health_skills():
    """CS-07: 詳細フラグの並び → 要配慮特性 → 体調 → スキルの順。値が無ければ空欄."""
    m = {
        "data_type": "人物",
        "vulnerabilities": ["車椅子"],
        "health_condition": ["良好", "発熱"],
        "skills": ["医療関係"],
    }
    row = member_to_card_csv_row(1, m, {})
    assert row[7] == "車椅子 発熱 医療関係"


def test_cs_08_empty_person_statement():
    """CS-08: 人物の statement が空 → セリフの列は空欄."""
    m = {"data_type": "人物", "statement": ""}
    row = member_to_card_csv_row(1, m, {})
    assert row[9] == ""


def test_cs_09_null_age_becomes_empty_string():
    """CS-09: 年齢が null → 空欄."""
    m = {"data_type": "人物", "age": None}
    row = member_to_card_csv_row(1, m, {})
    assert row[4] == ""


def test_cs_10_rfc_4180_quoting_roundtrip():
    """CS-10: 値にカンマ・改行・ダブルクォートが含まれる → RFC 4180 に従ってクォートし、再解析で元に戻る."""
    ev = {
        "card_id": "EV-001",
        "event_name": 'テスト, "引用",\n改行入り',
        "category": ["行政対応"],
        "source": "本部, 支部",
        "scene_description": "情景1\r\n情景2",
        "content": 'セリフ "重要"',
        "training_point": "ポイントA,B",
    }
    raw = export_records_card_csv([ev], [], [])
    parsed = _parse_csv_bytes(raw)
    assert parsed[1][2] == 'テスト, "引用",\n改行入り'
    assert parsed[1][6] == "本部, 支部"
    assert parsed[1][9] == 'セリフ "重要"'


def test_cs_11_bom_and_crlf_line_endings(s2_payload: dict):
    """CS-11: 文字コードと改行 → 先頭が BOM（EF BB BF）、改行は CRLF."""
    raw = export_records_card_csv([s2_payload["cards_event"][0]], [], [])
    assert raw.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" in raw
    # CRLF を除いた後に単独 LF が残っていないこと
    assert b"\n" not in raw.replace(b"\r\n", b"")


def test_cs_12_deck_csv_card_numbers_match_deck_json_ids(s2_payload: dict):
    """CS-12: デッキのCSV → カード番号がデッキのJSONの ID と一致する（1〜41）."""
    deck = build_deck(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    raw = export_deck_card_csv(deck)
    rows = _parse_csv_bytes(raw)
    assert len(rows) == 42  # ヘッダ + 41枚
    csv_nums = [r[0] for r in rows[1:]]
    assert csv_nums == [str(i) for i in range(1, 42)]


def test_cs_13_search_result_card_csv_expands_households(s2_payload: dict):
    """CS-13: 検索結果のカード画像用CSV（世帯の表示） → 世帯を構成員の行に展開し、連番を付ける."""
    sr = execute_search(
        SearchQuery(view="household", keyword="授乳室"),
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    raw = export_search_card_csv(sr, s2_payload["evacuee_groups"], s2_payload["group_members"])
    rows = _parse_csv_bytes(raw)
    assert len(rows) == 4  # ヘッダ + GRP-002 の構成員3名
    assert [r[0] for r in rows[1:]] == ["1", "2", "3"]
    assert [r[2] for r in rows[1:]] == ["算数 一郎", "算数 和代", "算数 芽衣"]


def test_cs_14_full_csv_zip_structure_and_array_joiner(s2_payload: dict):
    """CS-14: 全項目CSVのZIP → 3ファイルで、ヘッダは物理名、配列は「、」でつなぐ."""
    zip_bytes = export_full_csv_zip(
        s2_payload["cards_event"],
        s2_payload["evacuee_groups"],
        s2_payload["group_members"],
    )
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        assert set(zf.namelist()) == {
            "cards_event.csv",
            "evacuee_groups.csv",
            "group_members.csv",
        }
        ev_rows = _parse_csv_bytes(zf.read("cards_event.csv"))
        grp_rows = _parse_csv_bytes(zf.read("evacuee_groups.csv"))
        mem_rows = _parse_csv_bytes(zf.read("group_members.csv"))

    assert tuple(ev_rows[0]) == EVENT_KEY_ORDER
    assert tuple(grp_rows[0]) == GROUP_KEY_ORDER
    assert tuple(mem_rows[0]) == MEMBER_KEY_ORDER["ペット"]

    cat_idx = EVENT_KEY_ORDER.index("category")
    assert ev_rows[1][cat_idx] == "行政対応、避難所管理"


def test_cs_15_full_csv_empty_and_null_values(s2_payload: dict):
    """CS-15: 全項目CSVの値が空 → null は空欄、[] も空欄."""
    zip_bytes = export_full_csv_zip([s2_payload["cards_event"][0]], [], [])
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        ev_rows = _parse_csv_bytes(zf.read("cards_event.csv"))

    prereq_idx = EVENT_KEY_ORDER.index("prerequisite_card_id")
    excl_sh_idx = EVENT_KEY_ORDER.index("exclude_shelters")
    assert ev_rows[1][prereq_idx] == ""
    assert ev_rows[1][excl_sh_idx] == ""
