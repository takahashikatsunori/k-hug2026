"""イラスト管理 REST API エンドポイントテスト (API-IM-01〜API-IM-05)."""
from __future__ import annotations

import base64
import io
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from hugdb.config import get_images_dir
from hugdb.images import PNG_SIGNATURE


def _sample_png(tag: bytes = b"api_test") -> bytes:
    return PNG_SIGNATURE + b"\x00\x00\x00\rIHDR" + tag


def test_api_im_01_status_and_cards(seeded_client: TestClient) -> None:
    """API-IM-01: GET /api/images/status 及び GET /api/images/cards が全カード状態と件数サマリを返す."""
    resp = seeded_client.get("/api/images/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "counts" in body
    assert "避難者" in body["counts"]
    assert "ペット" in body["counts"]
    assert "イベント" in body["counts"]
    assert body["counts"]["イベント"]["total"] > 0
    assert body["counts"]["避難者"]["total"] > 0
    assert body["image_ids"] == []
    assert isinstance(body["cards"], list)
    assert len(body["cards"]) > 0

    cards_resp = seeded_client.get("/api/images/cards")
    assert cards_resp.status_code == 200
    cards_body = cards_resp.json()
    assert len(cards_body["cards"]) == len(body["cards"])


def test_api_im_02_single_card_image_crud(seeded_client: TestClient, db_path: Path) -> None:
    """API-IM-02: PUT / GET / DELETE /api/images/{card_id} の動作と未登録IDの404応答."""
    # 未登録時は 404
    r404 = seeded_client.get("/api/images/EV-001")
    assert r404.status_code == 404

    # JSON(Base64) で PUT
    png1 = _sample_png(b"ev001_b64")
    b64_str = base64.b64encode(png1).decode("ascii")
    put_resp = seeded_client.put(
        "/api/images/EV-001",
        json={"image_base64": f"data:image/png;base64,{b64_str}"},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["target_id"] == "EV-001"

    # GET で image/png が返る & data/images/EV-001.png にも保存されている
    get_resp = seeded_client.get("/api/images/EV-001")
    assert get_resp.status_code == 200
    assert get_resp.headers["content-type"].startswith("image/png")
    assert get_resp.content == png1
    assert (get_images_dir(db_path) / "EV-001.png").read_bytes() == png1

    # マルチパートファイルアップロードで PUT 上書き
    png2 = _sample_png(b"ev001_multipart")
    put_mp = seeded_client.put(
        "/api/images/EV-001",
        files={"file": ("EV-001.png", png2, "image/png")},
    )
    assert put_mp.status_code == 200
    assert seeded_client.get("/api/images/EV-001").content == png2

    # DELETE
    del_resp = seeded_client.delete("/api/images/EV-001")
    assert del_resp.status_code == 204
    assert seeded_client.get("/api/images/EV-001").status_code == 404
    assert not (get_images_dir(db_path) / "EV-001.png").exists()


def test_api_im_03_generate_batches(seeded_client: TestClient) -> None:
    """API-IM-03: POST /api/images/batches/generate が種別ごとのバッチプロンプト一覧を生成・返却する."""
    resp = seeded_client.post(
        "/api/images/batches/generate",
        json={"type": "イベント", "only_missing": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    batches = data["batches"]
    assert len(batches) >= 1
    first = batches[0]
    assert first["type"] == "イベント"
    assert first["cols"] == 3 and first["rows"] == 3
    assert first["templateFileName"] == "template_events_9.png"
    assert "3列×3行" in first["prompt"]


def test_api_im_04_apply_batch_slices(seeded_client: TestClient, db_path: Path) -> None:
    """API-IM-04: POST /api/images/batches/{batch_id}/apply が選択セルをDB・フォルダ双方へ一括保存する."""
    gen_resp = seeded_client.post(
        "/api/images/batches/generate",
        json={"type": "避難者", "only_missing": True},
    )
    assert gen_resp.status_code == 200
    batch = gen_resp.json()["batches"][0]
    batch_id = batch["id"]
    target_cards = batch["targetCards"]
    assert len(target_cards) >= 2

    id_a = target_cards[0]["original_id"]
    id_b = target_cards[1]["original_id"]
    png_a = _sample_png(b"slice_a")
    png_b = _sample_png(b"slice_b")

    apply_resp = seeded_client.post(
        f"/api/images/batches/{batch_id}/apply",
        json={
            "slices": [
                {
                    "target_id": id_a,
                    "image_base64": base64.b64encode(png_a).decode("ascii"),
                    "enabled": True,
                },
                {
                    "target_id": id_b,
                    "image_base64": base64.b64encode(png_b).decode("ascii"),
                    "enabled": False,
                },
            ]
        },
    )
    assert apply_resp.status_code == 200
    res = apply_resp.json()
    assert res["saved_count"] == 1
    assert res["saved_ids"] == [id_a]
    assert (get_images_dir(db_path) / f"{id_a}.png").read_bytes() == png_a
    assert not (get_images_dir(db_path) / f"{id_b}.png").exists()


def test_api_im_05_sync_and_zip_io(seeded_client: TestClient, db_path: Path) -> None:
    """API-IM-05: POST /api/images/sync, GET /api/images/export/zip, POST /api/images/import/zip の動作確認."""
    # ファイルシステムに直接配置して /api/images/sync
    img_dir = get_images_dir(db_path)
    png_ev = _sample_png(b"sync_ev001")
    (img_dir / "EV-001.png").write_bytes(png_ev)

    sync_resp = seeded_client.post("/api/images/sync")
    assert sync_resp.status_code == 200
    assert sync_resp.json()["sync"]["imported_from_disk"] == 1

    # ZIP エクスポート
    zip_resp = seeded_client.get("/api/images/export/zip")
    assert zip_resp.status_code == 200
    assert zip_resp.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(zip_resp.content), "r") as zf:
        assert "EV-001.png" in zf.namelist()

    # 一旦削除してから ZIP インポートで復元確認
    seeded_client.delete("/api/images/EV-001")
    assert seeded_client.get("/api/images/EV-001").status_code == 404

    imp_resp = seeded_client.post(
        "/api/images/import/zip",
        files={"file": ("hug_card_images.zip", zip_resp.content, "application/zip")},
    )
    assert imp_resp.status_code == 200
    assert imp_resp.json()["imported_count"] == 1
    assert seeded_client.get("/api/images/EV-001").content == png_ev
