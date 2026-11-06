"""API 結合テスト: バージョン管理 (AP-20)."""
from __future__ import annotations

import json
from fastapi.testclient import TestClient


def test_ap_20_versions_lifecycle(seeded_client: TestClient, s2_payload: dict):
    """AP-20: バージョンの作成・一覧・差分・復元・出力・削除 → VE と同じ結果."""
    r_create = seeded_client.post(
        "/api/versions",
        json={"label": "初期リリース", "note": "メモ1"},
    )
    assert r_create.status_code == 201
    vid = r_create.json()["id"]

    r_list = seeded_client.get("/api/versions")
    assert r_list.status_code == 200
    assert any(v["id"] == vid for v in r_list.json())

    # 名前・メモ変更
    r_patch = seeded_client.patch(
        f"/api/versions/{vid}",
        json={"label": "初期リリース改", "note": "メモ2"},
    )
    assert r_patch.status_code == 200
    assert r_patch.json()["label"] == "初期リリース改"

    # イベントを削除して差分確認
    seeded_client.delete("/api/events/EV-020")
    r_diff = seeded_client.get(f"/api/versions/{vid}/diff")
    assert r_diff.status_code == 200
    assert r_diff.json()["has_changes"] is True
    assert "EV-020" in r_diff.json()["cards_event"]["deleted"]

    # JSON 出力
    r_exp = seeded_client.get(f"/api/versions/{vid}/export")
    assert r_exp.status_code == 200
    assert json.loads(r_exp.content.decode("utf-8")) == s2_payload

    # 復元
    r_rest = seeded_client.post(f"/api/versions/{vid}/restore")
    assert r_rest.status_code == 200
    assert len(seeded_client.get("/api/events").json()) == 20

    # 削除
    r_del = seeded_client.delete(f"/api/versions/{vid}")
    assert r_del.status_code == 204
    assert seeded_client.get(f"/api/versions/{vid}").status_code == 404
