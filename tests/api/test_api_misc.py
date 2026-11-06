"""API 結合テストおよび非機能テスト (AP-01, AP-15, AP-21, AP-22, NF-01, NF-02, NF-03)."""
from __future__ import annotations

import copy
import time
from fastapi.testclient import TestClient

from hugdb import config
from hugdb.deck import build_deck
from hugdb.filtering import SearchQuery, execute_search


def test_ap_01_get_schema(client: TestClient):
    """AP-01: GET /api/schema → 200。SC-07 の構造."""
    r = client.get("/api/schema")
    assert r.status_code == 200
    data = r.json()
    assert "events" in data and "groups" in data and "members" in data


def test_ap_15_get_holiday_types(client: TestClient):
    """AP-15: GET /api/holiday-types?date=2026-05-03 → {土日, 祝日, 大型連休}。不正な日付は 422."""
    r = client.get("/api/holiday-types?date=2026-05-03")
    assert r.status_code == 200
    assert set(r.json()["holiday_types"]) == {"土日", "祝日", "大型連休"}

    r_bad = client.get("/api/holiday-types?date=invalid-date")
    assert r_bad.status_code == 422
    assert "errors" in r_bad.json()


def test_ap_21_static_files_served(client: TestClient):
    """AP-21: 静的ファイル / と /static/js/app.js → 200."""
    r_root = client.get("/")
    assert r_root.status_code == 200
    assert "text/html" in r_root.headers["content-type"]

    r_js = client.get("/static/js/app.js")
    assert r_js.status_code == 200


def test_ap_22_nonexistent_api_path_404_json(client: TestClient):
    """AP-22: 存在しないパス /api/xxx → 404 の JSON."""
    r = client.get("/api/nonexistent_endpoint")
    assert r.status_code == 404
    body = r.json()
    assert "detail" in body
    assert isinstance(body.get("errors"), list)


def test_nf_01_performance_1000_units_under_1_second(s2_payload: dict):
    """NF-01: 1,000単位のデータで検索とデッキ構築 → それぞれ 1 秒未満."""
    events = []
    groups = []
    members = []

    base_events = s2_payload["cards_event"]
    base_groups = s2_payload["evacuee_groups"]
    base_members = s2_payload["group_members"]

    # 35サイクル × (20イベント + 10世帯) = 1,050単位
    ev_seq = 0
    grp_seq = 0
    mem_seq = 0
    for _ in range(35):
        ev_map = {}
        for ev in base_events:
            ev_seq += 1
            cid = f"EV-{ev_seq:04d}"
            ev_map[ev["card_id"]] = cid
            new_ev = copy.deepcopy(ev)
            new_ev["card_id"] = cid
            if new_ev.get("prerequisite_card_id") in ev_map:
                new_ev["prerequisite_card_id"] = ev_map[new_ev["prerequisite_card_id"]]
            else:
                new_ev["prerequisite_card_id"] = None
            events.append(new_ev)

        grp_map = {}
        for grp in base_groups:
            grp_seq += 1
            gid = f"GRP-{grp_seq:04d}"
            grp_map[grp["group_id"]] = gid
            new_grp = copy.deepcopy(grp)
            new_grp["group_id"] = gid
            groups.append(new_grp)

        for mem in base_members:
            mem_seq += 1
            mid = f"M-{mem_seq:05d}"
            new_mem = copy.deepcopy(mem)
            new_mem["member_id"] = mid
            new_mem["group_id"] = grp_map[mem["group_id"]]
            members.append(new_mem)

    assert len(events) + len(groups) >= 1000

    t0 = time.perf_counter()
    sr = execute_search(SearchQuery(keyword="毛布"), events, groups, members)
    t_search = time.perf_counter() - t0
    assert len(sr.events) == 35
    assert t_search < 1.0, f"検索に {t_search:.3f}s かかりました"

    t1 = time.perf_counter()
    deck = build_deck(
        events,
        groups,
        members,
        {"disaster_type": "地震", "shelter": "小平第五小学校"},
    )
    t_deck = time.perf_counter() - t1
    assert deck.stats["total_units"] == 1050
    assert t_deck < 1.0, f"デッキ構築に {t_deck:.3f}s かかりました"


def test_nf_02_server_binds_only_to_localhost():
    """NF-02: サーバーが 127.0.0.1 だけで待ち受けている → 設定の既定値を確認する."""
    assert config.HOST == "127.0.0.1"


def test_nf_03_unified_error_response_structure(client: TestClient):
    """NF-03: API のエラーの形式がすべて {'detail': ..., 'errors': [...]} に統一されている."""
    responses = [
        client.get("/api/events/EV-999"),  # 404 NotFoundError
        client.post("/api/events", json={}),  # 422 ValidationError
        client.post("/api/clear", json={"confirm": "wrong"}),  # 400 HTTPException
        client.get("/api/holiday-types"),  # 422 RequestValidationError (missing query)
        client.get("/api/unknown-route"),  # 404 StarletteHTTPException
    ]
    for resp in responses:
        assert resp.status_code >= 400
        body = resp.json()
        assert isinstance(body.get("detail"), str)
        assert isinstance(body.get("errors"), list)
        assert len(body["errors"]) >= 1
        for err in body["errors"]:
            assert "field" in err
            assert "message" in err
            assert "record_id" in err
