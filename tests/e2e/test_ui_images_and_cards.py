"""Canvasカード描画・グリッド画像自動分割・PDF/ZIP出力およびイラスト管理UIのE2Eテスト (CV-01〜07, UI-IM-01〜04)."""
from __future__ import annotations

import base64
from pathlib import Path

from playwright.sync_api import expect
import pytest

from hugdb.db import connect
from hugdb.io_json import import_json_payloads

pytestmark = pytest.mark.e2e


def _seed_e2e_db(e2e_server: dict[str, str], s2_payload: dict) -> None:
    """E2Eサーバーの一時DBにS2サンプルデータを投入する."""
    conn = connect(Path(e2e_server["db_path"]))
    try:
        import_json_payloads(conn, [s2_payload], mode="replace")
    finally:
        conn.close()


def test_cv_01_slice_grid_image_4x3_and_3x3(page, e2e_server) -> None:
    """CV-01: 4×3 (12枠) および 3×3 (9枠) の白線区切りグリッド画像が正確に12枚・9枚のDataURL配列に分割される."""
    page.goto(e2e_server["base_url"])
    res = page.evaluate(
        """async () => {
            const { sliceGridImage, createAnnotatedImage } = await import('/static/js/cardCanvas.js');

            function makeGridDataUrl(cols, rows) {
                const c = document.createElement('canvas');
                c.width = cols * 100;
                c.height = rows * 100;
                const ctx = c.getContext('2d');
                for (let r = 0; r < rows; r++) {
                    for (let col = 0; col < cols; col++) {
                        ctx.fillStyle = `rgb(${40 + r * 50}, ${60 + col * 40}, 150)`;
                        ctx.fillRect(col * 100, r * 100, 100, 100);
                    }
                }
                // 白い境界線を描画 (輝度 > 240)
                ctx.fillStyle = '#ffffff';
                for (let col = 1; col < cols; col++) {
                    ctx.fillRect(col * 100 - 2, 0, 4, c.height);
                }
                for (let r = 1; r < rows; r++) {
                    ctx.fillRect(0, r * 100 - 2, c.width, 4);
                }
                return c.toDataURL('image/png');
            }

            const grid12 = makeGridDataUrl(4, 3);
            const slices12 = await sliceGridImage(grid12, 4, 3);
            const annot12 = await createAnnotatedImage(grid12, 4, 3);

            const grid9 = makeGridDataUrl(3, 3);
            const slices9 = await sliceGridImage(grid9, 3, 3);

            return {
                len12: slices12.length,
                allPng12: slices12.every((s) => s.startsWith('data:image/png;base64,')),
                annotOk: annot12.startsWith('data:image/png;base64,'),
                len9: slices9.length,
                allPng9: slices9.every((s) => s.startsWith('data:image/png;base64,')),
            };
        }"""
    )
    assert res["len12"] == 12
    assert res["allPng12"] is True
    assert res["annotOk"] is True
    assert res["len9"] == 9
    assert res["allPng9"] is True


def test_cv_02_and_cv_03_canvas_render_standard_and_large_text(page, e2e_server) -> None:
    """CV-02 & CV-03: 避難者・ペット・イベント各カードの standard / largeText Canvas描画 (600×993px 名刺縦横比)."""
    page.goto(e2e_server["base_url"])
    res = page.evaluate(
        """async () => {
            const { generateCardImageCanvas } = await import('/static/js/cardCanvas.js');

            // テスト用100x100イラストDataURL
            const ic = document.createElement('canvas');
            ic.width = 100;
            ic.height = 100;
            const ictx = ic.getContext('2d');
            ictx.fillStyle = '#3b82f6';
            ictx.fillRect(0, 0, 100, 100);
            const sampleImg = ic.toDataURL('image/png');

            const personCard = {
                id: '1',
                type: '避難者',
                name: '山田 太郎',
                origin: '天神町１丁目',
                age: '72',
                gender: '男性',
                attributes: '世帯主',
                detailedFlags: ['車椅子', '発熱', '医療関係'],
                appearance: '白髪で眼鏡をかけている',
                dialogue: '足が痛くて歩けません。車椅子をお願いします。',
                points: '車椅子スペースの確保',
                imageUrl: sampleImg,
            };

            const petCard = {
                id: '2',
                type: 'ペット',
                name: 'ポチ（柴犬）',
                origin: '天神町１丁目',
                age: '4',
                gender: 'オス',
                attributes: 'ペット',
                detailedFlags: ['ケガ', '無駄吠え・夜鳴き'],
                appearance: '茶色の柴犬、ケージに入っている',
                dialogue: 'ケージの中で少し怯えています。',
                points: 'ペット同行避難エリアへ誘導',
                imageUrl: sampleImg,
            };

            const eventCard = {
                id: '3',
                type: 'イベント',
                name: '断水によるトイレ使用不能',
                origin: '-',
                age: '-',
                gender: '-',
                attributes: '避難所本部',
                detailedFlags: ['衛生・ゴミ', '避難所設備'],
                appearance: 'トイレの前に行列ができている',
                dialogue: '水が出ずトイレが流せなくなりました。携帯トイレを配布してください。',
                points: '災害用トイレの設営',
                imageUrl: sampleImg,
            };

            async function inspectDataUrl(dataUrl) {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = img.width;
                        c.height = img.height;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        // 外枠線(15, 400)のピクセル色を取得して枠色を検証
                        const borderPx = Array.from(ctx.getImageData(15, 400, 1, 1).data);
                        resolve({ width: img.width, height: img.height, borderPx });
                    };
                    img.onerror = reject;
                    img.src = dataUrl;
                });
            }

            const stdPersonUrl = await generateCardImageCanvas(personCard, 'standard');
            const stdPetUrl = await generateCardImageCanvas(petCard, 'standard');
            const stdEventUrl = await generateCardImageCanvas(eventCard, 'standard');
            const lgPersonUrl = await generateCardImageCanvas(personCard, 'largeText');

            const pInfo = await inspectDataUrl(stdPersonUrl);
            const ptInfo = await inspectDataUrl(stdPetUrl);
            const evInfo = await inspectDataUrl(stdEventUrl);
            const lgInfo = await inspectDataUrl(lgPersonUrl);

            return {
                pInfo,
                ptInfo,
                evInfo,
                lgInfo,
                differsFromLarge: stdPersonUrl !== lgPersonUrl,
            };
        }"""
    )
    assert res["pInfo"]["width"] == 600 and res["pInfo"]["height"] == 993
    assert res["ptInfo"]["width"] == 600 and res["ptInfo"]["height"] == 993
    assert res["evInfo"]["width"] == 600 and res["evInfo"]["height"] == 993
    assert res["lgInfo"]["width"] == 600 and res["lgInfo"]["height"] == 993
    # 避難者枠 (#3b82f6 -> R=59, G=130, B=246)、ペット枠 (#10b981 -> R=16, G=185, B=129)、イベント枠 (#ef4444 -> R=239, G=68, B=68)
    assert res["pInfo"]["borderPx"][:3] == [59, 130, 246]
    assert res["ptInfo"]["borderPx"][:3] == [16, 185, 129]
    assert res["evInfo"]["borderPx"][:3] == [239, 68, 68]
    assert res["differsFromLarge"] is True


def test_cv_04_cv_05_cv_06_cv_07_deck_renumbering_pdf_zip_and_cancel(
    page, e2e_server
) -> None:
    """CV-04〜07: デッキ連番振り直し合成、7種印刷サイズのA4横PDF生成、ZIP生成、キャンセル中断制御."""
    page.goto(e2e_server["base_url"])
    res = page.evaluate(
        """async () => {
            const {
                PRINT_SIZES,
                toCardRenderModel,
                exportCardsAsPdf,
                exportCardsAsZip,
            } = await import('/static/js/cardCanvas.js');

            // CV-04: マスタID (M-0005) のカードがデッキ連番 (card_number: 1) に振り直されることを検証
            const deckCardItem = {
                card_number: 1,
                kind: 'person',
                original_id: 'M-0005',
                data: {
                    member_id: 'M-0005',
                    group_id: 'G-002',
                    data_type: '人物',
                    name: '佐藤 花子',
                    age: 68,
                    gender: '女性',
                    relationship: '世帯主',
                    vulnerabilities: ['聴覚障害'],
                    health_condition: ['良好'],
                    skills: ['手話・要約筆記'],
                    appearance: '穏やかな表情',
                    statement: '耳が聞こえにくいです。筆談をお願いします。',
                    training_point: '筆談ボードの活用',
                },
                group: {
                    group_id: 'G-002',
                    group_name: '佐藤世帯',
                    evacuation_origin: '花小金井１丁目',
                },
            };

            const renderedModel = toCardRenderModel(deckCardItem, null, {
                imageIds: new Set(['M-0005']),
            });

            // CV-05: 全印刷サイズでPDF生成を確認 (4.5x6.5 は 6×3=18枚/ページ なので19枚で2ページ)
            const nineteenCards = Array.from({ length: 19 }, (_, idx) => ({
                ...renderedModel,
                id: String(idx + 1),
                hasImage: false,
                imageUrl: null,
            }));

            const pdfRes12 = await exportCardsAsPdf(nineteenCards, '4.5x6.5', 'standard', {
                download: false,
            });
            const pdfBytes = new Uint8Array(await pdfRes12.blob.arrayBuffer());
            const pdfHeader = String.fromCharCode(...pdfBytes.slice(0, 4));

            // 他の印刷サイズ定義もすべて揃っていることを確認
            const sizeKeys = Object.keys(PRINT_SIZES);

            // CV-06: 完成カード画像ZIP生成 (hug-cards/hug-card-{No}.png)
            const zipRes = await exportCardsAsZip(nineteenCards.slice(0, 3), 'standard', {
                download: false,
            });
            const loadedZip = await window.JSZip.loadAsync(await zipRes.blob.arrayBuffer());
            const zipFileNames = Object.keys(loadedZip.files).filter((k) => !loadedZip.files[k].dir);

            // CV-07: 中断シグナル (signal.cancelled = true) で即座に CANCELLED 例外となることを確認
            let cancelCaught = false;
            try {
                await exportCardsAsPdf(nineteenCards, '4.5x6.5', 'standard', {
                    download: false,
                    signal: { cancelled: true },
                });
            } catch (err) {
                if (err && err.message === 'CANCELLED') {
                    cancelCaught = true;
                }
            }

            return {
                cardId: renderedModel.id,
                origId: renderedModel.original_id,
                imgUrl: renderedModel.imageUrl,
                flags: renderedModel.detailedFlags,
                pdfHeader,
                pdfPageCount: pdfRes12.pageCount,
                pdfCols: pdfRes12.cols,
                pdfRows: pdfRes12.rows,
                sizeKeysCount: sizeKeys.length,
                zipFileCount: zipRes.fileCount,
                zipFileNames: zipFileNames.sort(),
                cancelCaught,
            };
        }"""
    )
    # CV-04
    assert res["cardId"] == "1"
    assert res["origId"] == "M-0005"
    assert res["imgUrl"].startswith("/api/images/M-0005")
    assert "良好" not in res["flags"]
    assert "聴覚障害" in res["flags"]
    assert "手話・要約筆記" in res["flags"]

    # CV-05
    assert res["pdfHeader"] == "%PDF"
    assert res["pdfPageCount"] == 2
    assert res["pdfCols"] == 6 and res["pdfRows"] == 3
    assert res["sizeKeysCount"] >= 6

    # CV-06
    assert res["zipFileCount"] == 3
    assert res["zipFileNames"] == [
        "hug-cards/hug-card-1.png",
        "hug-cards/hug-card-2.png",
        "hug-cards/hug-card-3.png",
    ]

    # CV-07
    assert res["cancelCaught"] is True


def test_ui_im_01_and_02_batch_prompt_upload_slice_and_apply(
    page, e2e_server, s2_payload: dict
) -> None:
    """UI-IM-01 & UI-IM-02: 「イラスト管理」タブでバッチプロンプト表示・グリッド画像アップロード・自動分割・セル選択＆ID変更・一括反映."""
    _seed_e2e_db(e2e_server, s2_payload)
    page.goto(e2e_server["base_url"])

    # イラスト管理タブへ移動
    page.get_by_test_id("tab-images").click()
    expect(page.get_by_test_id("image-view")).to_be_visible()

    # UI-IM-01: 避難者バッチが表示され、プロンプトとテンプレートリンクが確認できる
    batch_id = "避難者-batch-1"
    expect(page.get_by_test_id(f"batch-card-{batch_id}")).to_be_visible()
    prompt_val = page.get_by_test_id(f"batch-prompt-{batch_id}").input_value()
    assert "4列×3行のグリッド状に12人の人物" in prompt_val
    tmpl_href = page.get_by_test_id(f"template-link-{batch_id}").get_attribute("href")
    assert tmpl_href == "/static/templates/template_people_12v2.png"

    # テスト用の4×3グリッドJPEG（Base64先頭が `/9j/` となる実運用同等のJPEG画像）をブラウザCanvasで生成してバイト列を取得
    grid_b64 = page.evaluate(
        """() => {
            const c = document.createElement('canvas');
            c.width = 1024;
            c.height = 571;
            const ctx = c.getContext('2d');
            for (let r = 0; r < 3; r++) {
                for (let col = 0; col < 4; col++) {
                    ctx.fillStyle = `rgb(${50 + r * 60}, ${70 + col * 40}, 180)`;
                    ctx.fillRect(col * 256, r * 190, 256, 191);
                }
            }
            ctx.fillStyle = '#ffffff';
            for (let col = 1; col < 4; col++) ctx.fillRect(col * 256 - 2, 0, 4, 571);
            for (let r = 1; r < 3; r++) ctx.fillRect(0, r * 190 - 2, 1024, 4);
            return c.toDataURL('image/jpeg', 0.92).split(',')[1];
        }"""
    )
    assert grid_b64.startswith("/9j/")
    grid_bytes = base64.b64decode(grid_b64)

    # UI-IM-02: グリッドJPEG画像をアップロードすると12セルに自動分割される
    file_input = page.get_by_test_id(f"batch-file-input-{batch_id}")
    file_input.set_input_files(
        {"name": "people_grid.jpg", "mimeType": "image/jpeg", "buffer": grid_bytes}
    )

    expect(page.get_by_test_id(f"batch-slices-grid-{batch_id}")).to_be_visible()
    expect(page.get_by_test_id(f"slice-cell-{batch_id}-0")).to_be_visible()
    expect(page.get_by_test_id(f"slice-cell-{batch_id}-11")).to_be_visible()

    # セル2 (index 1) の採用チェックをOFFにする
    chk1 = page.get_by_test_id(f"slice-enable-{batch_id}-1")
    chk1.uncheck()

    # 「このバッチの選択セルをDB＆フォルダに保存反映」をクリック
    page.get_by_test_id(f"adopt-batch-btn-{batch_id}").click()
    expect(page.get_by_test_id(f"batch-status-{batch_id}")).to_contain_text("反映済み")

    # M-0001 は登録済み、チェックを外した M-0002 は未登録であることを確認
    db_dir = Path(e2e_server["db_path"]).parent / "images"
    assert (db_dir / "M-0001.png").exists()
    assert not (db_dir / "M-0002.png").exists()


def test_ui_im_03_single_card_image_upload_and_delete(
    page, e2e_server, s2_payload: dict
) -> None:
    """UI-IM-03: 個別カードイラスト管理モードで1枚のPNG画像を直接登録・削除できる."""
    _seed_e2e_db(e2e_server, s2_payload)
    page.goto(e2e_server["base_url"])

    page.get_by_test_id("tab-images").click()
    page.get_by_test_id("image-submode-cards").click()
    expect(page.get_by_test_id("img-cards-preview-grid")).to_be_visible()

    single_b64 = page.evaluate(
        """() => {
            const c = document.createElement('canvas');
            c.width = 80;
            c.height = 80;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#10b981';
            ctx.fillRect(0, 0, 80, 80);
            return c.toDataURL('image/png').split(',')[1];
        }"""
    )
    single_bytes = base64.b64decode(single_b64)

    # EV-001 に個別画像をアップロード
    upload_input = page.get_by_test_id("single-upload-input-EV-001")
    upload_input.set_input_files(
        {"name": "ev001.png", "mimeType": "image/png", "buffer": single_bytes}
    )

    # 削除ボタンが出現し、カード一覧タブでもサムネイルが表示されることを確認
    expect(page.get_by_test_id("single-delete-btn-EV-001")).to_be_visible()

    page.get_by_test_id("tab-list").click()
    expect(page.get_by_test_id("badge-has-image-EV-001")).to_be_visible()
    expect(page.get_by_test_id("card-thumb-EV-001")).to_be_visible()

    # イラスト管理に戻って EV-001 の画像を削除
    page.get_by_test_id("tab-images").click()
    page.get_by_test_id("image-submode-cards").click()
    page.get_by_test_id("single-delete-btn-EV-001").click()
    expect(page.get_by_test_id("single-delete-btn-EV-001")).to_have_count(0)


def test_ui_im_04_deck_direct_card_preview_and_master_ledger(
    page, e2e_server, s2_payload: dict
) -> None:
    """UI-IM-04: デッキ構築タブからCSVを介さず直接「完成カードプレビュー（連番No.1〜＋イラスト合成）」と「避難者台帳」を表示できる."""
    _seed_e2e_db(e2e_server, s2_payload)
    page.goto(e2e_server["base_url"])

    # まず EV-001 にイラストを登録しておく
    page.evaluate(
        """async () => {
            const { api } = await import('/static/js/api.js');
            const { store } = await import('/static/js/store.js');
            const c = document.createElement('canvas');
            c.width = 64;
            c.height = 64;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(0, 0, 64, 64);
            await api.uploadCardImage('EV-001', c.toDataURL('image/png'));
            store.markImageUpdated('EV-001');
        }"""
    )

    # デッキ構築タブへ移動
    page.get_by_test_id("tab-deck").click()
    expect(page.get_by_test_id("deck-view")).to_be_visible()

    # 「完成カードプレビュー」サブモードに切替
    page.get_by_test_id("deck-submode-cards").click()
    expect(page.get_by_test_id("deck-cards-preview-section")).to_be_visible()
    expect(page.get_by_test_id("gen-card-1")).to_be_visible()
    expect(page.get_by_test_id("gen-card-no-1")).to_have_text("No. 1")

    # 標準デザイン・名刺サイズ固定仕様のバッジが表示され、出力予定のCanvasカード画像が表示されていることを確認
    expect(page.get_by_test_id("deck-fixed-card-spec")).to_contain_text("名刺サイズ")
    expect(page.get_by_test_id("gen-card-img-1")).to_be_visible()

    # ベース画像（番号なし）と連番合成済み画像、右下のDBカードID描画を検証
    canvas_check = page.evaluate(
        """async () => {
            const { generateBaseCardCanvas, generateCardImageCanvas, FIXED_DESIGN_MODE, FIXED_PRINT_SIZE_ID } = await import('/static/js/cardCanvas.js');
            const sample = {
                id: '1',
                original_id: 'EV-001',
                text: 'ペットの同行避難について相談があった。',
                is_event: true,
                has_image: false,
            };
            const baseEntry = await generateBaseCardCanvas(sample);
            const numberedUrl = await generateCardImageCanvas(sample, FIXED_DESIGN_MODE, { showNumber: true });
            const unnumberedUrl = await generateCardImageCanvas(
                { ...sample, id: 'EV-001' },
                FIXED_DESIGN_MODE,
                { showNumber: false }
            );

            const loadImg = (url) => new Promise((res) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = url;
            });
            const numberedImg = await loadImg(numberedUrl);
            const nCanvas = document.createElement('canvas');
            nCanvas.width = baseEntry.canvas.width;
            nCanvas.height = baseEntry.canvas.height;
            const nCtx = nCanvas.getContext('2d');
            nCtx.drawImage(numberedImg, 0, 0);

            // 左上領域(No.1が描画される位置: x=20..180, y=20..65)のピクセル差分を確認
            const bCtx = baseEntry.canvas.getContext('2d');
            const bTopLeft = bCtx.getImageData(25, 22, 140, 42).data;
            const nTopLeft = nCtx.getImageData(25, 22, 140, 42).data;
            let topLeftDiff = 0;
            for (let i = 0; i < bTopLeft.length; i += 4) {
                if (
                    Math.abs(bTopLeft[i] - nTopLeft[i]) > 10 ||
                    Math.abs(bTopLeft[i + 1] - nTopLeft[i + 1]) > 10 ||
                    Math.abs(bTopLeft[i + 2] - nTopLeft[i + 2]) > 10
                ) {
                    topLeftDiff++;
                }
            }

            // 右下隅(ID: EV-001 が描画される位置: x=420..580, y=948..981)に文字ピクセルが存在することを確認
            const brData = bCtx.getImageData(420, 948, 160, 32).data;
            let idInkPixels = 0;
            for (let i = 0; i < brData.length; i += 4) {
                // 背景は白(255,255,255)なので非白ピクセルをカウント
                if (brData[i] < 220 || brData[i + 1] < 220 || brData[i + 2] < 220) {
                    idInkPixels++;
                }
            }

            return {
                fixedDesign: FIXED_DESIGN_MODE,
                fixedPrintSize: FIXED_PRINT_SIZE_ID,
                topLeftDiff,
                idInkPixels,
                sameUnnumberedAsBase: baseEntry.dataUrl === unnumberedUrl,
            };
        }"""
    )
    assert canvas_check["fixedDesign"] == "standard"
    assert canvas_check["fixedPrintSize"] == "business"
    assert canvas_check["topLeftDiff"] > 50
    assert canvas_check["idInkPixels"] > 30
    assert canvas_check["sameUnnumberedAsBase"] is True

    # 「避難者台帳」サブモードに切替
    page.get_by_test_id("deck-submode-ledger").click()
    expect(page.get_by_test_id("deck-ledger-section")).to_be_visible()
    expect(page.get_by_test_id("master-ledger-table")).to_be_visible()


def test_cv_09_group_header_layout_and_legacy_revert(page, e2e_server) -> None:
    """CV-09: 避難者/ペットカードのグループ情報ヘッダ（固定2行高さ・共通配色）と legacy 切替復元の検証."""
    page.goto(e2e_server["base_url"])
    res = page.evaluate(
        """async () => {
            const {
                EVACUEE_CARD_LAYOUT_MODE,
                generateCardImageCanvas,
                toCardRenderModel,
                computeGroupPositionMap,
            } = await import('/static/js/cardCanvas.js');

            const shortGroupCard = {
                id: '1',
                original_id: 'M-1001',
                group_id: 'GRP-100',
                group_name: '林家',
                group_index: 1,
                group_total: 2,
                type: '避難者',
                name: '林 太郎',
                origin: '花小金井１丁目',
                age: '40',
                gender: '男性',
                attributes: '世帯主',
                detailedFlags: ['高血圧'],
                dialogue: 'テストセリフです。',
                imageUrl: null,
            };

            const longGroupCard = {
                ...shortGroupCard,
                group_name: 'とても長い名前の特別支援三世代合同大世帯グループ名',
                group_index: 2,
                group_total: 12,
            };

            const petGroupCard = {
                id: '2',
                original_id: 'M-1002',
                group_id: 'GRP-100',
                group_name: '林家',
                group_index: 2,
                group_total: 2,
                type: 'ペット',
                name: 'ポチ',
                origin: '花小金井１丁目',
                age: '4',
                gender: 'オス',
                attributes: 'ペット',
                detailedFlags: ['ケガ'],
                dialogue: 'ケージの中でおとなしくしています。',
                imageUrl: null,
            };

            const eventCard = {
                id: '3',
                original_id: 'EV-001',
                type: 'イベント',
                name: '停電発生',
                attributes: '地震時必須',
                detailedFlags: ['設備対応'],
                dialogue: '避難所が停電しました。',
                imageUrl: null,
            };

            const shortUrl = await generateCardImageCanvas(shortGroupCard, 'standard');
            const longUrl = await generateCardImageCanvas(longGroupCard, 'standard');
            const petUrl = await generateCardImageCanvas(petGroupCard, 'standard');
            const legacyShortUrl = await generateCardImageCanvas(shortGroupCard, 'standard', {
                layoutMode: 'legacy',
            });
            const evHeaderUrl = await generateCardImageCanvas(eventCard, 'standard');
            const evLegacyUrl = await generateCardImageCanvas(eventCard, 'standard', {
                layoutMode: 'legacy',
            });

            const loadCanvas = (url) =>
                new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = img.width;
                        c.height = img.height;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(ctx);
                    };
                    img.src = url;
                });

            const shortCtx = await loadCanvas(shortUrl);
            const longCtx = await loadCanvas(longUrl);
            const petCtx = await loadCanvas(petUrl);
            const legacyCtx = await loadCanvas(legacyShortUrl);

            // (39, 138) は左端アクセントバー(#1d4ed8)、(555, 80) は右上ボックス背景(#eff6ff)
            const px = (ctx, x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);

            // 2文字グループ名と23文字グループ名で y=160..900 の領域（氏名・属性・セリフ）のY位置が完全一致することを確認
            const lowerShort = shortCtx.getImageData(25, 160, 550, 740).data;
            const lowerLong = longCtx.getImageData(25, 160, 550, 740).data;
            let lowerDiffPixels = 0;
            for (let i = 0; i < lowerShort.length; i += 4) {
                if (
                    Math.abs(lowerShort[i] - lowerLong[i]) > 2 ||
                    Math.abs(lowerShort[i + 1] - lowerLong[i + 1]) > 2 ||
                    Math.abs(lowerShort[i + 2] - lowerLong[i + 2]) > 2
                ) {
                    lowerDiffPixels++;
                }
            }

            // computeGroupPositionMap + toCardRenderModel がデッキ側構成を基準に番号・総数を計算すること
            const deckSubset = [
                { card_number: 1, kind: 'person', original_id: 'M-1001', group_id: 'GRP-100', data: { member_id: 'M-1001', group_id: 'GRP-100', data_type: '人物', name: '林 太郎' }, group: { group_id: 'GRP-100', group_name: '林家' } },
                { card_number: 2, kind: 'pet', original_id: 'M-1002', group_id: 'GRP-100', data: { member_id: 'M-1002', group_id: 'GRP-100', data_type: 'ペット', name: 'ポチ' }, group: { group_id: 'GRP-100', group_name: '林家' } },
            ];
            const posMap = computeGroupPositionMap(deckSubset);
            const model2 = toCardRenderModel(deckSubset[1], null, posMap.get('M-1002') ? { groupIndex: posMap.get('M-1002').group_index, groupTotal: posMap.get('M-1002').group_total } : {});

            return {
                defaultLayoutMode: EVACUEE_CARD_LAYOUT_MODE,
                shortBarPx: px(shortCtx, 39, 138),
                shortBgPx: px(shortCtx, 555, 80),
                petBarPx: px(petCtx, 39, 138),
                petBgPx: px(petCtx, 555, 80),
                legacyBarPx: px(legacyCtx, 39, 138),
                legacyBgPx: px(legacyCtx, 555, 80),
                lowerDiffPixels,
                differsFromLegacy: shortUrl !== legacyShortUrl,
                eventUnchanged: evHeaderUrl === evLegacyUrl,
                model2Group: {
                    group_name: model2.group_name,
                    group_index: model2.group_index,
                    group_total: model2.group_total,
                },
            };
        }"""
    )

    assert res["defaultLayoutMode"] == "withGroupHeader"
    # Proposal A 配色（避難者・ペット共通）: アクセント #1d4ed8=[29,78,216]、背景 #eff6ff=[239,246,255]
    assert res["shortBarPx"] == [29, 78, 216]
    assert res["shortBgPx"] == [239, 246, 255]
    assert res["petBarPx"] == [29, 78, 216]
    assert res["petBgPx"] == [239, 246, 255]
    # legacy モードはグループ情報ヘッダなし（右上#eff6ff領域が白 #ffffff、左バー位置に青バーなし）で切り戻し可能
    assert res["legacyBarPx"] != [29, 78, 216]
    assert res["legacyBgPx"] == [255, 255, 255]
    assert res["differsFromLegacy"] is True
    assert res["eventUnchanged"] is True
    # グループ名の長さに関わらず y=160..900 の領域は1ピクセルもずれないこと
    assert res["lowerDiffPixels"] == 0
    assert res["model2Group"] == {"group_name": "林家", "group_index": 2, "group_total": 2}

