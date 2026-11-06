"""API 結合テスト: インポート・デモ読込・エクスポート・全件削除 (AP-11, AP-12, AP-13, AP-14)."""
from __future__ import annotations

import json
from pathlib import Path
from fastapi.testclient import TestClient

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
SPLIT_EV_GRP_PATH = FIXTURES_DIR / "events_groups_only.json"
SPLIT_MEM_PATH = FIXTURES_DIR / "members_only.json"


def test_ap_11_multipart_import_replace_append_dry_run(client: TestClient):
    """AP-11: インポート（multipart で複数ファイル、replace/append、dry_run） → IJ と同じ結果."""
    files = [
        ("files", ("events_groups_only.json", SPLIT_EV_GRP_PATH.read_bytes(), "application/json")),
        ("files", ("members_only.json", SPLIT_MEM_PATH.read_bytes(), "application/json")),
    ]
    r_dry = client.post("/api/import?mode=replace&dry_run=true", files=files)
    assert r_dry.status_code == 200
    assert r_dry.json()["counts"] == {"events": 20, "groups": 10, "members": 21}
    assert client.get("/api/events").json() == []

    r_rep = client.post("/api/import?mode=replace&dry_run=false", files=files)
    assert r_rep.status_code == 200
    assert len(client.get("/api/events").json()) == 20

    r_app = client.post("/api/import?mode=append&dry_run=false", files=files)
    assert r_app.status_code == 200
    assert len(client.get("/api/events").json()) == 40


def test_ap_12_import_demo(client: TestClient):
    """AP-12: POST /api/import/demo → 200。20/10/21 件."""
    r = client.post("/api/import/demo?mode=replace")
    assert r.status_code == 200
    assert r.json()["counts"] == {"events": 20, "groups": 10, "members": 21}


def test_ap_13_export_json(seeded_client: TestClient, s2_payload: dict):
    """AP-13: GET /api/export/json → IJ-01 と同じ."""
    r = seeded_client.get("/api/export/json")
    assert r.status_code == 200
    exported = json.loads(r.content.decode("utf-8"))
    assert exported == s2_payload


def test_ap_14_clear_database_confirmation(seeded_client: TestClient):
    """AP-14: POST /api/clear（確認文字列が正しい／違う） → 200 / 400."""
    r_bad = seeded_client.post("/api/clear", json={"confirm": "キャンセル"})
    assert r_bad.status_code == 400
    assert "errors" in r_bad.json()
    assert len(seeded_client.get("/api/events").json()) == 20

    r_ok = seeded_client.post("/api/clear", json={"confirm": "削除", "include_saved": True})
    assert r_ok.status_code == 200
    assert seeded_client.get("/api/events").json() == []
