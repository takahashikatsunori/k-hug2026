"""スマホHUG訓練ページ (hug-game.html) の配信ルートテスト."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_hug_game_routes_serve_html_and_assets(client: TestClient) -> None:
    """/hug-game.html, /hug-game, /game および関連JS/CSSが正常に配信される."""
    for path in ("/hug-game.html", "/hug-game", "/game"):
        res = client.get(path)
        assert res.status_code == 200
        assert "スマホでHUG訓練" in res.text
        assert "hugGameApp.js" in res.text

    js_res = client.get("/static/js/hugGameApp.js")
    assert js_res.status_code == 200
    assert "小平第五小学校" in js_res.text

    css_res = client.get("/static/css/hugGame.css")
    assert css_res.status_code == 200
    assert ".hg-play-shell" in css_res.text
