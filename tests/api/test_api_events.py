"""API 結合テスト: イベントカード (AP-02, AP-03, AP-04)."""
from __future__ import annotations

import copy
from fastapi.testclient import TestClient


def test_ap_02_event_crud_and_ignores_body_card_id(client: TestClient, s2_payload: dict):
    """AP-02: イベントの作成・取得・更新・削除 → 201/200/200/204。IDは自動採番され、本文の card_id は無視する."""
    ev_in = copy.deepcopy(s2_payload["cards_event"][0])
    ev_in["card_id"] = "EV-999"

    r_create = client.post("/api/events", json=ev_in)
    assert r_create.status_code == 201
    created = r_create.json()
    assert created["card_id"] == "EV-001"

    r_list = client.get("/api/events")
    assert r_list.status_code == 200
    assert len(r_list.json()) == 1

    r_get = client.get("/api/events/EV-001")
    assert r_get.status_code == 200
    assert r_get.json()["event_name"] == ev_in["event_name"]

    r_404 = client.get("/api/events/EV-404")
    assert r_404.status_code == 404
    assert "errors" in r_404.json()

    up_data = copy.deepcopy(created)
    up_data["event_name"] = "更新後タイトル"
    r_put = client.put("/api/events/EV-001", json=up_data)
    assert r_put.status_code == 200
    assert r_put.json()["event_name"] == "更新後タイトル"

    r_del = client.delete("/api/events/EV-001")
    assert r_del.status_code == 204
    assert client.get("/api/events/EV-001").status_code == 404


def test_ap_03_create_event_missing_required_fields_422(client: TestClient):
    """AP-03: 必須項目が欠けたイベントを作成 → 422。どの項目のエラーかが分かる配列を返す."""
    r = client.post("/api/events", json={"event_name": "", "category": []})
    assert r.status_code == 422
    body = r.json()
    assert "detail" in body
    assert isinstance(body.get("errors"), list)
    error_fields = {e["field"] for e in body["errors"]}
    assert "event_name" in error_fields
    assert "category" in error_fields


def test_ap_04_delete_event_with_dependents_409_and_force_204(client: TestClient, s2_payload: dict):
    """AP-04: 前提カードになっているイベントを ?force=false で削除 → 409 と依存一覧。force=true なら 204."""
    ev1 = copy.deepcopy(s2_payload["cards_event"][0])
    ev2 = copy.deepcopy(s2_payload["cards_event"][1])
    c1 = client.post("/api/events", json=ev1).json()
    ev2["prerequisite_card_id"] = c1["card_id"]
    c2 = client.post("/api/events", json=ev2).json()

    r_conflict = client.delete(f"/api/events/{c1['card_id']}?force=false")
    assert r_conflict.status_code == 409
    body = r_conflict.json()
    assert c2["card_id"] in body["dependents"]
    assert isinstance(body["errors"], list)

    r_force = client.delete(f"/api/events/{c1['card_id']}?force=true")
    assert r_force.status_code == 204
    ev2_after = client.get(f"/api/events/{c2['card_id']}").json()
    assert ev2_after["prerequisite_card_id"] is None
