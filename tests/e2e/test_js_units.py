"""フロントエンド JS ヘルパー単体テスト (JS-01 〜 JS-04)."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e


def test_js_01_tristate_chip_transitions(page, e2e_server):
    """JS-01: 3状態チップの状態遷移 → 未指定 → 合致 → 排除 → 未指定 の順に変わる."""
    page.goto(e2e_server["base_url"])
    transitions = page.evaluate(
        """async () => {
            const { nextChipState } = await import('/static/js/components/chips.js');
            const s0 = 'none';
            const s1 = nextChipState(s0);
            const s2 = nextChipState(s1);
            const s3 = nextChipState(s2);
            return [s0, s1, s2, s3];
        }"""
    )
    assert transitions == ["none", "match", "exclude", "none"]


def test_js_02_form_state_and_record_roundtrip(page, e2e_server):
    """JS-02: フォームの値 ⇔ レコード → フォームに入れて取り出すと元に戻る（match/exclude、配列、数値、null）."""
    page.goto(e2e_server["base_url"])
    result = page.evaluate(
        """async () => {
            const { recordToFormState, formStateToRecord } = await import('/static/js/schema.js');
            const { api } = await import('/static/js/api.js');
            const schema = await api.getSchema();

            const original = {
                card_id: 'EV-001',
                event_name: 'テストイベント',
                category: ['行政対応', '避難所設備'],
                source: '市対策本部',
                priority: 0,
                relative_timing: ['先頭'],
                disaster_phase: ['発災直後（0〜3時間）'],
                prerequisite_card_id: null,
                difficulty: '初級',
                must_respond: 'あり（要即時対応）',
                additional_equipment: null,
                required_people: null,
                scene_description: '描写テスト',
                content: '本文テスト',
                training_point: 'ポイント',
                match_disaster_types: ['地震'],
                exclude_disaster_types: ['豪雨'],
                match_infrastructure: ['停電', '断水'],
                exclude_infrastructure: [],
                match_weather: [],
                exclude_weather: ['猛暑'],
                match_holiday_type: [],
                exclude_holiday_type: [],
                match_time_slots: [],
                exclude_time_slots: [],
                match_dates: '12/01-02/28',
                exclude_dates: null,
                match_shelters: ['小平第五小学校'],
                exclude_shelters: [],
            };

            const formState = recordToFormState('event', original, schema);
            const roundtripped = formStateToRecord('event', formState, schema);
            return { original, roundtripped };
        }"""
    )
    orig = result["original"]
    rt = result["roundtripped"]
    assert rt["event_name"] == orig["event_name"]
    assert rt["category"] == orig["category"]
    assert rt["priority"] == 0
    assert rt["additional_equipment"] is None
    assert rt["required_people"] is None
    assert rt["match_disaster_types"] == ["地震"]
    assert rt["exclude_disaster_types"] == ["豪雨"]
    assert rt["match_infrastructure"] == ["停電", "断水"]
    assert rt["exclude_weather"] == ["猛暑"]
    assert rt["match_dates"] == "12/01-02/28"
    assert rt["exclude_dates"] is None


def test_js_03_html_escape_xss_protection(page, e2e_server):
    """JS-03: HTMLエスケープ → `<script>` などがそのまま表示され、実行されない（XSS 対策）."""
    page.goto(e2e_server["base_url"])
    res = page.evaluate(
        """async () => {
            const { escapeHtml } = await import('/static/js/util.js');
            const { renderEventCard } = await import('/static/js/components/card.js');
            window.__xss_triggered = false;
            const malicious = '<script>window.__xss_triggered = true;</script><img src=x onerror="window.__xss_triggered=true">';
            const escaped = escapeHtml(malicious);
            const cardEl = renderEventCard({
                card_id: 'EV-999',
                event_name: malicious,
                source: 'テスト',
                content: malicious,
                category: ['行政対応'],
                priority: 1,
                difficulty: '初級',
                must_respond: 'なし',
                relative_timing: ['中盤'],
                disaster_phase: ['発災直後（0〜3時間）'],
            });
            document.body.appendChild(cardEl);
            const renderedTitle = cardEl.querySelector('.card-title').textContent;
            cardEl.remove();
            return {
                escaped,
                renderedTitle,
                xssTriggered: window.__xss_triggered,
                malicious,
            };
        }"""
    )
    assert res["xssTriggered"] is False
    assert "<script>" not in res["escaped"]
    assert "&lt;script&gt;" in res["escaped"]
    assert res["renderedTitle"] == res["malicious"]


def test_js_04_household_member_and_pet_counts(page, e2e_server):
    """JS-04: 構成員の行を追加・削除したときの人数計算 → 人物とペットを分けて数える."""
    page.goto(e2e_server["base_url"])
    counts = page.evaluate(
        """async () => {
            const { computeHouseholdCounts } = await import('/static/js/util.js');
            const members = [
                { data_type: '人物', age: 40 },
                { data_type: '人物', age: 38 },
                { data_type: 'ペット', pet_type: '犬', age: 5 },
            ];
            const c1 = computeHouseholdCounts(members);
            members.splice(1, 1); // 人物を1人削除
            const c2 = computeHouseholdCounts(members);
            members.push({ data_type: 'ペット', pet_type: '猫', age: 2 });
            const c3 = computeHouseholdCounts(members);
            return [c1, c2, c3];
        }"""
    )
    assert counts[0] == {"member_count": 2, "pet_count": 1, "total": 3}
    assert counts[1] == {"member_count": 1, "pet_count": 1, "total": 2}
    assert counts[2] == {"member_count": 1, "pet_count": 2, "total": 3}
