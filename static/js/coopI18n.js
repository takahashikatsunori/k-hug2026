/**
 * こだいらSVCs マルチユーザー訓練用 言葉遣い辞書（誰でも＝小学生むけ / 一般＝中学生以上）.
 * ボタンの大きさ・形は共通のまま、ラベルと案内文のみを切り替える.
 */

export const LANG_MODES = {
  kids: "kids",
  general: "general",
};

const DICT = {
  kids: {
    brandSub: "ひなんじょゲーム（みんなでたいし）",
    langToggleLabel: "かんたん",
    langSwitchTo: "一般むけ（漢字）にする",
    joinTitle: "くんれんに さんかしよう！",
    joinSubtitle: "なまえを いれて ボタンを押してね",
    nicknameLabel: "あなたの なまえ（ニックネーム）",
    nicknamePlaceholder: "れい：たろう、ゆうこ",
    roomLabel: "くんれんルーム",
    roomPlaceholder: "くんれんIDを いれてね",
    groupLabel: "どの グループ？",
    joinBtn: "この グループに さんかする！",
    joining: "じゅんびちゅう…",
    waitingCards: "せんせい（かんりしゃ）から カードが くばられるのを まっているよ！",
    newCardToast: "あたらしい カードが {n}まい とどいたよ！",
    handLabel: "てふだ",
    placedProgress: "おいたカード {placed}/{total}まい",
    placeCenter: "まんなかに おく",
    placeEmpty: "あいている ところに おく",
    returnToHand: "てふだに もどす",
    zoomDetail: "おおきく みる",
    close: "とじる",
    menu: "メニュー",
    qrTakeHome: "もちかえり QRコード",
    qrTakeHomeDesc: "スマホの カメラで よみとると、いまの 台紙を PDFで もちかえれるよ！",
    downloadPdf: "PDFで もちかえる（ダウンロード）",
    fitView: "ぜんぶを みる",
    zoomIn: "おおきく",
    zoomOut: "ちいさく",
    draggingBy: "{name}さんが うごかしてるよ",
    placedBy: "{name}さん",
    membersOnline: "{n}にん さんかちゅう",
    timerPrefix: "のこりじかん",
    pdfExportTitle: "おつかれさま！ たいしを PDFで もちかえろう",
    pdfExportDesc: "したの ボタンを おすと、みんなの おいた カードが PDFファイルで ほぞんされるよ。",
    pdfExportBtn: "PDFを ダウンロードする",
    openBoardBtn: "たいしの がめんを みる",
    leaveBtn: "たいしつ する",
    howToTitle: "あそびかた",
    howToBody:
      "① したの「てふだ」から カードを えらんで たいしの うえに おこう！\n② おいた カードは ゆびや マウスで じゆうに うごかせるよ。\n③ おわったら メニューから PDFで もちかえれるよ！",
  },
  general: {
    brandSub: "避難所運営ゲーム（マルチユーザー台紙）",
    langToggleLabel: "一般",
    langSwitchTo: "誰でもむけ（ひらがな）にする",
    joinTitle: "訓練に参加する",
    joinSubtitle: "ニックネームを入力して参加してください",
    nicknameLabel: "ニックネーム",
    nicknamePlaceholder: "例：たなか、さとう",
    roomLabel: "訓練ルーム",
    roomPlaceholder: "訓練IDを入力",
    groupLabel: "参加グループ",
    joinBtn: "このグループに参加する",
    joining: "接続しています…",
    waitingCards: "管理者からカードが配布されるのを待っています…",
    newCardToast: "新しいカードが {n}枚 配布されました",
    handLabel: "手札",
    placedProgress: "配置 {placed}/{total}枚",
    placeCenter: "中央に置く",
    placeEmpty: "空いている場所に置く",
    returnToHand: "手札に戻す",
    zoomDetail: "拡大",
    close: "閉じる",
    menu: "メニュー",
    qrTakeHome: "持ち帰り用QRコード",
    qrTakeHomeDesc: "スマートフォンで読み取ると、現在の配置状態をPDFでダウンロードできます。",
    downloadPdf: "PDFをダウンロード",
    fitView: "全体表示",
    zoomIn: "拡大",
    zoomOut: "縮小",
    draggingBy: "{name}さんが移動中",
    placedBy: "{name}さん",
    membersOnline: "{n}名参加中",
    timerPrefix: "残り時間",
    pdfExportTitle: "訓練の配置結果をPDFで持ち帰る",
    pdfExportDesc: "下のボタンを押すと、現在のグループの台紙と配置カードをPDFとして保存できます。",
    pdfExportBtn: "PDFをダウンロードする",
    openBoardBtn: "共有台紙を開く",
    leaveBtn: "退室する",
    howToTitle: "操作方法",
    howToBody:
      "① 下の手札からカードをタップまたはドラッグして台紙の上に配置します。\n② 配置したカードは誰でも自由に移動・重ね置きできます。\n③ 終了後はメニューまたはQRコードからPDFで持ち帰ることができます。",
  },
};

/**
 * 指定モード・キーの文言を取得する.
 * @param {"kids"|"general"} mode
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(mode, key, vars = {}) {
  const table = DICT[mode === "kids" ? "kids" : "general"];
  let text = table[key] ?? DICT.general[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
