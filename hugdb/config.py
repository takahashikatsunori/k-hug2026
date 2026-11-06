"""アプリケーション設定モジュール."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "hug_cards.db"
SAMPLE_PATH = BASE_DIR / "docs" / "sample_format2.json"
DESIGN_DOC_PATH = BASE_DIR / "docs" / "HUGカードデータベース詳細設計書 V6.2.md"

HOST = "127.0.0.1"
PORT = 8000

MAX_IMPORT_BYTES = 10 * 1024 * 1024  # 10 MB
AUTO_VERSION_LIMIT = 20

# 大型連休（GW: 4/29〜5/6、お盆: 8/13〜8/16）
LONG_HOLIDAY_PERIODS: list[tuple[tuple[int, int], tuple[int, int]]] = [
    ((4, 29), (5, 6)),
    ((8, 13), (8, 16)),
]

# 年末年始（12/29〜1/3）
YEAR_END_PERIODS: list[tuple[tuple[int, int], tuple[int, int]]] = [
    ((12, 29), (1, 3)),
]

# 全項目CSVにおける配列の結合文字
CSV_ARRAY_JOINER = "、"


def get_db_path() -> Path:
    """現在のデータベースファイルパスを返す（環境変数 HUGDB_DB_PATH を優先）."""
    env_path = os.environ.get("HUGDB_DB_PATH")
    if env_path:
        return Path(env_path)
    return DEFAULT_DB_PATH


def get_images_dir(db_path: Path | str | None = None) -> Path:
    """カード用イラスト画像の保存ディレクトリを返し、存在しなければ作成する."""
    resolved_db = Path(db_path) if db_path is not None else get_db_path()
    img_dir = resolved_db.resolve().parent / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    return img_dir
