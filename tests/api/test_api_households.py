"""API 結合テスト: 世帯・構成員 (AP-05, AP-06, AP-07)."""
from __future__ import annotations

import copy
from fastapi.testclient import TestClient


def test_ap_05_create_household_with_persons_and_pet(client: TestClient, s2_payload: dict):
    """AP-05: 世帯の作成（人物2名・ペット1匹） → 201。member_count=2、pet_count=1."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m2 = copy.deepcopy(s2_payload["group_members"][1])
    pet = copy.deepcopy(next(m for m in s2_payload["group_members"] if m["data_type"] == "ペット"))

    r = client.post("/api/households", json={"group": grp, "members": [m1, m2, pet]})
    assert r.status_code == 201
    data = r.json()
    assert data["group"]["group_id"] == "GRP-001"
    assert data["group"]["member_count"] == 2
    assert data["group"]["pet_count"] == 1
    assert len(data["members"]) == 3


def test_ap_06_update_household_recalculates_counts(client: TestClient, s2_payload: dict):
    """AP-06: 世帯の更新（構成員の追加・削除） → 人数が再計算される."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m2 = copy.deepcopy(s2_payload["group_members"][1])
    created = client.post("/api/households", json={"group": grp, "members": [m1, m2]}).json()
    gid = created["group"]["group_id"]

    # 人物1名だけにする
    r_put = client.put(
        f"/api/households/{gid}",
        json={"group": created["group"], "members": [created["members"][0]]},
    )
    assert r_put.status_code == 200
    assert r_put.json()["group"]["member_count"] == 1

    # 世帯削除
    r_del = client.delete(f"/api/households/{gid}")
    assert r_del.status_code == 204
    assert client.get(f"/api/households/{gid}").status_code == 404


def test_ap_07_delete_single_member_and_409_on_last_person(client: TestClient, s2_payload: dict):
    """AP-07: 構成員を1人だけ削除 DELETE /api/members/{id} → 204。最後の人物なら 409."""
    grp = copy.deepcopy(s2_payload["evacuee_groups"][0])
    m1 = copy.deepcopy(s2_payload["group_members"][0])
    m2 = copy.deepcopy(s2_payload["group_members"][1])
    created = client.post("/api/households", json={"group": grp, "members": [m1, m2]}).json()

    mid1 = created["members"][0]["member_id"]
    mid2 = created["members"][1]["member_id"]

    r1 = client.delete(f"/api/members/{mid2}")
    assert r1.status_code == 204

    r2 = client.delete(f"/api/members/{mid1}")
    assert r2.status_code == 409
    assert "errors" in r2.json()

    assert client.delete("/api/members/M-9999").status_code == 404
