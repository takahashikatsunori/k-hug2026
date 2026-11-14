"""イラスト管理・双方向同期・バッチプロンプト生成の単体テスト (IM-01〜IM-10)."""
from __future__ import annotations

import base64
import io
import os
import time
import zipfile
from pathlib import Path

import pytest

from hugdb.config import get_images_dir
from hugdb.db import connect, init_db
from hugdb.images import (
    PNG_SIGNATURE,
    apply_batch_slices,
    build_all_card_models,
    delete_card_image,
    export_images_zip,
    generate_batches,
    get_card_image,
    get_image_meta_map,
    import_images_zip,
    save_card_image,
    sync_images,
)
from hugdb.repository import NotFoundError, Repository


def _make_sample_png(tag: bytes = b"test") -> bytes:
    """PNGシグネチャ付きのテスト用バイナリデータを生成する."""
    return PNG_SIGNATURE + b"\x00\x00\x00\rIHDR" + tag


def _seed_sample_cards(repo: Repository) -> None:
    """テスト用のイベント・世帯・構成員（人物・ペット）を登録する."""
    for i in range(1, 11):
        repo.create_event(
            {
                "event_name": f"テストイベント{i}",
                "category": ["避難所管理"],
                "priority": 5,
                "difficulty": "中級",
                "must_respond": "なし",
                "source": "避難所本部",
                "scene_description": f"イベント{i}の情景",
                "content": f"イベント{i}の発生内容です。",
                "training_point": f"イベント{i}のポイント",
            }
        )

    members = []
    for i in range(1, 16):
        members.append(
            {
                "data_type": "人物",
                "name": "" if i == 1 else f"避難者{i}",
                "age": 20 + i,
                "gender": "男性" if i % 2 == 1 else "女性",
                "relationship": "世帯主" if i == 1 else "子",
                "vulnerabilities": ["車椅子"] if i == 2 else [],
                "health_condition": ["良好", "発熱"] if i == 3 else ["良好"],
                "skills": ["医療関係"] if i == 4 else [],
                "appearance": f"人物{i}の服装と様子",
                "statement": f"人物{i}の受付での発言です。",
                "training_point": f"人物{i}の対応ポイント",
            }
        )
    for i in range(1, 4):
        members.append(
            {
                "data_type": "ペット",
                "name": f"ポチ{i}",
                "age": i,
                "gender": None,
                "pet_type": "犬",
                "pet_health_condition": ["ケガ"] if i == 1 else [],
                "pet_vulnerabilities": ["無駄吠え・夜鳴き"] if i == 2 else [],
                "pet_skills": [],
                "appearance": f"中型犬{i}、おとなしい",
                "training_point": f"ペット{i}の対応ポイント",
            }
        )

    repo.save_household(
        {
            "group_name": "テスト大家族世帯",
            "evacuation_origin": "天神町１丁目",
            "urgency_level": "通常",
            "personal_equipment": [],
        },
        members,
        is_create=True,
    )


def test_im_01_card_images_crud(tmp_path: Path) -> None:
    """IM-01: card_images テーブル CRUD (登録・取得・上書き更新・削除)."""
    db_path = tmp_path / "im01.db"
    conn = connect(db_path)
    try:
        png1 = _make_sample_png(b"ev001_v1")
        meta1 = save_card_image(conn, "EV-001", png1)
        assert meta1["target_id"] == "EV-001"
        assert meta1["target_kind"] == "event"

        rec1 = get_card_image(conn, "EV-001")
        assert rec1["image_data"] == png1
        assert (get_images_dir(db_path) / "EV-001.png").read_bytes() == png1

        # 上書き更新
        png2 = _make_sample_png(b"ev001_v2")
        save_card_image(conn, "EV-001", png2)
        rec2 = get_card_image(conn, "EV-001")
        assert rec2["image_data"] == png2
        assert (get_images_dir(db_path) / "EV-001.png").read_bytes() == png2

        # 構成員IDでも登録
        png_mem = _make_sample_png(b"m0001")
        save_card_image(conn, "M-0001", png_mem)
        assert set(get_image_meta_map(conn).keys()) == {"EV-001", "M-0001"}

        # 削除
        deleted = delete_card_image(conn, "EV-001")
        assert deleted is True
        with pytest.raises(NotFoundError):
            get_card_image(conn, "EV-001")
        assert not (get_images_dir(db_path) / "EV-001.png").exists()
        with pytest.raises(NotFoundError):
            delete_card_image(conn, "EV-001")
    finally:
        conn.close()


def test_im_02_sync_db_to_filesystem(tmp_path: Path) -> None:
    """IM-02: DBのみに画像がある状態で sync_images() を呼ぶと data/images/{ID}.png が自動出力される."""
    db_path = tmp_path / "im02.db"
    conn = connect(db_path)
    try:
        png = _make_sample_png(b"db_only")
        conn.execute(
            "INSERT INTO card_images (target_id, target_kind, mime_type, image_data, sha256, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("EV-002", "event", "image/png", png, "dummysha", "2026-11-01T10:00:00Z"),
        )
        conn.commit()

        file_path = get_images_dir(db_path) / "EV-002.png"
        assert not file_path.exists()

        res = sync_images(conn)
        assert res["restored_to_disk"] == 1
        assert file_path.exists()
        assert file_path.read_bytes() == png
    finally:
        conn.close()


def test_im_03_sync_filesystem_to_db(tmp_path: Path) -> None:
    """IM-03: data/images/EV-005.png を直接配置して sync_images() を呼ぶと card_images テーブルに自動取込される."""
    db_path = tmp_path / "im03.db"
    conn = connect(db_path)
    try:
        img_dir = get_images_dir(db_path)
        png = _make_sample_png(b"fs_only_ev005")
        (img_dir / "EV-005.png").write_bytes(png)

        res = sync_images(conn)
        assert res["imported_from_disk"] == 1

        rec = get_card_image(conn, "EV-005")
        assert rec["image_data"] == png
        assert rec["target_kind"] == "event"
    finally:
        conn.close()


def test_im_04_sync_mtime_comparison(tmp_path: Path) -> None:
    """IM-04: フォルダ側ファイルがDBの内容と異なり更新された場合、DB側が新しいファイル内容で更新される."""
    db_path = tmp_path / "im04.db"
    conn = connect(db_path)
    try:
        old_png = _make_sample_png(b"old_version")
        save_card_image(conn, "M-0001", old_png)

        file_path = get_images_dir(db_path) / "M-0001.png"
        new_png = _make_sample_png(b"newer_fs_version")
        file_path.write_bytes(new_png)
        future_ts = time.time() + 120.0
        os.utime(file_path, (future_ts, future_ts))

        res = sync_images(conn)
        assert res["imported_from_disk"] == 1

        rec = get_card_image(conn, "M-0001")
        assert rec["image_data"] == new_png
    finally:
        conn.close()


def test_im_05_batch_prompt_evacuee_12(tmp_path: Path) -> None:
    """IM-05: 避難者バッチプロンプト生成 (15名 → 12枚＋3枚の2バッチ、template_people_12v2.png 指定、自動命名補完)."""
    db_path = tmp_path / "im05.db"
    conn = connect(db_path)
    try:
        repo = Repository(conn)
        _seed_sample_cards(repo)

        # 自動命名補完と良好除外の確認
        models = build_all_card_models(conn)
        m1 = next(c for c in models if c["original_id"] == "M-0001")
        assert m1["name"] != ""  # 空欄だった名前が fill_household_names で自動補完されている
        m3 = next(c for c in models if c["original_id"] == "M-0003")
        assert "良好" not in m3["detailedFlags"]
        assert "発熱" in m3["detailedFlags"]

        batches = generate_batches(conn, batch_type="避難者", only_missing=False)
        assert len(batches) == 2
        b1, b2 = batches[0], batches[1]
        assert len(b1["targetCards"]) == 12
        assert len(b2["targetCards"]) == 3
        assert b1["cols"] == 4 and b1["rows"] == 3
        assert b1["templateFileName"] == "template_people_12v2.png"
        assert "4列×3行のグリッド状に12人の人物" in b1["prompt"]
        assert "左から1番目、上から1番目:" in b1["prompt"]
        assert "左から4番目、上から3番目:" in b1["prompt"]
    finally:
        conn.close()


def test_im_06_batch_prompt_pet_12(tmp_path: Path) -> None:
    """IM-06: ペットバッチプロンプト生成 (4×3、template_pets.png、ペット指示)."""
    db_path = tmp_path / "im06.db"
    conn = connect(db_path)
    try:
        repo = Repository(conn)
        _seed_sample_cards(repo)

        batches = generate_batches(conn, batch_type="ペット", only_missing=False)
        assert len(batches) == 1
        b = batches[0]
        assert len(b["targetCards"]) == 3
        assert b["cols"] == 4 and b["rows"] == 3
        assert b["templateFileName"] == "template_pets.png"
        assert "4列×3行のグリッド状に12匹のペット" in b["prompt"]
        assert "左から1番目、上から1番目: 【名前・種類】ポチ1" in b["prompt"]
    finally:
        conn.close()


def test_im_07_batch_prompt_event_9(tmp_path: Path) -> None:
    """IM-07: イベントバッチプロンプト生成 (10枚 → 9枚＋1枚の2バッチ、3×3、template_events_9.png)."""
    db_path = tmp_path / "im07.db"
    conn = connect(db_path)
    try:
        repo = Repository(conn)
        _seed_sample_cards(repo)

        batches = generate_batches(conn, batch_type="イベント", only_missing=False)
        assert len(batches) == 2
        b1, b2 = batches[0], batches[1]
        assert len(b1["targetCards"]) == 9
        assert len(b2["targetCards"]) == 1
        assert b1["cols"] == 3 and b1["rows"] == 3
        assert b1["templateFileName"] == "template_events_9.png"
        assert "3列×3行のグリッド状に9個のイラスト" in b1["prompt"]
        assert "左から3番目、上から3番目:" in b1["prompt"]
    finally:
        conn.close()


def test_im_08_only_missing_cards_batch(tmp_path: Path) -> None:
    """IM-08: 既に画像があるカードを除外し、未設定カードのみでバッチを生成できる."""
    db_path = tmp_path / "im08.db"
    conn = connect(db_path)
    try:
        repo = Repository(conn)
        _seed_sample_cards(repo)

        # EV-001, EV-002 に画像を登録
        save_card_image(conn, "EV-001", _make_sample_png(b"ev1"))
        save_card_image(conn, "EV-002", _make_sample_png(b"ev2"))

        batches = generate_batches(conn, batch_type="イベント", only_missing=True)
        # 10枚中2枚設定済み → 残り8枚なので1バッチ(8枚)に収まる
        assert len(batches) == 1
        target_ids = [c["original_id"] for c in batches[0]["targetCards"]]
        assert len(target_ids) == 8
        assert "EV-001" not in target_ids
        assert "EV-002" not in target_ids
        assert "EV-003" in target_ids
    finally:
        conn.close()


def test_im_09_apply_batch_slices_cherry_pick_and_reassign(tmp_path: Path) -> None:
    """IM-09: バッチ分割画像のセル選択採用 (enabled=True/False) 及び割当先カードID変更."""
    db_path = tmp_path / "im09.db"
    conn = connect(db_path)
    try:
        repo = Repository(conn)
        _seed_sample_cards(repo)
        batches = generate_batches(conn, batch_type="イベント", only_missing=True)
        batch_id = batches[0]["id"]

        b64_cell1 = base64.b64encode(_make_sample_png(b"cell1_for_ev001")).decode("ascii")
        b64_cell2 = base64.b64encode(_make_sample_png(b"cell2_disabled")).decode("ascii")
        b64_cell3 = base64.b64encode(_make_sample_png(b"cell3_reassigned_to_ev009")).decode("ascii")

        res = apply_batch_slices(
            conn,
            batch_id,
            [
                {"target_id": "EV-001", "image_base64": f"data:image/png;base64,{b64_cell1}", "enabled": True},
                {"target_id": "EV-002", "image_base64": b64_cell2, "enabled": False},
                {"target_id": "EV-009", "image_base64": b64_cell3, "enabled": True},
            ],
        )
        assert res["saved_count"] == 2
        assert set(res["saved_ids"]) == {"EV-001", "EV-009"}
        assert get_card_image(conn, "EV-001") is not None
        with pytest.raises(NotFoundError):
            get_card_image(conn, "EV-002")
        rec9 = get_card_image(conn, "EV-009")
        assert rec9["image_data"] == _make_sample_png(b"cell3_reassigned_to_ev009")
    finally:
        conn.close()


def test_im_10_export_and_import_images_zip(tmp_path: Path) -> None:
    """IM-10: 全イラストのZIPエクスポートと別DB環境へのZIPインポート."""
    db1_path = tmp_path / "dir1" / "im10_src.db"
    conn1 = connect(db1_path)
    try:
        png_ev = _make_sample_png(b"zip_ev001")
        png_mem = _make_sample_png(b"zip_m0002")
        save_card_image(conn1, "EV-001", png_ev)
        save_card_image(conn1, "M-0002", png_mem)

        zip_bytes = export_images_zip(conn1)
    finally:
        conn1.close()

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        names = set(zf.namelist())
        assert "EV-001.png" in names
        assert "M-0002.png" in names

    # 別DBへインポート
    db2_path = tmp_path / "dir2" / "im10_dst.db"
    conn2 = connect(db2_path)
    try:
        imp_res = import_images_zip(conn2, zip_bytes)
        assert imp_res["imported_count"] == 2
        assert set(imp_res["imported_ids"]) == {"EV-001", "M-0002"}

        rec_ev = get_card_image(conn2, "EV-001")
        assert rec_ev["image_data"] == png_ev
        assert (get_images_dir(db2_path) / "M-0002.png").read_bytes() == png_mem
    finally:
        conn2.close()


def test_im_11_card_models_include_group_positions(tmp_path: Path) -> None:
    """IM-11: build_all_card_models が各世帯の構成員（人物・ペット含む）に group_index / group_total を付与する."""
    db_path = tmp_path / "im11.db"
    conn = connect(db_path)
    try:
        repo = Repository(conn)
        _seed_sample_cards(repo)

        models = build_all_card_models(conn)
        grp1_models = [m for m in models if m.get("group_id") == "GRP-001"]
        assert len(grp1_models) > 1
        assert all(m["group_total"] == len(grp1_models) for m in grp1_models)
        assert sorted(m["group_index"] for m in grp1_models) == list(
            range(1, len(grp1_models) + 1)
        )
    finally:
        conn.close()

