"""API 結合テスト: 検索・エクスポート・保存済み検索 (AP-08, AP-09, AP-10)."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_ap_08_post_search(seeded_client: TestClient):
    """AP-08: POST /api/search（FI のいくつかのケース） → unit テストと同じ結果."""
    r1 = seeded_client.post("/api/search", json={"keyword": "毛布"})
    assert r1.status_code == 200
    assert [e["card_id"] for e in r1.json()["events"]] == ["EV-006"]

    r2 = seeded_client.post(
        "/api/search",
        json={"view": "event", "fields": [{"field": "category", "op": "any", "value": ["行政対応"]}]},
    )
    assert r2.status_code == 200
    assert len(r2.json()["events"]) == 6

    r_bad = seeded_client.post(
        "/api/search",
        json={"fields": [{"field": "unknown_field", "op": "any", "value": ["x"]}]},
    )
    assert r_bad.status_code == 422


def test_ap_09_search_export_formats_and_headers(seeded_client: TestClient):
    """AP-09: 検索結果の出力（json/cardcsv/fullcsv） → Content-Type、Content-Disposition の日本語ファイル名（RFC 5987）."""
    r_json = seeded_client.post("/api/search/export?format=json", json={"keyword": "毛布"})
    assert r_json.status_code == 200
    assert "application/json" in r_json.headers["content-type"]
    assert "filename*=UTF-8''" in r_json.headers["content-disposition"]

    r_csv = seeded_client.post("/api/search/export?format=cardcsv", json={"keyword": "毛布"})
    assert r_csv.status_code == 200
    assert "text/csv" in r_csv.headers["content-type"]
    assert r_csv.content.startswith(b"\xef\xbb\xbf")

    r_zip = seeded_client.post("/api/search/export?format=fullcsv", json={"keyword": "毛布"})
    assert r_zip.status_code == 200
    assert "application/zip" in r_zip.headers["content-type"]


def test_ap_10_saved_searches_lifecycle(seeded_client: TestClient):
    """AP-10: 保存済み検索を作成 → 再表示 → 削除 → 保存した時点の結果のIDと条件を返す."""
    r_create = seeded_client.post(
        "/api/saved-searches",
        json={"name": "毛布検索", "filters": {"keyword": "毛布"}, "result_ids": ["EV-006"]},
    )
    assert r_create.status_code == 201
    sid = r_create.json()["id"]

    r_list = seeded_client.get("/api/saved-searches")
    assert r_list.status_code == 200
    assert len(r_list.json()) == 1

    r_get = seeded_client.get(f"/api/saved-searches/{sid}")
    assert r_get.status_code == 200
    body = r_get.json()
    assert body["result_ids"] == ["EV-006"]
    assert body["filters"]["keyword"] == "毛布"
    assert [e["card_id"] for e in body["search_result"]["events"]] == ["EV-006"]

    r_del = seeded_client.delete(f"/api/saved-searches/{sid}")
    assert r_del.status_code == 204
    assert seeded_client.get(f"/api/saved-searches/{sid}").status_code == 404


def test_ap_search_returns_group_map_and_member_positions(seeded_client: TestClient):
    """person/pet ビューでも親グループ情報とグループ内順番 (group_index / group_total) を取得できる."""
    for view_name, list_key in (("person", "persons"), ("pet", "pets")):
        r = seeded_client.post("/api/search", json={"view": view_name})
        assert r.status_code == 200
        body = r.json()
        assert len(body[list_key]) > 0
        first = body[list_key][0]
        gid = first["group_id"]
        mid = first["member_id"]
        assert gid in body["group_map"]
        assert body["group_map"][gid]["group_id"] == gid
        assert mid in body["member_positions"]
        pos = body["member_positions"][mid]
        assert 1 <= pos["group_index"] <= pos["group_total"]
