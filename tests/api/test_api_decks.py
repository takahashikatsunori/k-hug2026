"""API 結合テスト: デッキ構築・手動並べ替え・出力・保存 (AP-16, AP-17, AP-18, AP-19)."""
from __future__ import annotations

import json
from fastapi.testclient import TestClient


def test_ap_16_deck_build(seeded_client: TestClient):
    """AP-16: POST /api/deck/build → DE-01 と同じ。矛盾の一覧を含む."""
    r = seeded_client.post(
        "/api/deck/build",
        json={"conditions": {"disaster_type": "地震", "shelter": "小平第五小学校"}},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["stats"]["total_cards"] == 41
    assert len(data["conflicts"]) == 9


def test_ap_17_deck_reorder_and_409_on_prerequisite_violation(seeded_client: TestClient):
    """AP-17: POST /api/deck/reorder（手動の順番） → 200。前提カードの制約に反する場合は 409."""
    r_ok = seeded_client.post(
        "/api/deck/reorder",
        json={"manual_order": ["GRP-001", "EV-001", "EV-002"]},
    )
    assert r_ok.status_code == 200

    r_409 = seeded_client.post(
        "/api/deck/reorder",
        json={"manual_order": ["EV-002", "EV-001"]},
    )
    assert r_409.status_code == 409
    assert "errors" in r_409.json()


def test_ap_18_deck_export_json_and_cardcsv(seeded_client: TestClient):
    """AP-18: POST /api/deck/export?format=json|cardcsv → DE-14 / CS-12 と同じ."""
    r_json = seeded_client.post(
        "/api/deck/export?format=json",
        json={"conditions": {"disaster_type": "地震", "shelter": "小平第五小学校"}},
    )
    assert r_json.status_code == 200
    exp_json = json.loads(r_json.content.decode("utf-8"))
    assert len(exp_json["cards_event"]) == 20
    assert exp_json["cards_event"][0]["card_id"] == "1"

    r_csv = seeded_client.post(
        "/api/deck/export?format=cardcsv",
        json={"conditions": {"disaster_type": "地震", "shelter": "小平第五小学校"}},
    )
    assert r_csv.status_code == 200
    assert r_csv.content.startswith(b"\xef\xbb\xbf")


def test_ap_19_saved_decks_crud_and_changed_detection(seeded_client: TestClient):
    """AP-19: デッキ条件の保存・取得・更新・削除。編集後に取得すると changed=true."""
    r_create = seeded_client.post(
        "/api/decks",
        json={
            "name": "第五小デッキ",
            "conditions": {"disaster_type": "地震", "shelter": "小平第五小学校"},
            "manual_order": ["GRP-001", "EV-001"],
        },
    )
    assert r_create.status_code == 201
    did = r_create.json()["id"]
    assert r_create.json()["changed"] is False

    # イベントを1件編集
    ev20 = seeded_client.get("/api/events/EV-020").json()
    ev20["relative_timing"] = ["先頭（開所・初期）"]
    seeded_client.put("/api/events/EV-020", json=ev20)

    r_get = seeded_client.get(f"/api/decks/{did}")
    assert r_get.status_code == 200
    assert r_get.json()["changed"] is True
    assert r_get.json()["can_reapply_manual"] is True

    r_put = seeded_client.put(f"/api/decks/{did}", json={"name": "第五小デッキ更新"})
    assert r_put.status_code == 200
    assert r_put.json()["name"] == "第五小デッキ更新"

    r_del = seeded_client.delete(f"/api/decks/{did}")
    assert r_del.status_code == 204
    assert seeded_client.get(f"/api/decks/{did}").status_code == 404
