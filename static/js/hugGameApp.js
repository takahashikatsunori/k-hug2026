/**
 * スマホでHUG訓練 - 小平第五小学校 避難所運営シミュレーター
 * サーバ保存済みデッキ（五小rev5・基本セット等）を用いた実践的スマホ最適化HUG Webアプリ
 */
import { escapeHtml } from "./util.js";
import { store } from "./store.js";
import {
  toCardRenderModel,
  bindCardCanvasImage,
  computeGroupPositionsByIndex,
  computeGroupPositionMap,
} from "./cardCanvas.js";
import {
  buildAllDatabaseCardEntries,
  buildInitialDeck,
  importDeckFromJsonText,
  renumberDeckCards,
} from "./webDeckEngine.js";

const LOGO_IMG_ATTRS = `src="./static/logo/正式ロゴ.jpeg" onerror="if(!this.dataset.fb1){this.dataset.fb1='1';this.src='./static/logo/official_logo.jpeg';}else if(!this.dataset.fb2){this.dataset.fb2='1';this.src='./logo/正式ロゴ.jpeg';}"`;

// ============================================================================
// 小平市立小平第五小学校 エリア＆部屋・設備マスタ定義 (6タブ・全29区画)
// ============================================================================
export const AREA_TABS = [
  {
    id: "grounds",
    label: "校庭・門",
    fullTitle: "🗺️ 小平第五小学校 敷地・校庭・門・屋外設備見取り図",
    icon: "🗺️",
    floorLevel: 0,
  },
  {
    id: "gym",
    label: "体育館",
    fullTitle: "🏛️ 体育館フロア見取り図（西：玄関/スロープ・北：ステージ・東：マンホールトイレ側）",
    icon: "🏛️",
    floorLevel: 1,
  },
  {
    id: "floor1",
    label: "校舎1F",
    fullTitle: "🏫 校舎1階（運営本部・保健室・福祉教室・授乳相談室）",
    icon: "🏫",
    floorLevel: 1,
  },
  {
    id: "floor2",
    label: "校舎2F",
    fullTitle: "🏫 校舎2階（子育て世帯室・普通教室・女性静養室・図書キッズ室）",
    icon: "🏫",
    floorLevel: 2,
  },
  {
    id: "floor3",
    label: "校舎3F",
    fullTitle: "🏫 校舎3階（帰宅困難者室・予備教室・感染症隔離室A/B）",
    icon: "🏫",
    floorLevel: 3,
  },
  {
    id: "external",
    label: "転出/在宅",
    fullTitle: "🚑 在宅避難登録・医療機関搬送・福祉避難所移送・退所",
    icon: "🚑",
    floorLevel: 0,
  },
];

export const INITIAL_ROOMS = [
  // --- 1. 校庭・門・敷地 (grounds) ---
  {
    id: "gate-main",
    areaId: "grounds",
    name: "正門・周辺道路・外掲示板",
    shortName: "正門・掲示板",
    icon: "🚧",
    capacity: 15,
    tags: ["正門動線", "広報掲示", "緊急車両"],
    desc: "五小通り・花小金井駅側。ブロック塀の安全規制、緊急車両誘導、在宅避難者向け情報掲示板の設置場所。",
    isFacility: true,
    defaultStatus: "未点検",
  },
  {
    id: "entrance-reception",
    areaId: "grounds",
    name: "児童昇降口（総合受付・検温消毒）",
    shortName: "昇降口・総合受付",
    icon: "📋",
    capacity: 20,
    tags: ["総合受付", "検温・消毒", "上履き切替"],
    desc: "避難者受付・名簿記入・検温手指消毒・土足/上履き切替を行う避難所の入口拠点。",
    isFacility: true,
    defaultStatus: "受付準備中",
  },
  {
    id: "corridor-pet",
    areaId: "grounds",
    name: "渡り廊下・ピロティ（ペット同行区画）",
    shortName: "渡り廊下(ペット)",
    icon: "🐾",
    capacity: 15,
    tags: ["🐾ペット専用", "ケージ管理", "屋外屋根付"],
    desc: "校舎と体育館を結ぶ屋根付き渡り廊下・ピロティ。同行避難ペット（犬・猫等）の専用飼育エリア。",
    isPetZone: true,
    defaultStatus: "受入可能",
  },
  {
    id: "manhole-toilet",
    areaId: "grounds",
    name: "正門北側・体育館東側（マンホールトイレ10基）",
    shortName: "マンホールトイレ",
    icon: "🚽",
    capacity: 10,
    tags: ["🚽五小仕様10基", "事前貯留型", "屋外衛生"],
    desc: "五小特有の事前貯留型マンホールトイレ10基設営エリア（正門入って左右・体育館東側）。",
    isFacility: true,
    defaultStatus: "未設営",
  },
  {
    id: "prefab-warehouse",
    areaId: "grounds",
    name: "プレハブ防災倉庫（資機材・備蓄庫）",
    shortName: "プレハブ防災倉庫",
    icon: "📦",
    capacity: 10,
    tags: ["📦備蓄倉庫", "トイレ資機材", "水・毛布"],
    desc: "マンホールトイレ用テント・ポンプ、感染症対策セット、飲料水・アルファ米・毛布等の保管庫。",
    isFacility: true,
    defaultStatus: "施錠/待機",
  },
  {
    id: "pool-water",
    areaId: "grounds",
    name: "プール・受水槽（給水・トイレ用水）",
    shortName: "プール・受水槽",
    icon: "💧",
    capacity: 10,
    tags: ["💧プール水活用", "揚水ポンプ", "応急給水"],
    desc: "断水時のトイレ洗浄水バケツ汲み・マンホールトイレ送水ポンプおよび受水槽・給水車拠点。",
    isFacility: true,
    defaultStatus: "待機中",
  },
  {
    id: "schoolyard-main",
    areaId: "grounds",
    name: "校庭（一時待機・車中泊・自衛隊入浴）",
    shortName: "校庭・特設広場",
    icon: "⛺",
    capacity: 40,
    tags: ["⛺一時待機", "車中泊", "🛁自衛隊風呂"],
    desc: "避難者集中時の一時待機・トリアージ広場、やむを得ない車中泊、自衛隊野外入浴施設、防犯灯エリア。",
    defaultStatus: "開放中",
  },
  {
    id: "trash-smoking",
    areaId: "grounds",
    name: "正門横ごみ集積所・屋外指定喫煙所",
    shortName: "ごみ集積・喫煙所",
    icon: "🗑️",
    capacity: 10,
    tags: ["🗑️分別ごみ", "感染性廃棄物", "🚬屋外分煙"],
    desc: "生ごみ・おむつ等の分別密閉集積所（カラス・悪臭対策）および校舎から離れた風下の指定喫煙所。",
    isFacility: true,
    defaultStatus: "未整備",
  },

  // --- 2. 体育館 (gym) ---
  {
    id: "gym-stage",
    areaId: "gym",
    name: "体育館ステージ・館内放送/掲示席",
    shortName: "体育館ステージ",
    icon: "📢",
    capacity: 10,
    tags: ["📢館内広報", "情報掲示板", "一時物資"],
    desc: "体育館北側の演台・ステージ。ホワイトボード情報掲示、テレビ設置、一時物資仕分け拠点。",
    span2: true,
    defaultStatus: "稼働中",
  },
  {
    id: "gym-a",
    areaId: "gym",
    name: "体育館 A区画（西・出入口/トイレ近く）",
    shortName: "体育館A(入口側)",
    icon: "♿",
    capacity: 16,
    tags: ["♿バリアフリー", "トイレ近く", "高齢者配慮"],
    desc: "玄関スロープ・多目的トイレに最も近い西側手前区画。足腰が不自由な高齢者・杖・視覚障害の方等に最適。",
    defaultStatus: "開放中",
  },
  {
    id: "gym-d",
    areaId: "gym",
    name: "体育館 D区画（東・出入口側）",
    shortName: "体育館D(東手前)",
    icon: "🏠",
    capacity: 20,
    tags: ["一般世帯", "単身・若年", "動線近く"],
    desc: "出入口に近い東側手前区画。一般世帯や運営協力スキル（力仕事等）を持つ世帯の配置に好適。",
    defaultStatus: "開放中",
  },
  {
    id: "gym-b",
    areaId: "gym",
    name: "体育館 B区画（西・中央）",
    shortName: "体育館B(西中央)",
    icon: "🏠",
    capacity: 20,
    tags: ["一般世帯", "三世代世帯", "標準区画"],
    desc: "体育館西側の中央区画。一般家族世帯・三世代同居世帯などのメイン居住スペース。",
    defaultStatus: "開放中",
  },
  {
    id: "gym-e",
    areaId: "gym",
    name: "体育館 E区画（東・中央）",
    shortName: "体育館E(東中央)",
    icon: "🏠",
    capacity: 20,
    tags: ["一般世帯", "標準区画", "東側"],
    desc: "体育館東側の中央区画。一般家族・ご近所グループなどの居住スペース。",
    defaultStatus: "開放中",
  },
  {
    id: "gym-c",
    areaId: "gym",
    name: "体育館 C区画（西奥・ステージ寄り）",
    shortName: "体育館C(西奥)",
    icon: "👶",
    capacity: 18,
    tags: ["子育て世帯", "女性配慮", "奥側静穏"],
    desc: "出入口の風や人の出入りが少ない西側奥区画。子ども連れ世帯や女性を含む世帯に向く。",
    defaultStatus: "開放中",
  },
  {
    id: "gym-f",
    areaId: "gym",
    name: "体育館 F区画（東奥・東壁面側）",
    shortName: "体育館F(東奥壁側)",
    icon: "🏠",
    capacity: 20,
    tags: ["一般世帯", "帰宅困難者", "東壁面側"],
    desc: "体育館東奥の壁面側区画（※余震で東壁面に亀裂が発生した際は立入禁止・再配置対象）。",
    defaultStatus: "開放中",
  },

  // --- 3. 校舎 1階 (floor1) ---
  {
    id: "f1-hq",
    areaId: "floor1",
    name: "1F 職員室・会議室（避難所運営本部）",
    shortName: "1F 運営本部",
    icon: "🚩",
    capacity: 10,
    tags: ["🚩運営本部", "防災無線", "報道・NPO窓口"],
    desc: "本部長・地域代表会議・市対策本部連絡・マスコミ取材受付・NPO/ボランティア調整を行う中枢。",
    isFacility: true,
    defaultStatus: "稼働中",
  },
  {
    id: "f1-infirmary",
    areaId: "floor1",
    name: "1F 保健室（救護所・医療機器電源室）",
    shortName: "1F 保健室(救護)",
    icon: "🏥",
    capacity: 12,
    tags: ["🏥救護・負傷", "🔌非常用電源", "透析・酸素・保冷"],
    desc: "骨折・怪我・急病人の救護ベッド、および酸素濃縮器・人工透析・インスリン保冷等の非常用電源優先室。",
    defaultStatus: "開放中",
  },
  {
    id: "f1-welfare",
    areaId: "floor1",
    name: "1F 福祉教室（1-1 高齢者・車椅子・要介護室）",
    shortName: "1F 福祉教室(車椅子)",
    icon: "♿",
    capacity: 16,
    tags: ["♿車椅子・杖", "階段移動不可", "要介護・障害"],
    desc: "階段を使えない車椅子利用者・重度足腰不自由・視覚/聴覚障害・要介護高齢者と介助家族のための1階教室。",
    defaultStatus: "開放中",
  },
  {
    id: "f1-nursery",
    areaId: "floor1",
    name: "1F 相談室・和室（授乳・更衣・個別配慮室）",
    shortName: "1F 授乳・個別配慮室",
    icon: "🍼",
    capacity: 12,
    tags: ["🍼授乳・おむつ", "女性更衣", "LGBTQ・個別配慮"],
    desc: "乳幼児の授乳・おむつ替え、女性の着替え、LGBTQや自閉症・パニック等の個別プライバシー保護室。",
    defaultStatus: "開放中",
  },
  {
    id: "f1-multipurpose",
    areaId: "floor1",
    name: "1F 多目的室（物資・救護拡張 / 予備室）",
    shortName: "1F 多目的室",
    icon: "📦",
    capacity: 16,
    tags: ["予備居住室", "物資・救護拡張"],
    desc: "1階の広い多目的スペース。一般避難者の収容や、大量物資到着・救護拡張時の拠点転用に対応。",
    span2: true,
    defaultStatus: "開放中",
  },

  // --- 4. 校舎 2階 (floor2) ---
  {
    id: "f2-family",
    areaId: "floor2",
    name: "2F 2-1教室（子育て・乳幼児連れ世帯室）",
    shortName: "2F 子育て教室(2-1)",
    icon: "👨‍👩‍👧‍👦",
    capacity: 18,
    tags: ["👶乳幼児・子ども", "夜泣き配慮", "家族世帯"],
    desc: "乳幼児の夜泣きや子どもの声に周囲へ気兼ねせず過ごせる、子育て世帯・妊婦世帯向けの2階教室。",
    defaultStatus: "開放中",
  },
  {
    id: "f2-general-a",
    areaId: "floor2",
    name: "2F 2-2教室（普通教室A・一般世帯）",
    shortName: "2F 普通教室A(2-2)",
    icon: "🏠",
    capacity: 20,
    tags: ["一般世帯", "冷暖房教室", "標準"],
    desc: "階段移動が可能な一般家族・グループ向けの2階普通教室。",
    defaultStatus: "開放中",
  },
  {
    id: "f2-quiet",
    areaId: "floor2",
    name: "2F 2-3教室（女性・単身配慮・静養教室）",
    shortName: "2F 女性・静養室(2-3)",
    icon: "🌙",
    capacity: 14,
    tags: ["🌙女性・単身配慮", "精神的ショック", "静養・個室感"],
    desc: "女性単身者・妊婦・強い精神的ショックを受けた方や大勢の場が苦手な方のための静養教室。",
    defaultStatus: "開放中",
  },
  {
    id: "f2-library",
    areaId: "floor2",
    name: "2F 図書室・学習室（キッズ・心のケア室）",
    shortName: "2F 図書・キッズ室",
    icon: "📚",
    capacity: 16,
    tags: ["📚子どもの心のケア", "NPO遊戯支援", "静穏スペース"],
    desc: "長期避難時の子どもの遊び場・学習・メンタルヘルス相談、および静かな予備滞在スペース。",
    defaultStatus: "開放中",
  },

  // --- 5. 校舎 3階 (floor3) ---
  {
    id: "f3-commuter",
    areaId: "floor3",
    name: "3F 3-1教室（帰宅困難者・市外避難者室）",
    shortName: "3F 帰宅困難者室(3-1)",
    icon: "🚆",
    capacity: 20,
    tags: ["🚆帰宅困難者", "市外・単身", "一時滞在"],
    desc: "西武新宿線運休等による帰宅困難者・市外からの来訪者・健康な単身/若年世帯向けの3階教室。",
    defaultStatus: "開放中",
  },
  {
    id: "f3-general-b",
    areaId: "floor3",
    name: "3F 3-2教室（普通教室B・代替移動用予備室）",
    shortName: "3F 普通教室B(3-2)",
    icon: "🏠",
    capacity: 20,
    tags: ["一般予備室", "部屋移動受入先"],
    desc: "雨漏りや体育館亀裂、騒音トラブル等で別室移動が必要になった際の受け皿にもなる3階教室。",
    defaultStatus: "開放中",
  },
  {
    id: "f3-isolation-a",
    areaId: "floor3",
    name: "3F 第一隔離室（3階東端・感染症隔離室A）",
    shortName: "3F 第一隔離室(感染)",
    icon: "🦠",
    capacity: 12,
    tags: ["🦠感染症隔離専用", "発熱・嘔吐下痢", "動線分離"],
    desc: "ノロウイルス・インフルエンザ・新型コロナ等の感染症疑い世帯を一般避難者と分離収容する専用隔離室。",
    isIsolation: true,
    defaultStatus: "開放中",
  },
  {
    id: "f3-isolation-b",
    areaId: "floor3",
    name: "3F 第二隔離室（3階西端・感染症隔離室B）",
    shortName: "3F 第二隔離室(予備)",
    icon: "🦠",
    capacity: 12,
    tags: ["🦠追加隔離・濃厚接触", "専用トイレ動線"],
    desc: "第一隔離室が満室になった際や、複数種類の感染症・濃厚接触世帯を分けて隔離する第2隔離室。",
    isIsolation: true,
    defaultStatus: "開放中",
  },

  // --- 6. 転出・在宅・外部連携 (external) ---
  {
    id: "ext-home",
    areaId: "external",
    name: "🏠 在宅避難・地域名簿登録（物資・トイレ利用）",
    shortName: "在宅避難登録",
    icon: "🏠",
    capacity: 99,
    tags: ["在宅避難者", "名簿登録・配給", "トイレ・入浴利用"],
    desc: "自宅やマンションに滞在しながら、避難所へ名簿登録・食料水配給・マンホールトイレ・入浴利用に来る方。",
    isExternal: true,
    defaultStatus: "登録受付中",
  },
  {
    id: "ext-hospital",
    areaId: "external",
    name: "🚑 医療機関搬送（救急車・ドクターヘリ）",
    shortName: "病院へ救急搬送",
    icon: "🚑",
    capacity: 99,
    tags: ["救急車搬送", "ドクターヘリ", "重傷・急病＋同行家族"],
    desc: "救急車（第1〜3便）やドクターヘリで病院へ搬送された重傷者・急病人および同行家族。",
    isExternal: true,
    defaultStatus: "搬送記録",
  },
  {
    id: "ext-welfare",
    areaId: "external",
    name: "🏥 福祉避難所・専門施設移送（特養・障害・母子）",
    shortName: "福祉避難所へ移送",
    icon: "🏥",
    capacity: 99,
    tags: ["特別養護老人ホーム", "障害者支援施設", "母子生活支援施設"],
    desc: "特養ホーム・障害者支援施設・母子生活支援施設・東部市民センター等の二次避難所へ移送された世帯。",
    isExternal: true,
    defaultStatus: "移送記録",
  },
  {
    id: "ext-departed",
    areaId: "external",
    name: "🚌 退所・帰宅（広域避難バス・みなし仮設・親戚宅）",
    shortName: "退所・広域バス・仮設",
    icon: "🚌",
    capacity: 99,
    tags: ["広域避難バス", "みなし仮設住宅", "親戚宅縁故避難"],
    desc: "稼働駅行き広域避難バス、ホテル/公営住宅のみなし仮設、親戚宅への縁故避難等で退所した方。",
    isExternal: true,
    defaultStatus: "退所記録",
  },
];

// ============================================================================
// Web Audio API サウンドエフェクト
// ============================================================================
class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.45;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  playPlace() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25];
    notes.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + idx * 0.07);
      gain.gain.setValueAtTime(this.volume * 0.4, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.18);
    });
  }

  playEventAlert() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 783.99, 987.77];
    notes.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + idx * 0.08);
      gain.gain.setValueAtTime(this.volume * 0.45, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.25);
    });
  }

  playFanfare() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + idx * 0.12);
      gain.gain.setValueAtTime(this.volume * 0.5, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.55);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.55);
    });
  }
}

const sfx = new GameAudio();

// ============================================================================
// アプリケーション状態 (State)
// ============================================================================
export const gameState = {
  db: null,
  serverDecks: [],
  selectedDeckSource: "server", // 'server' | 'local' | 'json'
  selectedServerDeckId: null,
  deckTitle: "読み込み中...",
  deckSourceInfo: "",
  deckConditions: {},
  fullDeckCards: [], // 選択されたデッキの全カード配列
  activeDeckCards: [], // 枚数制限適用後のカード配列

  // ゲーム設定 (Game Settings)
  settings: {
    cardLimit: 30, // 0 = 全枚数, 30, 60, 100 (初心者が試しやすいよう標準30枚)
    unitMode: "household", // 'household' | 'single'
    tapMode: "one_tap", // 'one_tap' | 'two_tap'
    assistMode: "guided", // 'guided' | 'challenge'
    classroomUnlock: "all_open", // 'all_open' | 'staged'
    timerSeconds: 0, // 0 = 手動, 30, 45, 60, 90
    soundEnabled: true,
    autoSplitPets: true, // ペット同行世帯でペットを自動的に渡り廊下(ペット区画)へ分離配置
  },

  // 進行状態
  phase: "setup", // 'setup' | 'playing' | 'completed'
  steps: [], // スライド/ターン単位の配列
  currentStepIdx: 0,
  activeAreaTab: "gym", // 'grounds' | 'gym' | 'floor1' | 'floor2' | 'floor3' | 'external'
  selectedRoomId: null, // two_tap モード時または選択中の部屋ID
  dockSize: "normal", // 'compact' | 'normal' | 'expanded'
  dockViewMode: "illust", // 'illust' (大型イラスト＆吹き出し) | 'card' (公式HUGカード実物表示)

  // 3Dミニチュア・カメラ ＆ 直接コマ移動 ＆ イベントメモ
  camera: {
    mode: "3d", // '3d' | 'flat'
    scope: "area", // 'area' | 'all'
    rotZ: -1.5,
    tiltX: 13,
    zoom: 0.96,
    panX: 0,
    panY: 0,
  },
  movingPawn: null, // { cardNo, fromRoomId, scope: 'group' | 'person' }
  eventMemos: {}, // cardNo -> { stepIdx, cardNo, title, memo, updatedAt }

  // 部屋・施設状態と配置データ
  rooms: {}, // roomId -> { ...roomDef, status, closed, locked, note }
  placements: {}, // card_number -> { roomId, card, stepIdx, movedCount, reason }
  operationLogs: [], // { stepIdx, cardNo, title, actionText, targetRoomId, evaluation }
  undoStack: [], // 1手戻す用のスナップショット配列

  // タイマー
  elapsedSeconds: 0,
  elapsedTimerId: null,
  stepRemainingSeconds: 0,
  stepTimerId: null,
  isPaused: false,
};

// ============================================================================
// トースト通知
// ============================================================================
export function clearGameToasts() {
  const container = document.getElementById("hg-toast-container");
  if (container) container.innerHTML = "";
}

export function showGameToast(message, type = "info", duration = 2200) {
  const container = document.getElementById("hg-toast-container");
  if (!container) return;
  container.innerHTML = "";
  const el = document.createElement("div");
  el.className = `hg-toast toast-${type}`;
  el.setAttribute("data-testid", "hg-toast");
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, duration);
}

// ============================================================================
// データベース＆サーバ保存デッキの読み込み
// ============================================================================
const groupFirstMemberMap = new Map();

function initDatabaseContext(db) {
  if (!db) return;
  gameState.db = db;
  store.schema = db.schema || {};
  store.imageIds = new Set(db.image_ids || []);
  const imageMeta = db.image_meta || {};
  store.resolveImageUrl = (origId, ver = "") => {
    const meta = imageMeta[origId];
    const ext = (meta && meta.ext) || ".png";
    const q = ver ? `?v=${encodeURIComponent(ver)}` : "";
    return `./data/images/${encodeURIComponent(origId)}${ext}${q}`;
  };

  groupFirstMemberMap.clear();
  for (const m of db.group_members || []) {
    if (m.group_id && !groupFirstMemberMap.has(m.group_id)) {
      groupFirstMemberMap.set(m.group_id, m.member_id);
    }
  }
}

export function buildFallbackIllustrationSvg(kind = "person") {
  const palette =
    kind === "event"
      ? { bg: "#fee2e2", stroke: "#ef4444", icon: "⚡" }
      : kind === "pet"
      ? { bg: "#d1fae5", stroke: "#10b981", icon: "🐾" }
      : { bg: "#dbeafe", stroke: "#3b82f6", icon: "👤" };
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
        `<rect width="120" height="120" rx="18" fill="${palette.bg}" stroke="${palette.stroke}" stroke-width="4"/>` +
        `<text x="60" y="72" text-anchor="middle" font-size="50">${palette.icon}</text>` +
        `</svg>`
    )
  );
}

export function getCardIllustrationUrl(card) {
  if (!card) return buildFallbackIllustrationSvg("person");
  const origId = String(
    card.original_id || card.card_id || card.data?.member_id || card.data?.card_id || ""
  ).trim();
  const isEvent = card.kind === "event" || card.type === "イベント";
  const isPet = card.kind === "pet" || card.data?.data_type === "ペット";
  const kind = isEvent ? "event" : isPet ? "pet" : "person";

  if (origId && store.imageIds instanceof Set && store.imageIds.has(origId)) {
    return store.resolveImageUrl(origId);
  }
  return buildFallbackIllustrationSvg(kind);
}

function getDeckPreviewSamples(deckObj) {
  const samples = [];
  const seen = new Set();
  const orderIds = Array.isArray(deckObj?.manual_order) ? deckObj.manual_order : [];
  for (const uid of orderIds) {
    const resolvedId = String(uid).startsWith("GRP-")
      ? groupFirstMemberMap.get(uid) || ""
      : String(uid);
    if (
      resolvedId &&
      !seen.has(resolvedId) &&
      store.imageIds instanceof Set &&
      store.imageIds.has(resolvedId)
    ) {
      seen.add(resolvedId);
      samples.push({
        id: resolvedId,
        url: store.resolveImageUrl(resolvedId),
      });
      if (samples.length >= 3) break;
    }
  }
  const fallbackIds = ["M-6054", "EV-847", "M-6064"];
  for (const fid of fallbackIds) {
    if (samples.length >= 3) break;
    if (!seen.has(fid) && store.imageIds instanceof Set && store.imageIds.has(fid)) {
      seen.add(fid);
      samples.push({ id: fid, url: store.resolveImageUrl(fid) });
    }
  }
  return samples;
}

async function loadCardDatabase() {
  const candidates = ["./data/cards_db.json", "/data/cards_db.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) {
        const db = await res.json();
        initDatabaseContext(db);
        return db;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function shouldQueryServerApi() {
  const host = String(window.location?.hostname || "").toLowerCase();
  return !host.endsWith(".github.io");
}

export async function fetchServerSavedDecks() {
  const staticDecks = Array.isArray(gameState.db?.saved_decks)
    ? gameState.db.saved_decks.map((d) => ({ ...d, _fromApi: false }))
    : [];
  let apiDecks = [];

  if (shouldQueryServerApi()) {
    try {
      const res = await fetch("/api/decks", { cache: "no-cache" });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          apiDecks = list.map((d) => ({ ...d, _fromApi: true }));
        }
      }
    } catch {
      // fallback to static JSON
    }
  }

  // API保存デッキを優先しつつ、cards_db.json の保存済みデッキ（五小rev5・基本セット等）も統合
  const merged = [...apiDecks];
  const seenNames = new Set(apiDecks.map((d) => String(d.name || "").trim()));
  const seenIds = new Set(apiDecks.map((d) => String(d.id)));
  for (const sd of staticDecks) {
    const sName = String(sd.name || "").trim();
    if (seenNames.has(sName)) continue;
    const syntheticId = seenIds.has(String(sd.id)) ? `static-${sd.id}` : sd.id;
    merged.push({ ...sd, id: syntheticId, _rawStaticId: sd.id, _fromApi: false });
  }

  gameState.serverDecks = merged;
  return merged;
}

function annotateDeckGroupPositions(cards) {
  const posList = computeGroupPositionsByIndex(cards);
  return (cards || []).map((c, idx) => {
    const pos = posList[idx];
    if (!pos) return c;
    return {
      ...c,
      group_index: pos.group_index,
      group_total: pos.group_total,
    };
  });
}

export async function loadServerDeckById(deckId) {
  const knownEntry = (gameState.serverDecks || []).find((d) => String(d.id) === String(deckId));
  let detail = null;
  let fetchedFromServer = false;

  if (shouldQueryServerApi() && (!knownEntry || knownEntry._fromApi)) {
    try {
      const res = await fetch(`/api/decks/${deckId}`, { cache: "no-cache" });
      if (res.ok) {
        detail = await res.json();
        fetchedFromServer = true;
      }
    } catch {
      // fallback
    }
  }
  if (!detail && knownEntry) {
    detail = knownEntry;
  }
  if (!detail && Array.isArray(gameState.db?.saved_decks)) {
    detail =
      gameState.db.saved_decks.find(
        (d) => String(d.id) === String(deckId) || `static-${d.id}` === String(deckId)
      ) || null;
  }
  if (!detail) return false;

  const cond = detail.conditions || {};
  let builtCards = null;

  if (fetchedFromServer) {
    try {
      const buildRes = await fetch("/api/deck/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions: cond,
          resolutions: detail.resolutions || {},
          manual_order: detail.manual_order || null,
          excluded_ids: Array.isArray(cond.excluded_ids) ? cond.excluded_ids : [],
        }),
      });
      if (buildRes.ok) {
        const built = await buildRes.json();
        const cards = built.deck?.cards || built.cards || [];
        if (cards.length > 0) {
          builtCards = annotateDeckGroupPositions(
            cards.map((c, i) => ({
              card_number: c.card_number || i + 1,
              original_id: c.original_id || c.card_id,
              kind: c.kind,
              data: c.data || c,
              group: c.group
                ? {
                    ...c.group,
                    group_id: c.new_group_id || c.group.group_id || c.group_id,
                  }
                : null,
              group_id: c.new_group_id || c.group_id,
              group_name: c.group_name,
              group_index: c.group_index,
              group_total: c.group_total,
            }))
          );
        }
      }
    } catch {
      // fallback to client build
    }
  }

  if ((!builtCards || builtCards.length === 0) && gameState.db) {
    const built = buildInitialDeck(gameState.db, cond, {
      phaseFirst: false,
      resolutions: detail.resolutions || {},
      manualOrder: detail.manual_order || null,
      excludedIds: Array.isArray(cond.excluded_ids) ? cond.excluded_ids : [],
    });
    builtCards = built.cardEntries || [];
  }

  if (!builtCards || builtCards.length === 0) return false;

  gameState.selectedDeckSource = "server";
  gameState.selectedServerDeckId = detail.id;
  gameState.fullDeckCards = builtCards;
  gameState.deckTitle = detail.name || `保存デッキ #${deckId}`;
  gameState.deckSourceInfo = `サーバ保存済みデッキ (${builtCards.length}枚)`;
  gameState.deckConditions = cond;
  return true;
}

export async function loadServerDeckByName(deckName) {
  const target = String(deckName || "").trim();
  if (!target) return false;
  const list = gameState.serverDecks.length ? gameState.serverDecks : await fetchServerSavedDecks();
  const matched =
    list.find((d) => String(d.name || "") === target) ||
    list.find((d) => String(d.name || "").trim() === target);
  if (!matched) return false;
  return loadServerDeckById(matched.id);
}

export function loadLocalWebDeck() {
  const raw = localStorage.getItem("hug_web_deck_state_v1");
  if (!raw || !gameState.db) return false;
  try {
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.cardOrigIds) || saved.cardOrigIds.length === 0) return false;
    const allDbCards = buildAllDatabaseCardEntries(gameState.db);
    const dbCardByOrigId = new Map(allDbCards.map((c) => [c.original_id, c]));
    const originOverrides = saved.originOverrides || saved.conditions?.origin_overrides || {};

    const entries = [];
    for (const oid of saved.cardOrigIds) {
      const dbEntry = dbCardByOrigId.get(String(oid));
      if (dbEntry) {
        const d = structuredClone(dbEntry.data);
        const grp = dbEntry.group ? structuredClone(dbEntry.group) : null;
        const overrideOrigin = originOverrides[String(dbEntry.group_id)];
        if (overrideOrigin) {
          if (grp) grp.evacuation_origin = overrideOrigin;
          if (d) d.evacuation_origin = overrideOrigin;
        }
        entries.push({
          original_id: dbEntry.original_id,
          kind: dbEntry.kind,
          unit_id: dbEntry.unit_id,
          group_id: dbEntry.group_id,
          group_name: dbEntry.group_name,
          data: d,
          group: grp,
        });
      }
    }
    if (entries.length === 0) return false;
    gameState.selectedDeckSource = "local";
    gameState.selectedServerDeckId = null;
    gameState.fullDeckCards = renumberDeckCards(entries, gameState.db);
    gameState.deckTitle = "Webツール作成デッキ";
    gameState.deckSourceInfo = `ブラウザ保存デッキ (${gameState.fullDeckCards.length}枚)`;
    gameState.deckConditions = saved.conditions || {};
    return true;
  } catch {
    return false;
  }
}

export function loadJsonDeckString(jsonText, fileName = "JSONデッキ") {
  let result;
  if (gameState.db) {
    result = importDeckFromJsonText(jsonText, gameState.db);
  } else {
    const parsed = JSON.parse(jsonText);
    const cards = parsed.cards || parsed.deck_cards || parsed.cards_event || [];
    result = {
      deckCards: annotateDeckGroupPositions(
        cards.map((c, i) => {
          const rawData = c.data || c;
          const grp = c.group || null;
          const gid = c.group_id || rawData.group_id || grp?.group_id || null;
          return {
            card_number: c.card_number || i + 1,
            original_id: c.card_id || c.original_id || rawData.member_id || `C-${i + 1}`,
            kind: c.kind || (c.event_id ? "event" : rawData.data_type === "ペット" ? "pet" : "person"),
            data: rawData,
            group_id: gid,
            group_name: c.group_name || grp?.group_name || null,
            group: grp,
          };
        })
      ),
    };
  }
  if (!result?.deckCards || result.deckCards.length === 0) {
    throw new Error("有効なカードが見つかりませんでした");
  }
  gameState.selectedDeckSource = "json";
  gameState.selectedServerDeckId = null;
  gameState.fullDeckCards = result.deckCards;
  gameState.deckTitle = fileName.replace(/\.json$/i, "");
  gameState.deckSourceInfo = `JSONファイル (${result.deckCards.length}枚)`;
  gameState.deckConditions = result.restoredConditions || {};
  return true;
}

// ============================================================================
// カード適性判定＆推奨エリアエンジン (Suitability & Assist Engine)
// ============================================================================
export function analyzeStepCharacteristics(step) {
  const cards = step.cards || [];
  const humans = cards.filter((c) => c.kind !== "pet" && c.kind !== "event");
  const pets = cards.filter((c) => c.kind === "pet" || c.data?.data_type === "ペット");

  const allText = cards
    .map((c) => {
      const d = c.data || {};
      return [
        d.name,
        d.gender,
        ...(Array.isArray(d.attributes) ? d.attributes : []),
        ...(Array.isArray(d.vulnerabilities) ? d.vulnerabilities : []),
        ...(Array.isArray(d.health_condition) ? d.health_condition : []),
        ...(Array.isArray(d.skills) ? d.skills : []),
        d.statement,
        d.training_point,
        c.group?.group_name,
        c.group?.evacuation_origin,
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join(" ");

  const hasInfection = /発熱|嘔吐|下痢|ノロ|インフル|コロナ|感染|高熱/.test(allText);
  const needsPowerOrMedical = /電源|人工透析|酸素|インスリン|骨折|意識障害|重傷|出血|医療機器|心臓/.test(allText);
  const hasMobilityIssue =
    /車椅子|車いす|足腰|杖|歩行困難|階段.*無理|視覚障害|全盲|要介護|寝たきり|リウマチ|麻痺/.test(allText) ||
    humans.some((h) => Number(h.data?.age) >= 78 && /足|膝|腰|歩/.test(allText));
  const hasInfantOrMaternal =
    /乳幼児|授乳|おむつ|ミルク|夜泣き|妊婦|妊娠|赤ちゃん/.test(allText) ||
    humans.some((h) => Number(h.data?.age) <= 3);
  const needsPrivacyOrQuiet =
    /LGBTQ|性自認|更衣|着替え|視線|個室|大勢.*無理|パニック|自閉|発達障害|精神的ショック|静か/.test(allText);
  const isHomeEvacuee = /在宅避難/.test(allText);
  const isCommuterOrVisitor =
    /帰宅困難|旅行者|観光客|出張|駅|電車/.test(allText) ||
    humans.some((h) => /その他（市外）|市外/.test(h.group?.evacuation_origin || h.data?.evacuation_origin || ""));
  const isPetOnly = pets.length > 0 && humans.length === 0;
  const hasPetWithHumans = pets.length > 0 && humans.length > 0;

  // 推奨部屋リスト（優先順）
  let recommendedRooms = [];
  let reasonLabel = "一般居住区画（体育館・普通教室）";

  if (isPetOnly) {
    recommendedRooms = ["corridor-pet", "schoolyard-main"];
    reasonLabel = "🐾 ペット専用区画（渡り廊下・ピロティ）";
  } else if (isHomeEvacuee) {
    recommendedRooms = ["ext-home", "entrance-reception"];
    reasonLabel = "🏠 在宅避難者（名簿登録・物資/トイレ案内）";
  } else if (hasInfection) {
    recommendedRooms = ["f3-isolation-a", "f3-isolation-b", "f1-infirmary"];
    reasonLabel = "🦠 感染症疑い・発熱（3F 専用隔離室で動線分離）";
  } else if (needsPowerOrMedical) {
    recommendedRooms = ["f1-infirmary", "f1-welfare", "ext-hospital"];
    reasonLabel = "🏥 救護・医療機器電源（1F 保健室 / 福祉教室）";
  } else if (hasMobilityIssue) {
    recommendedRooms = ["f1-welfare", "gym-a", "f1-infirmary"];
    reasonLabel = "♿ バリアフリー・1階移動配慮（1F福祉教室 / 体育館A入口側）";
  } else if (hasInfantOrMaternal) {
    recommendedRooms = ["f1-nursery", "f2-family", "gym-c"];
    reasonLabel = "🍼 乳幼児・妊婦配慮（1F授乳和室 / 2F子育て教室 / 体育館C）";
  } else if (needsPrivacyOrQuiet) {
    recommendedRooms = ["f1-nursery", "f2-quiet", "f2-library"];
    reasonLabel = "🌙 プライバシー・静養配慮（1F相談和室 / 2F静養室）";
  } else if (isCommuterOrVisitor) {
    recommendedRooms = ["f3-commuter", "gym-f", "gym-d"];
    reasonLabel = "🚆 帰宅困難者・一時滞在（3F 3-1教室 / 体育館D・F）";
  } else {
    recommendedRooms = ["gym-b", "gym-d", "gym-e", "gym-c", "f2-general-a", "f3-general-b"];
    reasonLabel = "🏠 一般世帯区画（体育館B/D/E・2F/3F普通教室）";
  }

  // 閉鎖中・ロック中の部屋を除外した有効推奨リスト
  const openRecommended = recommendedRooms.filter((rid) => {
    const r = gameState.rooms[rid];
    return r && !r.closed && !r.locked;
  });

  return {
    humans,
    pets,
    isPetOnly,
    hasPetWithHumans,
    hasInfection,
    needsPowerOrMedical,
    hasMobilityIssue,
    hasInfantOrMaternal,
    needsPrivacyOrQuiet,
    isHomeEvacuee,
    isCommuterOrVisitor,
    recommendedRooms: openRecommended.length > 0 ? openRecommended : recommendedRooms,
    reasonLabel,
  };
}

// ============================================================================
// イベントカードの解析＆インタラクティブ選択肢生成
// ============================================================================
export function analyzeEventCard(card) {
  const d = card.data || {};
  const eid = String(card.original_id || d.card_id || "");
  const title = d.event_name || card.title || "イベント";
  const content = d.content || "";
  const text = `${title} ${content} ${d.training_point || ""}`;

  // 1. 救急搬送・ドクターヘリ (EV-875, EV-876, EV-877, EV-878)
  if (/EV-87[5678]/.test(eid) || /救急車.*到着|ドクターヘリ/.test(title)) {
    return {
      type: "transfer",
      targetRoomId: "ext-hospital",
      targetAreaTab: "external",
      badgeText: "🚑 救急搬送イベント",
      maxSelect: 3,
      filterHint: "骨折・意識障害・重傷・人工透析・慢性疾患悪化などの傷病者と家族を選択",
      scoreCandidate: (c) => {
        const t = JSON.stringify(c.data || {});
        if (/骨折|意識|重傷|ショック|透析|酸素|インスリン|発作|高熱/.test(t)) return 3;
        if ((c.data?.health_condition || []).some((h) => h !== "良好")) return 2;
        return 0;
      },
    };
  }

  // 2. 福祉避難所・専門施設移送 (EV-863, EV-882, EV-883, EV-884)
  if (/EV-88[234]|EV-863/.test(eid) || /老人ホーム|障害者支援施設|母子生活支援施設|福祉避難所への移送/.test(title)) {
    const isMaternal = /母子|妊婦|乳幼児/.test(text);
    const isDisabilityPower = /障害者|電源/.test(text);
    return {
      type: "transfer",
      targetRoomId: "ext-welfare",
      targetAreaTab: "external",
      badgeText: "🏥 福祉・専門施設移送",
      maxSelect: 4,
      filterHint: isMaternal
        ? "妊婦または乳幼児連れ世帯を選択して母子支援施設へ移送"
        : isDisabilityPower
        ? "障害のある方・非常用電源が必要な方を選択して支援施設へ移送"
        : "要介護高齢者・車椅子利用者を選択して福祉避難所/特養へ移送",
      scoreCandidate: (c) => {
        const t = JSON.stringify(c.data || {});
        if (isMaternal && (/妊婦|乳幼児|授乳|赤ちゃん/.test(t) || Number(c.data?.age) <= 3)) return 3;
        if (isDisabilityPower && /障害|電源|透析|酸素|自閉/.test(t)) return 3;
        if (/車椅子|要介護|足腰|杖|寝たきり/.test(t) || Number(c.data?.age) >= 75) return 3;
        return 0;
      },
    };
  }

  // 3. 広域避難バス・みなし仮設・親戚宅退所 (EV-885, EV-886, EV-887, EV-891, EV-892)
  if (/EV-88[567]|EV-89[12]/.test(eid) || /広域避難バス|みなし仮設|親戚宅への縁故避難/.test(title)) {
    const isBus = /バス/.test(title);
    return {
      type: "transfer",
      targetRoomId: "ext-departed",
      targetAreaTab: "external",
      badgeText: "🚌 退所・広域移動イベント",
      maxSelect: 5,
      filterHint: isBus
        ? "市外避難者・帰宅困難者・移動可能な単身者等を選択してバスで送り出す"
        : "対象世帯を選択してみなし仮設住宅・親戚宅へ退所手続きを行う",
      scoreCandidate: (c) => {
        const t = JSON.stringify(c.data || {}) + (c.group?.evacuation_origin || "");
        if (isBus && /市外|帰宅困難|旅行|出張/.test(t)) return 3;
        if (!isBus) return 2;
        return 1;
      },
    };
  }

  // 4. 感染症発生（ノロ・インフル・コロナ疑い: EV-879, EV-880, EV-881, EV-804）
  if (/EV-879|EV-880|EV-881|EV-804/.test(eid) || /感染症発生|ノロウイルス|インフルエンザ|新型コロナ/.test(title)) {
    return {
      type: "relocate_infection",
      targetAreaTab: "floor3",
      isolationRoomId: gameState.rooms["f3-isolation-a"]?.closed ? "f3-isolation-b" : "f3-isolation-a",
      badgeText: "🦠 感染症隔離・配置変更",
    };
  }

  // 5. 体育館壁面の亀裂・下水逆流 (EV-798, EV-833)
  if (/EV-798|EV-833/.test(eid) || /体育館壁面の亀裂|下水逆流による体育館床/.test(title)) {
    const closedRoomId = /EV-798|亀裂/.test(eid + title) ? "gym-f" : "gym-d";
    return {
      type: "room_closure",
      targetAreaTab: "gym",
      closedRoomId,
      fallbackRoomId: "f3-general-b",
      badgeText: "⚠️ 体育館区画閉鎖・再配置",
    };
  }

  // 6. 教室の雨漏り・救護拡張・騒音口論・学校再開 (EV-888, EV-889, EV-890, EV-864)
  if (/EV-888|EV-889|EV-890|EV-864/.test(eid) || /教室の雨漏り|騒音口論と区画移動|救護・物資拠点の拡張|学校再開の調整/.test(title)) {
    return {
      type: "room_relocate",
      targetAreaTab: /体育館/.test(title) ? "gym" : "floor2",
      badgeText: "🔄 部屋・区画の再配置",
    };
  }

  // 7. 第五小学校の校庭・門・トイレ・設備・運営判断イベント
  let targetAreaTab = "grounds";
  let targetRoomId = "f1-hq";
  let facilityStatusUpdate = "対応済";
  let choices = [];

  if (/マンホールトイレ|EV-774|EV-775|EV-847|EV-788|EV-789|EV-790|EV-791|EV-792|EV-809|EV-810|EV-816/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "manhole-toilet";
    facilityStatusUpdate = "✅ 設営・管理済(10基)";
    choices = [
      {
        label: "✅ プレハブ倉庫から資機材を出し、正門北側・体育館東側にマンホールトイレ設営＆利用ルール掲示",
        status: "✅ 稼働中(10基)",
        good: true,
      },
      {
        label: "💧 プール水・ポンプ連携と清掃輪番シフト・夜間照明を整備して案内する",
        status: "✅ 衛生管理・照明済",
        good: true,
      },
      {
        label: "⏳ 人手が足りないため後回しにし、既存トイレの我慢を呼びかける",
        status: "⚠️ 対応遅延",
        good: false,
      },
    ];
  } else if (/プール|受水槽|給水|飲料水|EV-763|EV-786|EV-811|EV-815|EV-822|EV-837|EV-848/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "pool-water";
    choices = [
      {
        label: "✅ プール水をトイレ洗浄専用に区分し、飲料水は要配慮者優先・給水車連携で厳格管理する",
        status: "✅ 用水区分・給水管理済",
        good: true,
      },
      {
        label: "📢 市対策本部へ給水・代替ポンプを要請し、掲示板で配給ルールを透明に周知する",
        status: "✅ 本部要請・周知済",
        good: true,
      },
      {
        label: "⏳ 先着順で自由に水を汲んでもらい、なくなったらその時点で考える",
        status: "⚠️ 水資源管理不足",
        good: false,
      },
    ];
  } else if (/正門|塀倒壊|違法駐車|自家用車|広報掲示|EV-721|EV-729|EV-734|EV-776|EV-795/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "gate-main";
    choices = [
      {
        label: "✅ 正門前の危険箇所立入禁止・車両進入規制を行い、正門掲示板に開所/支援情報を大きく掲示",
        status: "✅ 安全規制・掲示板稼働",
        good: true,
      },
      {
        label: "🚧 緊急車両動線を確保し、歩行者は安全な北門・東門または誘導ラインへ案内する",
        status: "✅ 動線分離・誘導済",
        good: true,
      },
      {
        label: "⏳ 特に規制せず、避難者の自主的な通行・駐車に任せる",
        status: "⚠️ 動線未整理",
        good: false,
      },
    ];
  } else if (/受付|昇降口|土足|上履き|検温|消毒|EV-740|EV-753|EV-766|EV-787|EV-846|EV-871/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "entrance-reception";
    choices = [
      {
        label: "✅ 児童昇降口に総合受付・検温消毒を設置し、上履き切替ルールと要配慮者優先レーンを整備",
        status: "✅ 総合受付・検温稼働中",
        good: true,
      },
      {
        label: "📋 避難者協力者を募って受付窓口を増設し、在宅避難者登録窓口も分けて混雑を緩和する",
        status: "✅ 窓口増設・在宅登録対応",
        good: true,
      },
      {
        label: "⏳ 受付手続きを省略して全員そのまま館内へ入れる",
        status: "⚠️ 名簿・衛生未確認",
        good: false,
      },
    ];
  } else if (/ペット|犬|猫|獣医|EV-737|EV-782|EV-801|EV-806|EV-807|EV-820|EV-827|EV-832/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "corridor-pet";
    choices = [
      {
        label: "✅ 渡り廊下・ピロティをペット専用飼育区画とし、ケージ管理・清掃規約・獣医師連携を徹底",
        status: "✅ 専用区画・規約運用中",
        good: true,
      },
      {
        label: "🐾 鳴き声・臭い対策として居住区との距離を調整し、飼い主の会（自主管理ルール）を作る",
        status: "✅ 飼い主自主管理稼働",
        good: true,
      },
      {
        label: "⏳ 体育館の一般居住区画内へのペット持ち込みを許可する",
        status: "⚠️ アレルギー・トラブル懸念",
        good: false,
      },
    ];
  } else if (/ごみ|カラス|喫煙|タバコ|EV-834|EV-835|EV-851|EV-858/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "trash-smoking";
    choices = [
      {
        label: "✅ 正門横ごみ集積所で一般ごみと感染性廃棄物(おむつ等)を二重袋分別・防鳥ネット設置＆敷地端風下に指定喫煙所を設定",
        status: "✅ 分別密閉・分煙徹底",
        good: true,
      },
      {
        label: "📢 館内・校舎周辺の全面禁煙とゴミ出しルールを掲示・アナウンスし衛生班で巡回する",
        status: "✅ 衛生・禁煙ルール周知",
        good: true,
      },
      {
        label: "⏳ 各自で適宜ごみ置き場や建物陰を使うよう伝える",
        status: "⚠️ 衛生・防火リスク",
        good: false,
      },
    ];
  } else if (/校庭|入浴|自衛隊|防犯灯|夜間|火災|煙|EV-730|EV-733|EV-781|EV-793|EV-813|EV-839|EV-843|EV-857|EV-860|EV-865/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "schoolyard-main";
    choices = [
      {
        label: "✅ 校庭の誘導動線・防犯照明（バルーンライト）・時間割（避難者/在宅者区分）を整備し安全を確保",
        status: "✅ 照明・時間割・安全確保済",
        good: true,
      },
      {
        label: "👥 要配慮者を優先誘導し、夜間ペア巡回や防煙・風向き警戒体制を立ち上げる",
        status: "✅ 優先誘導・警戒体制稼働",
        good: true,
      },
      {
        label: "⏳ 特別な誘導や時間割は設けず、来た順に対応させる",
        status: "⚠️ 校庭混雑・安全懸念",
        good: false,
      },
    ];
  } else if (/毛布|物資|倉庫|食料|アレルギー|ミルク|おむつ|EV-746|EV-765|EV-768|EV-797|EV-800|EV-802|EV-803|EV-812|EV-842|EV-844|EV-850|EV-853|EV-873/.test(eid + title)) {
    targetAreaTab = "grounds";
    targetRoomId = "prefab-warehouse";
    choices = [
      {
        label: "✅ 要配慮者・アレルギー対応を最優先で確保し、整理券・事前予告制で公平に配給（余剰は1F多目的室・東部公園連携で保管）",
        status: "✅ 優先配給・アレルギー確認済",
        good: true,
      },
      {
        label: "📦 避難者ボランティアと連携して荷下ろし動線を作り、在宅避難者登録分も含め透明に配分する",
        status: "✅ 搬入・公平配給稼働",
        good: true,
      },
      {
        label: "⏳ 早い者勝ちで倉庫前から直接配り始める",
        status: "⚠️ 配給混乱・誤食リスク",
        good: false,
      },
    ];
  } else if (/救護|薬|インスリン|電源|意識障害|過呼吸|アナフィラキシー|心のケア|EV-742|EV-743|EV-784|EV-799|EV-824|EV-838|EV-862|EV-870/.test(eid + title)) {
    targetAreaTab = "floor1";
    targetRoomId = "f1-infirmary";
    choices = [
      {
        label: "✅ 1F保健室に救護所・非常用電源（医療機器・保冷優先）を確保し、医師/看護師スキル保持者・市医療班と連携",
        status: "✅ 救護所・非常用電源稼働",
        good: true,
      },
      {
        label: "🏥 重症度トリアージを行い、緊急搬送や専門相談窓口（メンタルケア）を速やかに手配する",
        status: "✅ トリアージ・医療連携済",
        good: true,
      },
      {
        label: "⏳ 一般区画でそのまま安静にして様子を見てもらう",
        status: "⚠️ 救護対応不足",
        good: false,
      },
    ];
  } else if (/授乳|更衣|プライバシー|夜泣き|個室|女性|EV-741|EV-745|EV-761|EV-767/.test(eid + title)) {
    targetAreaTab = "floor1";
    targetRoomId = "f1-nursery";
    choices = [
      {
        label: "✅ 1F相談室・和室に授乳・おむつ替え・女性更衣の専用空間を設け、2F子育て/静養教室も活用して配慮",
        status: "✅ 授乳・更衣・配慮室稼働",
        good: true,
      },
      {
        label: "🛡️ パーテーション・間仕切りを設置し、女性スタッフ中心の相談・見守り体制を整える",
        status: "✅ 間仕切り・見守り済",
        good: true,
      },
      {
        label: "⏳ 体育館の隅でタオル等をかけて対応してもらう",
        status: "⚠️ プライバシー不足",
        good: false,
      },
    ];
  } else if (/体育館|段差|スロープ|床面|区画|熱中症|氷点下|停電|EV-736|EV-748|EV-752|EV-754|EV-756|EV-825|EV-826|EV-867|EV-868/.test(eid + title)) {
    targetAreaTab = "gym";
    targetRoomId = "gym-a";
    choices = [
      {
        label: "✅ 体育館の安全点検・清掃・2m通路区画引きを行い、玄関スロープ設置と要配慮者の冷暖房教室優先移動を実施",
        status: "✅ スロープ・安全区画整備済",
        good: true,
      },
      {
        label: "🔦 非常用照明・空調/防寒対策を起動し、出入口近くに高齢者区画を確保して誘導する",
        status: "✅ 環境・バリアフリー対策済",
        good: true,
      },
      {
        label: "⏳ 点検や区画引きを省き、空いている場所へ自由に入ってもらう",
        status: "⚠️ 通路・安全未確保",
        good: false,
      },
    ];
  } else {
    // 本部・広報・ボランティア・報道・防犯等の運営全般 (f1-hq)
    targetAreaTab = "floor1";
    targetRoomId = "f1-hq";
    choices = [
      {
        label: "✅ 1F運営本部（本部長・各班リーダー）で方針を決定し、多言語・視覚掲示板と館内アナウンスで全員に周知徹底",
        status: "✅ 本部決定・広報掲示済",
        good: true,
      },
      {
        label: "🤝 避難者の自主運営班（輪番制）や外部支援窓口（ボラセン・報道腕章ルール）を一元化して対応する",
        status: "✅ 自主運営・窓口一元化済",
        good: true,
      },
      {
        label: "⏳ 個別の問い合わせが来た時だけ口頭で対応する",
        status: "⚠️ 周知・統制不足",
        good: false,
      },
    ];
  }

  return {
    type: "operational",
    targetAreaTab,
    targetRoomId,
    facilityStatusUpdate,
    badgeText: "⚡ 避難所運営・設備判断",
    choices,
  };
}

// ============================================================================
// デッキからゲーム進行ステップ (steps) を生成
// ============================================================================
export function buildGameSteps(cards, unitMode = "household") {
  if (unitMode === "single") {
    return cards.map((c, idx) => ({
      stepIdx: idx,
      isEvent: c.kind === "event",
      isHousehold: c.kind !== "event",
      groupId: c.group_id || null,
      group: c.group || null,
      cards: [c],
      startNo: c.card_number,
      endNo: c.card_number,
      title:
        c.kind === "event"
          ? c.data?.event_name || c.title || "イベント"
          : c.data?.name || c.title || "避難者",
    }));
  }

  const steps = [];
  for (const card of cards) {
    const isHH = card.kind !== "event" && Boolean(card.group_id);
    const last = steps[steps.length - 1];
    if (isHH && last && last.isHousehold && last.groupId === card.group_id) {
      last.cards.push(card);
      last.endNo = card.card_number;
    } else {
      steps.push({
        stepIdx: steps.length,
        isEvent: card.kind === "event",
        isHousehold: isHH,
        groupId: isHH ? card.group_id : null,
        group: card.group || null,
        cards: [card],
        startNo: card.card_number,
        endNo: card.card_number,
        title: isHH
          ? `${card.group?.group_name || card.group_name || card.data?.name || "避難世帯"}`
          : card.data?.event_name || card.title || "イベント",
      });
    }
  }
  return steps;
}

// ============================================================================
// 部屋データの初期化＆集計ユーティリティ
// ============================================================================
function initRoomsState() {
  const rooms = {};
  const stagedUnlock = gameState.settings.classroomUnlock === "staged";
  for (const def of INITIAL_ROOMS) {
    const isUpperFloor = def.areaId === "floor2" || def.areaId === "floor3";
    rooms[def.id] = {
      ...def,
      status: def.defaultStatus || "開放中",
      closed: false,
      locked: stagedUnlock && isUpperFloor,
      note: "",
    };
  }
  gameState.rooms = rooms;
}

export function getRoomOccupants(roomId) {
  const list = [];
  for (const [cardNoStr, p] of Object.entries(gameState.placements)) {
    if (p && p.roomId === roomId) {
      list.push(p);
    }
  }
  list.sort((a, b) => a.card.card_number - b.card.card_number);
  return list;
}

export function getAreaOccupantCount(areaId) {
  let count = 0;
  for (const p of Object.values(gameState.placements)) {
    if (!p) continue;
    const room = gameState.rooms[p.roomId];
    if (room && room.areaId === areaId) {
      count++;
    }
  }
  return count;
}

export function getTotalShelterPopulation() {
  let persons = 0;
  let pets = 0;
  let external = 0;
  for (const p of Object.values(gameState.placements)) {
    if (!p) continue;
    const room = gameState.rooms[p.roomId];
    if (!room) continue;
    if (room.isExternal) {
      external++;
    } else if (p.card.kind === "pet" || p.card.data?.data_type === "ペット") {
      pets++;
    } else {
      persons++;
    }
  }
  return { persons, pets, external };
}

// ============================================================================
// Undo スナップショット管理
// ============================================================================
function saveUndoSnapshot() {
  gameState.undoStack.push({
    currentStepIdx: gameState.currentStepIdx,
    activeAreaTab: gameState.activeAreaTab,
    rooms: structuredClone(gameState.rooms),
    placements: structuredClone(gameState.placements),
    operationLogs: structuredClone(gameState.operationLogs),
    eventMemos: structuredClone(gameState.eventMemos),
  });
  if (gameState.undoStack.length > 40) {
    gameState.undoStack.shift();
  }
}

export function undoLastAction() {
  if (gameState.undoStack.length === 0) return false;
  const snap = gameState.undoStack.pop();
  gameState.currentStepIdx = snap.currentStepIdx;
  gameState.activeAreaTab = snap.activeAreaTab;
  gameState.rooms = snap.rooms;
  gameState.placements = snap.placements;
  gameState.operationLogs = snap.operationLogs;
  gameState.eventMemos = snap.eventMemos || {};
  gameState.selectedRoomId = null;
  gameState.movingPawn = null;
  resetStepTimer();
  renderPlayView();
  showGameToast("↩ 1つ前の状態に戻しました", "info", 1800);
  return true;
}

// ============================================================================
// 1. セットアップ＆ゲーム設定画面 (Setup View) の描画
// ============================================================================
export function renderSetupView() {
  gameState.phase = "setup";
  document.body.classList.add("is-setup");
  document.body.classList.remove("is-playing");
  stopAllTimers();
  clearGameToasts();

  const main = document.getElementById("hg-main");
  if (!main) return;

  const s = gameState.settings;
  const totalFull = gameState.fullDeckCards.length;
  const effectiveCount =
    s.cardLimit > 0 && s.cardLimit < totalFull ? s.cardLimit : totalFull;
  const effectiveSlice = gameState.fullDeckCards.slice(0, effectiveCount);
  const evCount = effectiveSlice.filter((c) => c.kind === "event").length;
  const hhSet = new Set(
    effectiveSlice.filter((c) => c.kind !== "event" && c.group_id).map((c) => c.group_id)
  );
  const personCount = effectiveSlice.filter((c) => c.kind === "person").length;
  const petCount = effectiveSlice.filter((c) => c.kind === "pet").length;
  const hasLocalDeck = Boolean(localStorage.getItem("hug_web_deck_state_v1"));

  const sampleDeckCards = [];
  const sampleSeenKinds = new Set();
  for (const c of effectiveSlice) {
    const k = c.kind || "person";
    if (!sampleSeenKinds.has(k) || sampleDeckCards.length < 6) {
      sampleSeenKinds.add(k);
      sampleDeckCards.push(c);
      if (sampleDeckCards.length >= 6) break;
    }
  }
  const fanPerson = effectiveSlice.find((c) => c.kind === "person") || effectiveSlice[0];
  const fanEvent = effectiveSlice.find((c) => c.kind === "event") || effectiveSlice[1] || fanPerson;
  const fanPet = effectiveSlice.find((c) => c.kind === "pet") || effectiveSlice[2] || fanPerson;
  const fanCards = [fanPerson, fanEvent, fanPet].filter(Boolean);

  main.innerHTML = `
    <div class="hg-setup-wrap" data-testid="hg-setup-view">
      <!-- トップナビバー -->
      <header class="hg-setup-topbar">
        <div class="hg-brand-row">
          <img ${LOGO_IMG_ATTRS} alt="HUG正式ロゴ" class="hg-brand-logo" />
          <div>
            <div class="hg-brand-title">スマホでHUG訓練</div>
            <span class="hg-brand-sub">小平第五小学校 見取り図モデル</span>
          </div>
        </div>
        <div class="hg-setup-nav-links">
          <a href="./training-simple.html" class="hg-btn hg-btn-sm" style="background:#1e293b;color:#e2e8f0;border-color:#334155;">
            🃏 カードめくり版
          </a>
          <a href="./deck.html" class="hg-btn hg-btn-sm" style="background:#1e293b;color:#e2e8f0;border-color:#334155;">
            🛠️ デッキ構築
          </a>
        </div>
      </header>

      <!-- ビジュアルゲームヒーロー -->
      <section class="hg-hero-showcase" data-testid="hg-hero-showcase">
        <div class="hg-hero-copy">
          <span class="hg-hero-kicker">🏫 小平第五小 避難所運営シミュレーション</span>
          <h1 class="hg-hero-heading">カードをみて、部屋をタップするだけ！</h1>
          <div class="hg-hero-steps-Visual">
            <span class="hg-hero-step-pill">1️⃣ 避難者・事件が登場</span>
            <span class="hg-hero-step-pill">2️⃣ 教室・体育館をタップ配置</span>
            <span class="hg-hero-step-pill">3️⃣ 🐕 ペットは渡り廊下へ自動分離</span>
          </div>
          <div class="hg-hero-cta-row">
            <button
              type="button"
              class="hg-btn hg-btn-lg hg-btn-success"
              id="hg-hero-start-btn"
              data-testid="hg-hero-start-btn"
              ${effectiveCount === 0 ? "disabled" : ""}
            >
              🚀 今すぐ訓練をはじめる（${effectiveCount}枚）
            </button>
          </div>
        </div>

        <div class="hg-hero-card-fan" data-testid="hg-hero-card-fan">
          ${fanCards
            .map((c) => {
              const label = c.kind === "event" ? "⚡事件" : c.kind === "pet" ? "🐾ペット" : "👤避難者";
              return `
                <div class="hg-fan-card">
                  <img src="${escapeHtml(getCardIllustrationUrl(c))}" alt="${escapeHtml(c.data?.name || c.data?.event_name || "")}" loading="eager" />
                  <span>${label}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <!-- STEP 1: サーバ保存済みデッキ選択 -->
      <section class="hg-setup-card" data-testid="hg-deck-section">
        <h2 class="hg-setup-section-title">
          <span>① 訓練デッキを選ぶ</span>
          <span class="hg-mark hg-mark-blue">サーバ保存デッキ連動</span>
        </h2>

        <div class="hg-deck-picker-grid" data-testid="hg-server-deck-grid">
          ${gameState.serverDecks
            .map((d) => {
              const isSelected =
                gameState.selectedDeckSource === "server" &&
                String(gameState.selectedServerDeckId) === String(d.id);
              const shelter = d.conditions?.shelter || "共通";
              const disaster = d.conditions?.disaster_type || "地震";
              const thumbs = getDeckPreviewSamples(d);
              return `
                <button
                  type="button"
                  class="hg-deck-choice-card ${isSelected ? "active" : ""}"
                  data-server-deck-id="${d.id}"
                  data-testid="hg-deck-card-${d.id}"
                >
                  <div class="hg-deck-thumb-stack">
                    ${thumbs
                      .map(
                        (t) => `<img class="hg-deck-thumb-img" src="${escapeHtml(t.url)}" alt="${escapeHtml(t.id)}" loading="lazy" />`
                      )
                      .join("")}
                  </div>
                  <div class="hg-deck-choice-head">
                    <span class="hg-deck-choice-name">${escapeHtml(d.name)}</span>
                    ${isSelected ? `<span class="hg-mark hg-mark-blue">✓選択中</span>` : ""}
                  </div>
                  <div class="hg-deck-choice-meta">
                    <span>🏫 ${escapeHtml(shelter)}</span>
                    <span>🌋 ${escapeHtml(disaster)}</span>
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>

        <div class="hg-deck-sub-sources">
          <input type="file" id="hg-json-file-input" data-testid="hg-json-file-input" accept=".json" style="display:none;" />
          <button type="button" class="hg-btn hg-btn-sm" id="hg-load-json-btn" data-testid="hg-load-json-btn">
            📂 JSONファイルから読込
          </button>
          ${
            hasLocalDeck
              ? `<button type="button" class="hg-btn hg-btn-sm ${gameState.selectedDeckSource === "local" ? "hg-btn-primary" : ""}" id="hg-load-local-btn" data-testid="hg-load-local-btn">
                  🌐 Webツール作成デッキを使う
                </button>`
              : ""
          }
        </div>

        <!-- 選択中デッキの内訳＆登場イラストバー -->
        <div class="hg-active-deck-banner" style="margin-top:0.65rem;" data-testid="hg-active-deck-banner">
          <div class="hg-active-deck-top">
            <div class="hg-active-deck-title" data-testid="hg-active-deck-title">
              🃏 ${escapeHtml(gameState.deckTitle)}
            </div>
            <span style="font-size:0.72rem;color:#475569;font-weight:700;">${escapeHtml(gameState.deckSourceInfo)}</span>
          </div>
          <div class="hg-active-deck-stats">
            <span class="hg-mark hg-mark-blue" data-testid="hg-stat-cards">プレイ: <strong>${effectiveCount}</strong> / ${totalFull}枚</span>
            <span class="hg-mark hg-mark-red">⚡事件 <strong>${evCount}</strong></span>
            <span class="hg-mark hg-mark-yellow">🏠世帯 <strong>${hhSet.size}</strong></span>
            <span class="hg-mark hg-mark-green">👤<strong>${personCount}名</strong> 🐾<strong>${petCount}匹</strong></span>
          </div>
          ${
            sampleDeckCards.length > 0
              ? `<div class="hg-active-deck-gallery" data-testid="hg-deck-illust-preview">
                  ${sampleDeckCards
                    .map((c) => {
                      const label = c.data?.name || c.data?.event_name || "カード";
                      return `
                        <span class="hg-deck-sample-chip">
                          <img src="${escapeHtml(getCardIllustrationUrl(c))}" alt="${escapeHtml(label)}" />
                          <span>${escapeHtml(label.slice(0, 10))}</span>
                        </span>
                      `;
                    })
                    .join("")}
                </div>`
              : ""
          }
        </div>
      </section>

      <!-- STEP 2: コンパクトゲーム設定 -->
      <section class="hg-setup-card" data-testid="hg-settings-section">
        <h2 class="hg-setup-section-title">
          <span>② ゲーム設定</span>
          <span style="font-size:0.72rem;color:var(--hg-text-muted);font-weight:700;">途中変更OK</span>
        </h2>

        <div class="hg-settings-grid">
          <div class="hg-setting-box">
            <div class="hg-setting-label"><span>📏 プレイ枚数</span></div>
            <div class="hg-pill-group" data-setting-group="cardLimit">
              ${[
                { val: 30, label: "30枚(お試し)" },
                { val: 60, label: "60枚(標準)" },
                { val: 100, label: "100枚" },
                { val: 0, label: `全${totalFull}枚` },
              ]
                .map(
                  (opt) => `
                  <button
                    type="button"
                    class="hg-pill-opt ${s.cardLimit === opt.val ? "active" : ""}"
                    data-val="${opt.val}"
                    data-testid="hg-opt-limit-${opt.val}"
                  >${opt.label}</button>
                `
                )
                .join("")}
            </div>
          </div>

          <div class="hg-setting-box">
            <div class="hg-setting-label"><span>👆 配置タップ</span></div>
            <div class="hg-pill-group" data-setting-group="tapMode">
              <button type="button" class="hg-pill-opt ${s.tapMode === "one_tap" ? "active" : ""}" data-val="one_tap" data-testid="hg-opt-tap-one">
                ⚡ 1タップ即配置
              </button>
              <button type="button" class="hg-pill-opt ${s.tapMode === "two_tap" ? "active" : ""}" data-val="two_tap" data-testid="hg-opt-tap-two">
                🛡️ 2タップ確認
              </button>
            </div>
          </div>

          <div class="hg-setting-box">
            <div class="hg-setting-label"><span>🏠 到着単位</span></div>
            <div class="hg-pill-group" data-setting-group="unitMode">
              <button type="button" class="hg-pill-opt ${s.unitMode === "household" ? "active" : ""}" data-val="household" data-testid="hg-opt-unit-household">
                🏠 世帯まとめ
              </button>
              <button type="button" class="hg-pill-opt ${s.unitMode === "single" ? "active" : ""}" data-val="single" data-testid="hg-opt-unit-single">
                👤 1枚ずつ
              </button>
            </div>
          </div>

          <div class="hg-setting-box">
            <div class="hg-setting-label"><span>💡 推奨ヒント</span></div>
            <div class="hg-pill-group" data-setting-group="assistMode">
              <button type="button" class="hg-pill-opt ${s.assistMode === "guided" ? "active" : ""}" data-val="guided" data-testid="hg-opt-assist-guided">
                ⭐ ガイドON
              </button>
              <button type="button" class="hg-pill-opt ${s.assistMode === "challenge" ? "active" : ""}" data-val="challenge" data-testid="hg-opt-assist-challenge">
                🔥 本番(OFF)
              </button>
            </div>
          </div>

          <div class="hg-setting-box">
            <div class="hg-setting-label"><span>🏫 2F・3F教室</span></div>
            <div class="hg-pill-group" data-setting-group="classroomUnlock">
              <button type="button" class="hg-pill-opt ${s.classroomUnlock === "all_open" ? "active" : ""}" data-val="all_open" data-testid="hg-opt-unlock-all">
                🔓 最初から開放
              </button>
              <button type="button" class="hg-pill-opt ${s.classroomUnlock === "staged" ? "active" : ""}" data-val="staged" data-testid="hg-opt-unlock-staged">
                🔑 段階的開放
              </button>
            </div>
          </div>

          <div class="hg-setting-box">
            <div class="hg-setting-label">
              <span>⏱️ タイマー</span>
              <label style="font-size:0.74rem;font-weight:700;display:flex;align-items:center;gap:0.25rem;cursor:pointer;">
                <input type="checkbox" id="hg-sound-chk" ${s.soundEnabled ? "checked" : ""} />
                <span>🔊 効果音</span>
              </label>
            </div>
            <div class="hg-pill-group" data-setting-group="timerSeconds">
              ${[
                { val: 0, label: "✋ 手動" },
                { val: 30, label: "30秒" },
                { val: 45, label: "45秒" },
                { val: 60, label: "60秒" },
              ]
                .map(
                  (opt) => `
                  <button
                    type="button"
                    class="hg-pill-opt ${s.timerSeconds === opt.val ? "active" : ""}"
                    data-val="${opt.val}"
                    data-testid="hg-opt-timer-${opt.val}"
                  >${opt.label}</button>
                `
                )
                .join("")}
            </div>
          </div>
        </div>
      </section>

      <!-- STEP 3: 舞台エリアアイコンマップ -->
      <section class="hg-setup-card">
        <h2 class="hg-setup-section-title">
          <span>③ 舞台：小平第五小学校（6エリア・29区画）</span>
        </h2>
        <div class="hg-map-preview-strip">
          <div class="hg-map-preview-item">
            <strong>🗺️ 校庭・門</strong>
            <span>🚪正門 🐾渡り廊下 🚽マンホール10基 💧プール ⛺校庭</span>
          </div>
          <div class="hg-map-preview-item">
            <strong>🏛️ 体育館</strong>
            <span>📢ステージ ♿A(入口)〜F区画・2m通路</span>
          </div>
          <div class="hg-map-preview-item">
            <strong>🏫 校舎 1F</strong>
            <span>🚩本部 🏥保健室(電源) ♿福祉教室 🍼授乳相談</span>
          </div>
          <div class="hg-map-preview-item">
            <strong>🏫 校舎 2F・3F</strong>
            <span>👨‍👩‍👧子育て室 🌙女性室 🚆帰宅困難 🦠隔離室</span>
          </div>
        </div>
      </section>

      <!-- スタートバー -->
      <div class="hg-start-bar">
        <button
          type="button"
          class="hg-btn hg-btn-lg hg-btn-success hg-start-btn"
          id="hg-start-game-btn"
          data-testid="hg-start-game-btn"
          ${effectiveCount === 0 ? "disabled" : ""}
        >
          🚀 HUG訓練をスタートする（${effectiveCount}枚）
        </button>
      </div>
    </div>
  `;

  bindSetupEvents();
}

function bindSetupEvents() {
  document.getElementById("hg-hero-start-btn")?.addEventListener("click", () => {
    startGameSession();
  });

  // サーバ保存デッキカード選択
  document.querySelectorAll("[data-server-deck-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-server-deck-id");
      if (id) {
        await loadServerDeckById(id);
        renderSetupView();
      }
    });
  });

  // JSONファイル読込
  const jsonBtn = document.getElementById("hg-load-json-btn");
  const jsonInput = document.getElementById("hg-json-file-input");
  if (jsonBtn && jsonInput) {
    jsonBtn.addEventListener("click", () => jsonInput.click());
    jsonInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        loadJsonDeckString(text, file.name);
        renderSetupView();
        showGameToast(`📂 ${file.name} を読み込みました`, "success");
      } catch (err) {
        alert(`JSONの読み込みに失敗しました: ${err.message}`);
      }
    });
  }

  // ローカルWebツールデッキ読込
  document.getElementById("hg-load-local-btn")?.addEventListener("click", () => {
    if (loadLocalWebDeck()) {
      renderSetupView();
      showGameToast("🌐 Webツール作成デッキを読み込みました", "success");
    }
  });

  // 設定ピルボタン
  document.querySelectorAll("[data-setting-group]").forEach((groupEl) => {
    const key = groupEl.getAttribute("data-setting-group");
    groupEl.querySelectorAll(".hg-pill-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rawVal = btn.getAttribute("data-val");
        if (key === "cardLimit" || key === "timerSeconds") {
          gameState.settings[key] = Number(rawVal);
        } else {
          gameState.settings[key] = rawVal;
        }
        renderSetupView();
      });
    });
  });

  // サウンドチェックボックス
  const soundChk = document.getElementById("hg-sound-chk");
  if (soundChk) {
    soundChk.addEventListener("change", (e) => {
      gameState.settings.soundEnabled = Boolean(e.target.checked);
      sfx.enabled = gameState.settings.soundEnabled;
    });
  }

  // スタートボタン
  document.getElementById("hg-start-game-btn")?.addEventListener("click", () => {
    startGameSession();
  });
}

// ============================================================================
// 2. ゲームセッション開始 ＆ タイマー管理
// ============================================================================
export function startGameSession() {
  if (!gameState.fullDeckCards || gameState.fullDeckCards.length === 0) {
    alert("デッキが読み込まれていません。");
    return;
  }

  sfx.enabled = gameState.settings.soundEnabled;
  sfx.init();

  const limit = gameState.settings.cardLimit;
  gameState.activeDeckCards =
    limit > 0 && limit < gameState.fullDeckCards.length
      ? gameState.fullDeckCards.slice(0, limit)
      : [...gameState.fullDeckCards];

  gameState.steps = buildGameSteps(gameState.activeDeckCards, gameState.settings.unitMode);
  gameState.currentStepIdx = 0;
  gameState.phase = "playing";
  gameState.selectedRoomId = null;
  gameState.dockSize = "normal";
  gameState.movingPawn = null;
  gameState.eventMemos = {};
  gameState.camera = {
    mode: "3d",
    scope: "area",
    rotZ: -1.5,
    tiltX: 13,
    zoom: 0.96,
    panX: 0,
    panY: 0,
  };
  gameState.placements = {};
  gameState.operationLogs = [];
  gameState.undoStack = [];
  gameState.elapsedSeconds = 0;
  gameState.isPaused = false;

  initRoomsState();
  syncRecommendedAreaTabForCurrentStep();

  document.body.classList.remove("is-setup");
  document.body.classList.add("is-playing");

  stopAllTimers();
  gameState.elapsedTimerId = setInterval(() => {
    if (gameState.phase === "playing" && !gameState.isPaused) {
      gameState.elapsedSeconds++;
      updateTopbarTimersDOM();
    }
  }, 1000);

  resetStepTimer();
  renderPlayView();
}

function stopAllTimers() {
  if (gameState.elapsedTimerId) {
    clearInterval(gameState.elapsedTimerId);
    gameState.elapsedTimerId = null;
  }
  if (gameState.stepTimerId) {
    clearInterval(gameState.stepTimerId);
    gameState.stepTimerId = null;
  }
}

function resetStepTimer() {
  if (gameState.stepTimerId) {
    clearInterval(gameState.stepTimerId);
    gameState.stepTimerId = null;
  }
  const sec = Number(gameState.settings.timerSeconds) || 0;
  if (sec <= 0 || gameState.phase !== "playing") {
    gameState.stepRemainingSeconds = 0;
    return;
  }
  gameState.stepRemainingSeconds = sec;
  gameState.stepTimerId = setInterval(() => {
    if (gameState.phase !== "playing" || gameState.isPaused) return;
    if (gameState.stepRemainingSeconds > 0) {
      gameState.stepRemainingSeconds--;
      updateTopbarTimersDOM();
    }
  }, 1000);
}

function formatMMSS(totalSec) {
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function updateTopbarTimersDOM() {
  const el = document.getElementById("hg-timer-badge");
  if (!el) return;
  const limitSec = Number(gameState.settings.timerSeconds) || 0;
  if (limitSec > 0) {
    const rem = gameState.stepRemainingSeconds;
    el.textContent = `⏳ 残り${rem}秒 (${formatMMSS(gameState.elapsedSeconds)})`;
    el.className = `hg-timer-badge is-countdown ${rem <= 8 ? "is-danger" : ""}`;
  } else {
    el.textContent = `⏱ ${formatMMSS(gameState.elapsedSeconds)}`;
    el.className = "hg-timer-badge";
  }
}

function syncRecommendedAreaTabForCurrentStep() {
  const step = gameState.steps[gameState.currentStepIdx];
  if (!step) return;
  if (step.isEvent) {
    const evInfo = analyzeEventCard(step.cards[0]);
    if (evInfo.targetAreaTab) {
      gameState.activeAreaTab = evInfo.targetAreaTab;
    }
    sfx.playEventAlert();
    return;
  }
  if (gameState.settings.assistMode === "guided") {
    const analysis = analyzeStepCharacteristics(step);
    const bestRoomId = analysis.recommendedRooms[0];
    const bestRoom = bestRoomId ? gameState.rooms[bestRoomId] : null;
    if (bestRoom) {
      gameState.activeAreaTab = bestRoom.areaId;
    }
  }
}

// ============================================================================
// 3. プレイ画面 (Play View: 見取り図マップ ＋ アクティブカードドック) の描画
// ============================================================================
export function renderPlayView() {
  const main = document.getElementById("hg-main");
  if (!main) return;

  const step = gameState.steps[gameState.currentStepIdx];
  if (!step) {
    renderCompletionReportView();
    return;
  }

  const pop = getTotalShelterPopulation();
  const isGuided = gameState.settings.assistMode === "guided";
  const stepAnalysis = !step.isEvent ? analyzeStepCharacteristics(step) : null;
  const evAnalysis = step.isEvent ? analyzeEventCard(step.cards[0]) : null;

  const recRoomSet = new Set(isGuided && stepAnalysis ? stepAnalysis.recommendedRooms : []);
  const recAreaSet = new Set(
    Array.from(recRoomSet)
      .map((rid) => gameState.rooms[rid]?.areaId)
      .filter(Boolean)
  );
  if (evAnalysis?.targetAreaTab) {
    recAreaSet.add(evAnalysis.targetAreaTab);
  }

  const noRangeStr =
    step.startNo === step.endNo ? `No.${step.startNo}` : `No.${step.startNo}〜${step.endNo}`;

  main.innerHTML = `
    <div class="hg-play-shell" data-testid="hg-play-view">
      <!-- 1. トップステータスバー -->
      <header class="hg-play-topbar" data-testid="hg-topbar">
        <div class="hg-top-left">
          <img ${LOGO_IMG_ATTRS} alt="HUG" class="hg-top-logo" />
          <span class="hg-step-pill" data-testid="hg-progress-pill">
            <span class="accent">${noRangeStr}</span> (${gameState.currentStepIdx + 1}/${gameState.steps.length})
          </span>
          <span class="hg-pop-pill" data-testid="hg-population-pill" title="現在の避難所滞在人数・ペット数">
            👥${pop.persons} 🐾${pop.pets}
          </span>
        </div>

        <div class="hg-top-right">
          <span class="hg-timer-badge" id="hg-timer-badge" data-testid="hg-timer-badge">
            ⏱ ${formatMMSS(gameState.elapsedSeconds)}
          </span>
          <button
            type="button"
            class="hg-top-icon-btn"
            id="hg-undo-btn"
            data-testid="hg-undo-btn"
            title="直前の配置・操作を1手戻す"
            ${gameState.undoStack.length === 0 ? "disabled" : ""}
          >
            ↩ 戻す
          </button>
          <button
            type="button"
            class="hg-top-icon-btn"
            id="hg-open-menu-btn"
            data-testid="hg-open-menu-btn"
            title="ゲーム設定・全体状況・メニュー"
          >
            ☰ 設定
          </button>
        </div>
      </header>

      <!-- 2. メインワークスペース（スマホ上下分割 / PC左右分割） -->
      <div class="hg-play-workspace">
        <!-- 左/上カラム: フロア切替タブ ＋ 3Dミニチュア第五小学校見取り図 -->
        <div class="hg-map-column">
          <nav class="hg-area-tabs-bar" aria-label="避難所エリア切替" data-testid="hg-area-tabs">
            ${AREA_TABS.map((tab) => {
              const cnt = getAreaOccupantCount(tab.id);
              const isRec = recAreaSet.has(tab.id);
              const isActive = gameState.camera.scope === "area" && gameState.activeAreaTab === tab.id;
              return `
                <button
                  type="button"
                  class="hg-area-tab ${isActive ? "active" : ""} ${isRec ? "is-recommended" : ""}"
                  data-area-tab="${tab.id}"
                  data-testid="hg-tab-${tab.id}"
                >
                  ${isRec && !isActive ? `<span class="hg-area-tab-rec-dot" title="推奨エリア"></span>` : ""}
                  <span>${tab.icon}${tab.label}</span>
                  <span class="hg-area-tab-cnt" data-testid="hg-tab-cnt-${tab.id}">${cnt}</span>
                </button>
              `;
            }).join("")}
          </nav>

          <!-- 3Dミニチュア・ジオラマビューポート -->
          <div class="hg-map-pane" id="hg-map-pane" data-testid="hg-map-pane">
            <!-- カメラ・視点コントロール HUD -->
            <div class="hg-camera-hud" data-testid="hg-camera-controls">
              <button
                type="button"
                class="hg-cam-btn ${gameState.camera.scope === "all" ? "is-active" : ""}"
                id="hg-cam-scope-btn"
                data-testid="hg-cam-scope-btn"
                title="選択エリア拡大と小平第五小学校全館俯瞰を切替"
              >
                ${gameState.camera.scope === "all" ? "🔍 階別拡大" : "🏫 全館俯瞰"}
              </button>
              <button
                type="button"
                class="hg-cam-btn ${gameState.camera.mode === "3d" ? "is-active" : ""}"
                id="hg-cam-tilt-btn"
                data-testid="hg-cam-tilt-btn"
                title="3D立体ミニチュア表示と真上平面図を切替"
              >
                ${gameState.camera.mode === "flat" ? "📐 3D立体" : "🗺️ 真上図"}
              </button>
              <div class="hg-cam-btn-group">
                <button type="button" class="hg-cam-btn hg-cam-icon" id="hg-cam-rot-left" data-testid="hg-cam-rot-left" title="左へ回転">↺</button>
                <button type="button" class="hg-cam-btn hg-cam-icon" id="hg-cam-rot-right" data-testid="hg-cam-rot-right" title="右へ回転">↻</button>
                <button type="button" class="hg-cam-btn hg-cam-icon" id="hg-cam-zoom-out" data-testid="hg-cam-zoom-out" title="縮小">－</button>
                <button type="button" class="hg-cam-btn hg-cam-icon" id="hg-cam-zoom-in" data-testid="hg-cam-zoom-in" title="拡大">＋</button>
                <button type="button" class="hg-cam-btn hg-cam-icon" id="hg-cam-reset" data-testid="hg-cam-reset" title="カメラ視点をリセット">⟲</button>
              </div>
              <span class="hg-cam-readout" id="hg-cam-readout">
                ${gameState.camera.mode === "flat" ? "平面" : `3D ${gameState.camera.tiltX}°`}・${Math.round(gameState.camera.zoom * 100)}%
              </span>
            </div>

            ${renderPawnMoveBarHTML()}

            <div class="hg-diorama-viewport" id="hg-diorama-viewport" data-testid="hg-diorama-viewport">
              <div
                class="hg-diorama-scene ${gameState.camera.mode === "3d" ? "is-3d" : "is-flat"} ${gameState.camera.scope === "all" ? "is-all-scope" : ""}"
                id="hg-diorama-scene"
                data-testid="hg-diorama-scene"
                style="${getCameraTransformStyle()}"
              >
                ${
                  gameState.camera.scope === "all"
                    ? renderAllCampusDioramaHTML(step, stepAnalysis, evAnalysis)
                    : renderFloorplanBoardHTML(gameState.activeAreaTab, step, stepAnalysis, evAnalysis, false)
                }
              </div>
            </div>
          </div>
        </div>

        <!-- 右/下カラム: アクティブカード＆操作ドック -->
        <aside
          class="hg-card-dock ${gameState.dockSize === "expanded" ? "is-expanded" : gameState.dockSize === "compact" ? "is-collapsed" : ""}"
          id="hg-card-dock"
          data-testid="hg-card-dock"
        >
          ${renderActiveCardDockHTML(step, stepAnalysis, evAnalysis)}
        </aside>
      </div>
    </div>
  `;

  updateTopbarTimersDOM();
  bindPlayViewEvents(step, stepAnalysis, evAnalysis);
}

function getCameraTransformStyle() {
  const cam = gameState.camera || { mode: "3d", scope: "area", rotZ: -4, tiltX: 18, zoom: 1, panX: 0, panY: 0 };
  const effectiveTilt = cam.mode === "flat" ? 0 : cam.tiltX;
  const effectiveRot = cam.mode === "flat" ? 0 : cam.rotZ;
  return `transform: translate3d(${cam.panX}px, ${cam.panY}px, 0) scale(${cam.zoom}) rotateX(${effectiveTilt}deg) rotateZ(${effectiveRot}deg); --cam-tilt: ${effectiveTilt}deg;`;
}

function renderPawnMoveBarHTML() {
  const mp = gameState.movingPawn;
  if (!mp) return "";
  const occ = gameState.placements[mp.cardNo];
  if (!occ) {
    gameState.movingPawn = null;
    return "";
  }
  const c = occ.card;
  const fromRoom = gameState.rooms[occ.roomId] || gameState.rooms[mp.fromRoomId];
  const gid = c.group_id;
  const groupCnt = gid
    ? Object.values(gameState.placements).filter((p) => p.card.group_id === gid).length
    : 1;
  const hasGroup = Boolean(gid && groupCnt > 1);

  return `
    <div class="hg-pawn-move-bar" data-testid="hg-pawn-move-bar">
      <div class="hg-pawn-move-info">
        <img src="${getCardIllustrationUrl(c)}" alt="" class="hg-pawn-move-thumb" />
        <div class="hg-pawn-move-text">
          <strong>🔄 移動中: No.${c.card_number} ${escapeHtml(c.data?.name || c.title || "")}</strong>
          <small>現在地: ${escapeHtml(fromRoom?.shortName || "")} → 移動先の部屋をタップ</small>
        </div>
      </div>
      <div class="hg-pawn-move-actions">
        <button
          type="button"
          class="hg-cam-btn ${mp.scope === "person" ? "is-active" : ""}"
          id="hg-pawn-scope-person"
          data-testid="hg-pawn-scope-person"
        >
          👤 個人単位(1人)
        </button>
        ${
          hasGroup
            ? `<button
                type="button"
                class="hg-cam-btn ${mp.scope === "group" ? "is-active" : ""}"
                id="hg-pawn-scope-group"
                data-testid="hg-pawn-scope-group"
              >
                👥 世帯単位(${groupCnt}名)
              </button>`
            : ""
        }
        <button
          type="button"
          class="hg-cam-btn hg-cam-cancel"
          id="hg-pawn-move-cancel"
          data-testid="hg-pawn-move-cancel"
        >
          ✕ 解除
        </button>
      </div>
    </div>
  `;
}

function renderAllCampusDioramaHTML(step, stepAnalysis, evAnalysis) {
  return `
    <div class="hg-campus-diorama-table" data-testid="hg-all-campus-diorama">
      <div class="hg-campus-diorama-banner">
        <strong>🏫 小平第五小学校 3Dミニチュア全館ビュー</strong>
        <span>ドラッグで自由に見回し・＋/－拡大・部屋やコマの直接タップが可能</span>
      </div>
      <div class="hg-campus-diorama-wings">
        <div class="hg-building-stack">
          <div class="hg-wing-label">🏢 校舎棟（3階 → 2階 → 1階 断面）</div>
          ${renderFloorplanBoardHTML("floor3", step, stepAnalysis, evAnalysis, true)}
          ${renderFloorplanBoardHTML("floor2", step, stepAnalysis, evAnalysis, true)}
          ${renderFloorplanBoardHTML("floor1", step, stepAnalysis, evAnalysis, true)}
        </div>
        <div class="hg-campus-east-stack">
          <div class="hg-wing-label">🏟️ 東棟・体育館 ／ 🌳 校庭・門 ／ 🚑 学校外</div>
          ${renderFloorplanBoardHTML("gym", step, stepAnalysis, evAnalysis, true)}
          ${renderFloorplanBoardHTML("grounds", step, stepAnalysis, evAnalysis, true)}
          ${renderFloorplanBoardHTML("external", step, stepAnalysis, evAnalysis, true)}
        </div>
      </div>
    </div>
  `;
}

function getRoomFloorTextureClass(room) {
  if (room.isIsolation || room.id === "f1-infirmary" || room.id === "grounds-manhole-toilet") {
    return "floor-tex-medical";
  }
  if (room.areaId === "gym") {
    return room.id === "gym-stage" ? "floor-tex-stage" : "floor-tex-wood";
  }
  if (room.areaId === "grounds") {
    return room.id === "grounds-field" || room.id === "grounds-pool-north"
      ? "floor-tex-turf"
      : "floor-tex-asphalt";
  }
  if (room.isExternal) return "floor-tex-external";
  return "floor-tex-classroom";
}

// ============================================================================
// 第五小学校 各エリアの見取り図 HTML 構築
// ============================================================================
function renderFloorplanBoardHTML(areaId, step, stepAnalysis, evAnalysis, isCompact = false) {
  const tabMeta = AREA_TABS.find((t) => t.id === areaId) || AREA_TABS[0];
  const roomsInArea = Object.values(gameState.rooms).filter((r) => r.areaId === areaId);
  const isLockedFloor = roomsInArea.length > 0 && roomsInArea.every((r) => r.locked);

  // エリア固有の建築見取り図ヘッダー・通路・方位ガイド
  let topArchitecturalGuide = "";
  let bottomArchitecturalGuide = "";

  if (!isCompact) {
    if (areaId === "grounds") {
      topArchitecturalGuide = `
        <div class="hg-campus-compass-bar" data-testid="hg-grounds-compass">
          <span>⬅ 西: プール・受水槽</span>
          <span>⬆ 北: 北門・校舎棟(1〜3F)</span>
          <span>➡ 東: 体育館・東門・東部公園</span>
        </div>
      `;
      bottomArchitecturalGuide = `
        <div class="hg-campus-compass-bar">
          <span>⬇ 南東: 正門・五小通り（花小金井駅方面）</span>
          <span>🔄 コマタップで直接移動 / 「内訳」で詳細</span>
        </div>
      `;
    } else if (areaId === "gym") {
      topArchitecturalGuide = `
        <div class="hg-corridor-strip" data-testid="hg-gym-guide">
          <span>🚪 西側: 体育館玄関（スロープ）・多目的トイレ</span>
          <span>⬆️ 中央2m安全通路</span>
          <span>🚪 東側: 非常口・マンホールトイレ側</span>
        </div>
      `;
    } else if (areaId === "floor1") {
      topArchitecturalGuide = `
        <div class="hg-corridor-strip">
          <span>⬅ 西階段・保健室側</span>
          <span>🏫 1階廊下（段差なしバリアフリー・児童昇降口連絡）</span>
          <span>➡ 東階段・エレベーター</span>
        </div>
      `;
    } else if (areaId === "floor2") {
      topArchitecturalGuide = `
        <div class="hg-corridor-strip">
          <span>⬅ 西階段（2階）</span>
          <span>🏫 2階廊下（子育て・普通教室・静養室・図書室）</span>
          <span>➡ 東階段・多目的トイレ</span>
        </div>
      `;
    } else if (areaId === "floor3") {
      topArchitecturalGuide = `
        <div class="hg-corridor-strip">
          <span>⬅ 西端（第二隔離室）</span>
          <span>🏫 3階廊下（※東端・西端は感染症専用隔離ゾーン）</span>
          <span>➡ 東端（第一隔離室・専用トイレ）</span>
        </div>
      `;
    }
  }

  const unlockBannerHtml = isLockedFloor
    ? `
      <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:0.42rem 0.65rem;display:flex;align-items:center;justify-content:space-between;gap:0.45rem;flex-wrap:wrap;">
        <span style="font-size:0.74rem;font-weight:700;color:#92400e;">🔒 未開放フロア</span>
        <button type="button" class="hg-btn hg-btn-sm hg-btn-warn" id="hg-unlock-floor-btn-${areaId}" data-unlock-area="${areaId}" data-testid="hg-unlock-floor-btn">
          🔓 ${escapeHtml(tabMeta.label)}を一括開放
        </button>
      </div>
    `
    : "";

  const themeClass =
    areaId === "grounds"
      ? "theme-grounds"
      : areaId === "gym"
      ? "theme-gym"
      : areaId === "external"
      ? "theme-external"
      : "theme-floor";

  return `
    <div class="hg-floorplan-board ${themeClass} ${isCompact ? "is-compact-board" : ""}" data-testid="hg-floorplan-${areaId}">
      <div class="hg-floorplan-header">
        <div class="hg-floorplan-title">${escapeHtml(tabMeta.fullTitle)}</div>
        ${
          isCompact
            ? `<button type="button" class="hg-cam-btn" data-jump-area="${areaId}">🔍 この階を拡大</button>`
            : `<div class="hg-floorplan-legend"><span>♟️ コマタップで移動・👆部屋タップで配置</span></div>`
        }
      </div>

      ${unlockBannerHtml}
      ${topArchitecturalGuide}

      <div class="hg-rooms-grid" data-testid="hg-rooms-grid">
        ${roomsInArea.map((room) => renderRoomCellHTML(room, step, stepAnalysis, evAnalysis, isCompact)).join("")}
      </div>

      ${bottomArchitecturalGuide}
    </div>
  `;
}

function renderRoomCellHTML(room, step, stepAnalysis, evAnalysis, isCompact = false) {
  const occupants = getRoomOccupants(room.id);
  const occCount = occupants.length;
  const isGuided = gameState.settings.assistMode === "guided";
  const isMovingMode = Boolean(gameState.movingPawn);
  const isRec =
    !isMovingMode &&
    isGuided &&
    !step.isEvent &&
    stepAnalysis &&
    stepAnalysis.recommendedRooms.includes(room.id);
  const isBestRec =
    !isMovingMode &&
    isGuided &&
    !step.isEvent &&
    stepAnalysis &&
    stepAnalysis.recommendedRooms[0] === room.id;
  const isEventTarget =
    step.isEvent &&
    evAnalysis &&
    (evAnalysis.targetRoomId === room.id ||
      evAnalysis.closedRoomId === room.id ||
      evAnalysis.isolationRoomId === room.id);
  const isSelected = gameState.selectedRoomId === room.id;
  const isMoveDest = isMovingMode && !room.closed && gameState.movingPawn?.fromRoomId !== room.id;

  // 世帯単位でのチップ集約表示
  const hhSummaryList = [];
  const seenGroups = new Map();
  for (const occ of occupants) {
    const c = occ.card;
    const isPet = c.kind === "pet" || c.data?.data_type === "ペット";
    const hasCare =
      (c.data?.health_condition || []).some((h) => h && h !== "良好") ||
      (c.data?.vulnerabilities || []).length > 0;
    const gid = c.group_id || `SINGLE-${c.card_number}`;
    if (!seenGroups.has(gid)) {
      const label = isPet
        ? `🐾${c.data?.name || "ペット"}`
        : c.group?.group_name
        ? c.group.group_name.replace(/（.*）/, "")
        : c.data?.name || `No.${c.card_number}`;
      const item = { gid, label, count: 1, isPet, hasCare, firstNo: c.card_number };
      seenGroups.set(gid, item);
      hhSummaryList.push(item);
    } else {
      const item = seenGroups.get(gid);
      item.count++;
      if (hasCare) item.hasCare = true;
    }
  }

  let capClass = "";
  if (occCount > 0) capClass = "has-people";
  if (!room.isExternal && occCount >= room.capacity) capClass = "is-full";
  if (!room.isExternal && occCount > room.capacity + 2) capClass = "is-over";

  const capPct = room.isExternal
    ? Math.min(100, occCount * 8)
    : Math.min(100, Math.round((occCount / Math.max(1, room.capacity)) * 100));
  const capFillClass = room.isExternal
    ? ""
    : occCount > room.capacity
    ? "is-over"
    : occCount >= room.capacity
    ? "is-full"
    : "";

  const statusTagClass = room.closed
    ? "tag-status-warn"
    : room.status.includes("✅")
    ? "tag-status-ok"
    : "";

  const maxPawns = isCompact ? 5 : 12;
  const pawnOccupants = occupants.slice(0, maxPawns);
  const extraPawnCount = Math.max(0, occupants.length - pawnOccupants.length);
  const floorTexClass = getRoomFloorTextureClass(room);

  return `
    <div
      class="hg-room-cell ${floorTexClass} ${room.span2 ? "span-2" : ""} ${isSelected ? "is-selected" : ""} ${isMoveDest ? "is-move-dest" : ""} ${isBestRec ? "is-best-rec" : ""} ${isRec ? "is-recommended" : ""} ${isEventTarget ? "is-event-target" : ""} ${room.closed ? "is-closed" : ""} ${room.locked ? "is-locked" : ""}"
      data-room-id="${room.id}"
      data-testid="hg-room-${room.id}"
      role="button"
      tabindex="0"
    >
      <div class="hg-room-top">
        <div class="hg-room-name">
          <span>${room.icon}</span>
          <span>${escapeHtml(isCompact ? room.shortName : room.name)}</span>
        </div>
        <span class="hg-room-cap-badge ${capClass}" data-testid="hg-room-count-${room.id}">
          ${room.isExternal ? `${occCount}名` : `${occCount}/${room.capacity}`}
        </span>
      </div>

      <div class="hg-cap-bar" aria-hidden="true">
        <div class="hg-cap-bar-fill ${capFillClass}" style="width:${capPct}%;"></div>
      </div>

      <div class="hg-room-tags">
        ${isBestRec ? `<span class="hg-room-tag tag-rec">⭐ 最適</span>` : isRec ? `<span class="hg-room-tag tag-rec">💡 おすすめ</span>` : ""}
        ${room.closed ? `<span class="hg-room-tag tag-status-warn">🚫 使用不可</span>` : ""}
        ${room.locked ? `<span class="hg-room-tag">🔒 未開放(タップで解錠)</span>` : ""}
        ${!room.closed && !room.locked && room.status ? `<span class="hg-room-tag ${statusTagClass}">${escapeHtml(room.status)}</span>` : ""}
        ${!isCompact ? room.tags.slice(0, 2).map((t) => `<span class="hg-room-tag">${escapeHtml(t)}</span>`).join("") : ""}
      </div>

      ${
        pawnOccupants.length > 0
          ? `
            <div class="hg-3d-pawn-stage" data-testid="hg-room-avatars-${room.id}">
              ${pawnOccupants
                .map((occ) => {
                  const c = occ.card;
                  const isPet = c.kind === "pet" || c.data?.data_type === "ペット";
                  const hasCare =
                    (c.data?.health_condition || []).some((h) => h && h !== "良好") ||
                    (c.data?.vulnerabilities || []).length > 0;
                  const isBeingMoved =
                    gameState.movingPawn &&
                    (gameState.movingPawn.cardNo === c.card_number ||
                      (gameState.movingPawn.scope === "group" &&
                        c.group_id &&
                        gameState.placements[gameState.movingPawn.cardNo]?.card?.group_id === c.group_id));
                  const pName = c.data?.name || c.title || `No.${c.card_number}`;
                  const shortLabel = pName.length > 5 ? pName.slice(0, 5) : pName;
                  return `
                    <button
                      type="button"
                      class="hg-pawn-piece ${isPet ? "is-pet" : hasCare ? "is-care" : "is-normal"} ${isBeingMoved ? "is-selected-pawn" : ""}"
                      data-pawn-card-no="${c.card_number}"
                      data-room-id="${room.id}"
                      data-testid="hg-pawn-${c.card_number}"
                      title="No.${c.card_number} ${escapeHtml(pName)} — タップして別室へ直接移動"
                    >
                      <span class="hg-pawn-figure">
                        <img
                          class="hg-pawn-img hg-room-avatar-img"
                          src="${getCardIllustrationUrl(c)}"
                          alt="${escapeHtml(pName)}"
                          loading="lazy"
                        />
                        ${hasCare ? `<span class="hg-pawn-badge-care" aria-hidden="true">!</span>` : ""}
                        ${isPet ? `<span class="hg-pawn-badge-pet" aria-hidden="true">🐾</span>` : ""}
                      </span>
                      <span class="hg-pawn-base"></span>
                      <span class="hg-pawn-label">${escapeHtml(shortLabel)}</span>
                    </button>
                  `;
                })
                .join("")}
              ${extraPawnCount > 0 ? `<span class="hg-room-avatar-more">+${extraPawnCount}</span>` : ""}
            </div>
          `
          : !isCompact && !room.locked && !room.closed
          ? `<div class="hg-empty-stage-hint"><span>ここにコマを配置</span></div>`
          : ""
      }

      ${
        !isCompact && hhSummaryList.length > 0
          ? `
            <div class="hg-room-occupants">
              ${hhSummaryList
                .slice(0, 3)
                .map(
                  (h) => `
                  <span class="hg-occ-chip ${h.isPet ? "is-pet" : ""} ${h.hasCare ? "has-care" : ""}">
                    ${escapeHtml(h.label)}${h.count > 1 ? `(${h.count})` : ""}
                  </span>
                `
                )
                .join("")}
              ${hhSummaryList.length > 3 ? `<span class="hg-occ-chip">+他${hhSummaryList.length - 3}組</span>` : ""}
            </div>
          `
          : ""
      }

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:0.15rem;">
        <span style="font-size:0.65rem;color:#475569;font-weight:700;">
          ${
            isMoveDest
              ? "📍 ここへ移動する"
              : room.closed
              ? "⚠️ 立入禁止・詳細"
              : step.isEvent
              ? "🔧 状態変更・詳細"
              : isSelected
              ? "✅ もう1回で確定"
              : "👆 タップで配置"
          }
        </span>
        <button
          type="button"
          class="hg-room-inspect-btn"
          data-inspect-room="${room.id}"
          data-testid="hg-inspect-${room.id}"
          title="この部屋の滞在者一覧・他室への移動・状態変更"
        >
          👥 内訳(${occCount})
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// アクティブカード＆操作ドック (Bottom / Right Dock) HTML 構築
// ============================================================================
function renderActiveCardDockHTML(step, stepAnalysis, evAnalysis) {
  const noRangeStr =
    step.startNo === step.endNo ? `No.${step.startNo}` : `No.${step.startNo}〜${step.endNo}`;

  if (step.isEvent) {
    return renderEventDockHTML(step, evAnalysis, noRangeStr);
  }
  return renderHouseholdDockHTML(step, stepAnalysis, noRangeStr);
}

function renderDockToolsHTML() {
  const isCardMode = gameState.dockViewMode === "card";
  return `
    <div class="hg-dock-tools">
      <button
        type="button"
        class="hg-btn hg-btn-sm ${isCardMode ? "hg-btn-primary" : ""}"
        id="hg-toggle-card-view-btn"
        data-testid="hg-toggle-card-view-btn"
        title="イラストカード表示と公式HUGカード表示を切替"
      >
        ${isCardMode ? "🎨 イラスト" : "🃏 公式カード"}
      </button>
      <button
        type="button"
        class="hg-btn hg-btn-sm"
        id="hg-open-card-img-btn"
        data-testid="hg-open-card-img-btn"
        title="公式HUGカード画像を大きく表示"
      >
        🖼️ 拡大
      </button>
      <button
        type="button"
        class="hg-btn hg-btn-sm"
        id="hg-toggle-dock-size-btn"
        data-testid="hg-toggle-dock-size-btn"
        title="カード欄の拡大/縮小"
      >
        ${gameState.dockSize === "expanded" ? "🔽 標準" : "🔼 広げる"}
      </button>
    </div>
  `;
}

function renderHouseholdDockHTML(step, stepAnalysis, noRangeStr) {
  const firstCard = step.cards[0];
  const grp = step.group || firstCard.group || null;
  const origin = grp?.evacuation_origin || firstCard.data?.evacuation_origin || "地域住民";
  const isGuided = gameState.settings.assistMode === "guided";
  const isCardMode = gameState.dockViewMode === "card";

  // 推奨部屋クイックボタン一覧
  const quickRoomIds = isGuided
    ? stepAnalysis.recommendedRooms.slice(0, 4)
    : ["gym-b", "gym-a", "f1-welfare", "f1-infirmary", "f2-general-a", "corridor-pet"];

  const stripHtml = isCardMode
    ? `
      <div class="hg-real-cards-strip" data-testid="hg-members-strip">
        ${step.cards
          .map(
            (c) => `
            <button
              type="button"
              class="hg-real-card-btn"
              data-open-card-no="${c.card_number}"
              data-testid="hg-member-card-${c.card_number}"
              title="タップでNo.${c.card_number}の公式カードを拡大"
            >
              <img
                class="hg-dock-real-card-img"
                data-real-card-no="${c.card_number}"
                data-testid="hg-dock-real-card-${c.card_number}"
                alt="No.${c.card_number} 公式HUGカード"
              />
            </button>
          `
          )
          .join("")}
      </div>
    `
    : `
      <div class="hg-members-strip" data-testid="hg-members-strip">
        ${step.cards.map((c) => renderMemberMiniCardHTML(c, step.cards.length === 1)).join("")}
      </div>
    `;

  return `
    <div class="hg-dock-header is-household" data-testid="hg-dock-header">
      <div class="hg-dock-title-wrap">
        <span class="hg-dock-kind-badge ${stepAnalysis.isPetOnly ? "kind-pet" : "kind-hh"}">
          ${stepAnalysis.isPetOnly ? "🐾 ペット" : `🏠 ${noRangeStr}`}
        </span>
        <span class="hg-dock-title" data-testid="hg-dock-title">
          ${escapeHtml(step.title)}
          <small style="font-weight:600;color:#475569;margin-left:0.2rem;">(${step.cards.length}枚・${escapeHtml(origin)})</small>
        </span>
      </div>
      ${renderDockToolsHTML()}
    </div>

    <div class="hg-dock-body">
      ${
        isGuided
          ? `<div class="hg-assist-banner" data-testid="hg-assist-hint">
              💡 ${escapeHtml(stepAnalysis.reasonLabel)}
            </div>`
          : ""
      }

      ${
        stepAnalysis.hasPetWithHumans
          ? `
            <div class="hg-pet-split-bar" data-testid="hg-pet-split-bar">
              <label>
                <input type="checkbox" id="hg-auto-split-pet-chk" data-testid="hg-auto-split-pet-chk" ${gameState.settings.autoSplitPets ? "checked" : ""} />
                <span>🐾 ペット(${stepAnalysis.pets.length}匹)は自動的に「渡り廊下(ペット区画)」へ分離配置する</span>
              </label>
            </div>
          `
          : ""
      }

      ${stripHtml}
    </div>

    <!-- クイック配置フッター -->
    <div class="hg-dock-footer" data-testid="hg-dock-footer">
      ${
        gameState.settings.tapMode === "two_tap" && gameState.selectedRoomId
          ? `
            <button
              type="button"
              class="hg-btn hg-btn-primary"
              id="hg-confirm-two-tap-btn"
              data-testid="hg-confirm-two-tap-btn"
              style="width:100%;padding:0.6rem;font-size:0.92rem;"
            >
              ✅ 「${escapeHtml(gameState.rooms[gameState.selectedRoomId]?.shortName || "")}」に配置して次へ →
            </button>
          `
          : `
            <div class="hg-quick-rooms-row" data-testid="hg-quick-rooms">
              <span style="font-size:0.72rem;font-weight:800;color:#475569;white-space:nowrap;">⚡即配置:</span>
              ${quickRoomIds
                .map((rid, idx) => {
                  const r = gameState.rooms[rid];
                  if (!r || r.closed) return "";
                  return `
                    <button
                      type="button"
                      class="hg-quick-room-btn ${idx === 0 && isGuided ? "is-best" : ""}"
                      data-quick-room-id="${rid}"
                      data-testid="hg-quick-room-${rid}"
                    >
                      ${idx === 0 && isGuided ? "⭐" : r.icon} ${escapeHtml(r.shortName)}
                    </button>
                  `;
                })
                .join("")}
            </div>
          `
      }
    </div>
  `;
}

function renderMemberMiniCardHTML(card, isSolo = false) {
  const d = card.data || {};
  const isPet = card.kind === "pet" || d.data_type === "ペット";
  const health = Array.isArray(d.health_condition)
    ? d.health_condition.filter((h) => h && h !== "良好")
    : [];
  const vulns = Array.isArray(d.vulnerabilities) ? d.vulnerabilities : [];
  const attrs = Array.isArray(d.attributes) ? d.attributes : [];
  const skills = Array.isArray(d.skills) ? d.skills : [];

  const allBadges = [
    ...health.map((h) => `<span class="hg-mark hg-mark-red">🔴 ${escapeHtml(h)}</span>`),
    ...vulns.map((v) => `<span class="hg-mark hg-mark-yellow">🟡 ${escapeHtml(v)}</span>`),
    ...skills.map((s) => `<span class="hg-mark hg-mark-green">🟢 ${escapeHtml(s)}</span>`),
    ...attrs.map((a) => `<span class="hg-mark hg-mark-blue">${escapeHtml(a)}</span>`),
  ];
  const shownBadges = allBadges.slice(0, 3);
  const extraBadges = Math.max(0, allBadges.length - shownBadges.length);

  const profileParts = [];
  if (d.age !== undefined && d.age !== null) profileParts.push(`${escapeHtml(String(d.age))}歳`);
  if (d.gender) profileParts.push(escapeHtml(d.gender));

  return `
    <div class="hg-member-card-mini ${isSolo ? "is-solo" : ""} ${isPet ? "is-pet" : ""}" data-testid="hg-member-card-${card.card_number}">
      <div
        class="hg-member-illust-box"
        data-open-card-no="${card.card_number}"
        role="button"
        tabindex="0"
        title="タップでNo.${card.card_number}の公式カード拡大"
      >
        <img
          class="hg-member-illust"
          src="${getCardIllustrationUrl(card)}"
          alt="${escapeHtml(d.name || card.title || "")}"
          data-testid="hg-member-illust-${card.card_number}"
        />
        <span class="hg-member-no-tag">No.${card.card_number}</span>
      </div>

      <div class="hg-member-info-col">
        <div class="hg-member-head">
          <span class="hg-member-name">
            ${isPet ? "🐾" : "👤"} ${escapeHtml(d.name || card.title || "")}
          </span>
          ${profileParts.length ? `<span class="hg-member-profile">${profileParts.join("・")}</span>` : ""}
        </div>

        ${
          shownBadges.length > 0
            ? `<div class="hg-member-marks">
                ${shownBadges.join("")}
                ${extraBadges > 0 ? `<span class="hg-mark hg-mark-blue">+${extraBadges}</span>` : ""}
              </div>`
            : `<div class="hg-member-marks"><span class="hg-mark hg-mark-green">🟢 健康良好</span></div>`
        }

        ${
          d.statement
            ? `<div class="hg-member-statement">「${escapeHtml(d.statement)}」</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderEventDockHTML(step, evAnalysis, noRangeStr) {
  const card = step.cards[0];
  const d = card.data || {};
  const isGuided = gameState.settings.assistMode === "guided";
  const cardKey = String(card.card_number);
  const existingMemo = gameState.eventMemos?.[cardKey]?.memo || "";
  const targetRoom = gameState.rooms[evAnalysis.targetRoomId];

  const interactiveBodyHtml = `
    <div class="hg-event-memo-box" data-testid="hg-event-memo-box">
      <div class="hg-event-memo-head">
        <label for="hg-event-memo-input" class="hg-event-memo-label">📝 このイベントへの対応メモ（訓練後の振り返り用）</label>
        <span class="hg-event-memo-status" id="hg-event-memo-status">
          ${existingMemo.trim() ? "✅ メモ記入済み" : "✏️ 自由記入"}
        </span>
      </div>
      <div class="hg-event-memo-guide">
        📍 関連エリア目安: <strong>${escapeHtml(targetRoom?.name || "避難所全体")}</strong> — 選択肢はありません。3D見取り図の部屋・コマをタップして現場対応を行い、振り返り用のメモを残してください。
      </div>
      <textarea
        id="hg-event-memo-input"
        class="hg-event-memo-input"
        data-testid="hg-event-memo-input"
        rows="2"
        placeholder="とった対応や現場での気づき、訓練後に話し合いたい判断理由などを自由にメモしてください（空欄のまま進むことも可能です）"
      >${escapeHtml(existingMemo)}</textarea>
      <button
        type="button"
        class="hg-btn hg-btn-primary hg-event-memo-submit-btn"
        id="hg-event-memo-submit-btn"
        data-testid="hg-event-memo-submit-btn"
      >
        📝 対応メモを記録して次のカードへ →
      </button>
    </div>
  `;

  const isCardMode = gameState.dockViewMode === "card";
  const eventHeroHtml = isCardMode
    ? `
      <div class="hg-event-box" data-testid="hg-event-content">
        <div style="display:flex;align-items:flex-start;gap:0.65rem;flex-wrap:wrap;">
          <button
            type="button"
            class="hg-real-card-btn"
            data-open-card-no="${card.card_number}"
            title="タップで公式イベントカードを拡大"
          >
            <img
              class="hg-dock-real-card-img"
              data-real-card-no="${card.card_number}"
              data-testid="hg-dock-real-card-${card.card_number}"
              alt="イベントカード No.${card.card_number}"
            />
          </button>
          <div style="flex:1;min-width:170px;">
            <div style="font-weight:800;color:#991b1b;margin-bottom:0.2rem;">
              ${escapeHtml(evAnalysis.badgeText)}
              ${d.must_respond ? `<span class="hg-mark hg-mark-red" style="margin-left:0.3rem;">${escapeHtml(d.must_respond)}</span>` : ""}
            </div>
            <div>${escapeHtml(d.content || "")}</div>
          </div>
        </div>
      </div>
    `
    : `
      <div class="hg-event-box" data-testid="hg-event-content">
        <div class="hg-event-hero-box">
          <button
            type="button"
            class="hg-event-illust-wrap"
            data-open-card-no="${card.card_number}"
            title="タップで公式イベントカード全体を見る"
            style="border:none;background:transparent;padding:0;"
          >
            <img
              class="hg-event-illust"
              src="${getCardIllustrationUrl(card)}"
              alt="${escapeHtml(step.title)}"
              data-testid="hg-event-illust"
            />
            <span class="hg-member-no-tag">🔍 拡大</span>
          </button>
          <div class="hg-event-text-col">
            <div style="font-weight:800;color:#991b1b;margin-bottom:0.2rem;">
              ${escapeHtml(evAnalysis.badgeText)}
              ${d.must_respond ? `<span class="hg-mark hg-mark-red" style="margin-left:0.3rem;">${escapeHtml(d.must_respond)}</span>` : ""}
            </div>
            <div>${escapeHtml(d.content || "")}</div>
            ${
              isGuided && d.training_point
                ? `<div style="margin-top:0.35rem;padding-top:0.35rem;border-top:1px dashed #fca5a5;font-size:0.75rem;color:#7f1d1d;">
                    💡 <strong>判断のコツ:</strong> ${escapeHtml(d.training_point)}
                  </div>`
                : ""
            }
          </div>
        </div>
      </div>
    `;

  return `
    <div class="hg-dock-header is-event" data-testid="hg-dock-header">
      <div class="hg-dock-title-wrap">
        <span class="hg-dock-kind-badge kind-ev">⚡ ${noRangeStr}</span>
        <span class="hg-dock-title" data-testid="hg-dock-title">${escapeHtml(step.title)}</span>
      </div>
      ${renderDockToolsHTML()}
    </div>

    <div class="hg-dock-body">
      ${eventHeroHtml}
      ${interactiveBodyHtml}
    </div>
  `;
}

// ============================================================================
// プレイ画面のイベントハンドラ＆配置・イベント・3Dカメラ・直接コマ移動ロジック
// ============================================================================
let dioramaJustDragged = false;

function applyCameraStyleToDOM() {
  const sceneEl = document.getElementById("hg-diorama-scene");
  if (!sceneEl) return;
  const cam = gameState.camera;
  const effectiveTilt = cam.mode === "flat" ? 0 : cam.tiltX;
  const effectiveRot = cam.mode === "flat" ? 0 : cam.rotZ;
  sceneEl.style.transform = `translate3d(${cam.panX}px, ${cam.panY}px, 0) scale(${cam.zoom}) rotateX(${effectiveTilt}deg) rotateZ(${effectiveRot}deg)`;
  sceneEl.style.setProperty("--cam-tilt", `${effectiveTilt}deg`);
  const readoutEl = document.getElementById("hg-cam-readout");
  if (readoutEl) {
    readoutEl.textContent = `${cam.mode === "flat" ? "平面" : `3D ${cam.tiltX}°`}・${Math.round(cam.zoom * 100)}%`;
  }
}

export function executePawnMoveToRoom(destRoomId) {
  const mp = gameState.movingPawn;
  if (!mp) return false;
  const destRoom = gameState.rooms[destRoomId];
  const sourceP = gameState.placements[mp.cardNo];
  if (!destRoom || !sourceP) {
    gameState.movingPawn = null;
    renderPlayView();
    return false;
  }
  if (destRoom.closed) {
    showGameToast("⚠️ 立入禁止・使用不可の区画には移動できません", "warn");
    return false;
  }
  if (destRoom.id === sourceP.roomId) {
    gameState.movingPawn = null;
    showGameToast("移動をキャンセルしました", "info", 1400);
    renderPlayView();
    return false;
  }

  saveUndoSnapshot();
  if (destRoom.locked) {
    destRoom.locked = false;
    destRoom.status = "開放中";
  }

  let movedCount = 0;
  const srcRoomId = sourceP.roomId;
  if (mp.scope === "group" && sourceP.card.group_id) {
    const gid = sourceP.card.group_id;
    for (const p of Object.values(gameState.placements)) {
      const isPet = p.card.kind === "pet" || p.card.data?.data_type === "ペット";
      if (isPet && p.card.card_number !== sourceP.card.card_number && p.roomId !== srcRoomId && gameState.rooms[p.roomId]?.isPetZone) {
        continue;
      }
      if (p.card.group_id === gid) {
        p.roomId = destRoomId;
        p.movedCount = (p.movedCount || 0) + 1;
        movedCount++;
      }
    }
  } else {
    sourceP.roomId = destRoomId;
    sourceP.movedCount = (sourceP.movedCount || 0) + 1;
    movedCount = 1;
  }

  gameState.operationLogs.push({
    stepIdx: gameState.currentStepIdx,
    cardNo: sourceP.card.card_number,
    title: `${sourceP.card.data?.name || `No.${sourceP.card.card_number}`} 直接移動`,
    kind: "relocate",
    actionText: `${mp.scope === "group" ? "世帯単位" : "個人単位"}(${movedCount}名)を「${destRoom.shortName}」へ移動`,
    targetRoomId: destRoomId,
    evaluation: "good",
  });

  gameState.movingPawn = null;
  gameState.selectedRoomId = null;
  sfx.playPlace();
  showGameToast(`🔄 ${movedCount}名を「${destRoom.shortName}」へ移動しました`, "success", 2000);
  renderPlayView();
  return true;
}

function bindPlayViewEvents(step, stepAnalysis, evAnalysis) {
  dioramaJustDragged = false;

  // 1. トップバーボタン
  document.getElementById("hg-undo-btn")?.addEventListener("click", () => {
    undoLastAction();
  });

  document.getElementById("hg-open-menu-btn")?.addEventListener("click", () => {
    openInGameMenuModal();
  });

  // 2. エリアタブ切替（全館俯瞰中なら該当エリアへズーム切替）
  document.querySelectorAll("[data-area-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-area-tab");
      if (tabId) {
        gameState.activeAreaTab = tabId;
        if (gameState.camera.scope === "all") {
          gameState.camera.scope = "area";
          gameState.camera.zoom = 0.96;
          gameState.camera.panX = 0;
          gameState.camera.panY = 0;
        }
        gameState.selectedRoomId = null;
        renderPlayView();
      }
    });
  });

  // 全館ビューから各階をワンタップズームイン
  document.querySelectorAll("[data-jump-area]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const areaId = btn.getAttribute("data-jump-area");
      if (!areaId) return;
      gameState.activeAreaTab = areaId;
      gameState.camera.scope = "area";
      gameState.camera.zoom = 1;
      gameState.camera.panX = 0;
      gameState.camera.panY = 0;
      renderPlayView();
    });
  });

  // 2.5 カメラコントロール HUD & ドラッグ・ピンチ/ホイール見回し
  document.getElementById("hg-cam-scope-btn")?.addEventListener("click", () => {
    gameState.camera.scope = gameState.camera.scope === "all" ? "area" : "all";
    gameState.camera.panX = 0;
    gameState.camera.panY = 0;
    gameState.camera.zoom = gameState.camera.scope === "all" ? 0.92 : 0.96;
    renderPlayView();
  });

  document.getElementById("hg-cam-tilt-btn")?.addEventListener("click", () => {
    if (gameState.camera.mode === "flat") {
      gameState.camera.mode = "3d";
      if (gameState.camera.tiltX === 0) gameState.camera.tiltX = 13;
    } else {
      gameState.camera.mode = "flat";
    }
    renderPlayView();
  });

  document.getElementById("hg-cam-rot-left")?.addEventListener("click", () => {
    gameState.camera.mode = "3d";
    gameState.camera.rotZ = Math.max(-48, Math.round(gameState.camera.rotZ - 10));
    applyCameraStyleToDOM();
  });

  document.getElementById("hg-cam-rot-right")?.addEventListener("click", () => {
    gameState.camera.mode = "3d";
    gameState.camera.rotZ = Math.min(48, Math.round(gameState.camera.rotZ + 10));
    applyCameraStyleToDOM();
  });

  document.getElementById("hg-cam-zoom-in")?.addEventListener("click", () => {
    gameState.camera.zoom = Math.min(1.85, Math.round((gameState.camera.zoom + 0.15) * 100) / 100);
    applyCameraStyleToDOM();
  });

  document.getElementById("hg-cam-zoom-out")?.addEventListener("click", () => {
    gameState.camera.zoom = Math.max(0.55, Math.round((gameState.camera.zoom - 0.15) * 100) / 100);
    applyCameraStyleToDOM();
  });

  document.getElementById("hg-cam-reset")?.addEventListener("click", () => {
    gameState.camera.mode = "3d";
    gameState.camera.rotZ = -1.5;
    gameState.camera.tiltX = 13;
    gameState.camera.zoom = gameState.camera.scope === "all" ? 0.92 : 0.96;
    gameState.camera.panX = 0;
    gameState.camera.panY = 0;
    renderPlayView();
  });

  const viewportEl = document.getElementById("hg-diorama-viewport");
  if (viewportEl) {
    let dragActive = false;
    let dragMoved = false;
    let startX = 0;
    let startY = 0;
    let originPanX = 0;
    let originPanY = 0;

    viewportEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("input, textarea, select")) return;
      dragActive = true;
      dragMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      originPanX = gameState.camera.panX;
      originPanY = gameState.camera.panY;
    });

    viewportEl.addEventListener("pointermove", (e) => {
      if (!dragActive) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // 狭幅モバイルの通常単層時は横移動や拡大時のみパンし、縦スクロールを阻害しない
      const allowTouchPan =
        e.pointerType !== "touch" ||
        gameState.camera.scope === "all" ||
        gameState.camera.zoom > 1.05 ||
        Math.abs(dx) > 10;
      if (allowTouchPan && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) {
        dragMoved = true;
        dioramaJustDragged = true;
        gameState.camera.panX = Math.max(-240, Math.min(240, Math.round(originPanX + dx)));
        gameState.camera.panY = Math.max(-200, Math.min(200, Math.round(originPanY + dy)));
        applyCameraStyleToDOM();
      }
    });

    const endDrag = () => {
      if (!dragActive) return;
      dragActive = false;
      if (dragMoved) {
        setTimeout(() => {
          dioramaJustDragged = false;
        }, 60);
      }
    };
    viewportEl.addEventListener("pointerup", endDrag);
    viewportEl.addEventListener("pointercancel", endDrag);

    viewportEl.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || gameState.camera.scope === "all") {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.08 : -0.08;
          gameState.camera.zoom = Math.max(0.55, Math.min(1.85, Math.round((gameState.camera.zoom + delta) * 100) / 100));
          applyCameraStyleToDOM();
        }
      },
      { passive: false }
    );
  }

  // 2.6 直接コマ移動バーの操作
  document.getElementById("hg-pawn-scope-person")?.addEventListener("click", () => {
    if (gameState.movingPawn) {
      gameState.movingPawn.scope = "person";
      renderPlayView();
    }
  });
  document.getElementById("hg-pawn-scope-group")?.addEventListener("click", () => {
    if (gameState.movingPawn) {
      gameState.movingPawn.scope = "group";
      renderPlayView();
    }
  });
  document.getElementById("hg-pawn-move-cancel")?.addEventListener("click", () => {
    gameState.movingPawn = null;
    renderPlayView();
  });

  // コマ自体のタップ（世帯・個人直接移動モードの開始/切替）
  document.querySelectorAll("[data-pawn-card-no]").forEach((pawnBtn) => {
    pawnBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dioramaJustDragged) return;
      const cno = Number(pawnBtn.getAttribute("data-pawn-card-no"));
      const rid = pawnBtn.getAttribute("data-room-id");
      const occ = gameState.placements[cno];
      if (!occ) return;

      if (gameState.movingPawn && gameState.movingPawn.cardNo === cno) {
        gameState.movingPawn = null;
        renderPlayView();
        return;
      }

      const gid = occ.card.group_id;
      const groupCnt = gid
        ? Object.values(gameState.placements).filter((p) => p.card.group_id === gid).length
        : 1;
      gameState.movingPawn = {
        cardNo: cno,
        fromRoomId: rid || occ.roomId,
        scope: gid && groupCnt > 1 ? "group" : "person",
      };
      renderPlayView();
    });
  });

  // 3. 未開放フロア一括解錠ボタン（全館俯瞰/単層の両方に対応）
  document.querySelectorAll("[data-unlock-area]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const areaId = btn.getAttribute("data-unlock-area") || gameState.activeAreaTab;
      Object.values(gameState.rooms).forEach((r) => {
        if (r.areaId === areaId) {
          r.locked = false;
          r.status = "開放中";
        }
      });
      showGameToast("🔓 フロアの教室を開放しました！", "success");
      renderPlayView();
    });
  });

  // 4. 部屋の内訳・移動ボタン (`[data-inspect-room]`)
  document.querySelectorAll("[data-inspect-room]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rid = btn.getAttribute("data-inspect-room");
      if (rid) openRoomInspectorModal(rid);
    });
  });

  // 5. 部屋セル本体のタップ（直接コマ移動中なら移動 / 配置 / 解錠 / 内訳確認）
  document.querySelectorAll(".hg-room-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      if (dioramaJustDragged) return;
      const rid = cell.getAttribute("data-room-id");
      if (!rid) return;
      const room = gameState.rooms[rid];
      if (!room) return;

      // コマ直接移動モード中なら即座にこの部屋へ移動
      if (gameState.movingPawn) {
        executePawnMoveToRoom(rid);
        return;
      }

      if (room.locked) {
        room.locked = false;
        room.status = "開放中";
        showGameToast(`🔓 「${room.shortName}」を解錠・開放しました`, "info");
        renderPlayView();
        return;
      }

      if (room.closed) {
        openRoomInspectorModal(rid);
        return;
      }

      if (step.isEvent) {
        // イベント時はその部屋の内訳・状態モーダルを開く
        openRoomInspectorModal(rid);
        return;
      }

      // 避難者・世帯カードの配置処理
      if (gameState.settings.tapMode === "two_tap" && gameState.selectedRoomId !== rid) {
        gameState.selectedRoomId = rid;
        renderPlayView();
        return;
      }

      placeCurrentStepIntoRoom(rid, step, stepAnalysis);
    });
  });

  // 6. 2タップ確認モードの確定ボタン
  document.getElementById("hg-confirm-two-tap-btn")?.addEventListener("click", () => {
    if (gameState.selectedRoomId && !step.isEvent) {
      placeCurrentStepIntoRoom(gameState.selectedRoomId, step, stepAnalysis);
    }
  });

  // 7. クイック配置ボタン
  document.querySelectorAll("[data-quick-room-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rid = btn.getAttribute("data-quick-room-id");
      if (rid && !step.isEvent) {
        placeCurrentStepIntoRoom(rid, step, stepAnalysis);
      }
    });
  });

  // 8. ペット自動分離チェックボックス
  const splitChk = document.getElementById("hg-auto-split-pet-chk");
  if (splitChk) {
    splitChk.addEventListener("change", (e) => {
      gameState.settings.autoSplitPets = Boolean(e.target.checked);
    });
  }

  // 9. 公式カード表示モード切替 ＆ ドックサイズ切替 ＆ カード画像拡大モーダル
  document.getElementById("hg-toggle-card-view-btn")?.addEventListener("click", () => {
    gameState.dockViewMode = gameState.dockViewMode === "card" ? "illust" : "card";
    renderPlayView();
  });

  document.getElementById("hg-toggle-dock-size-btn")?.addEventListener("click", () => {
    gameState.dockSize = gameState.dockSize === "expanded" ? "normal" : "expanded";
    renderPlayView();
  });

  document.getElementById("hg-open-card-img-btn")?.addEventListener("click", () => {
    openCardImagePreviewModal(step.cards);
  });

  // イラストまたは公式カード画像のタップで公式カード拡大モーダル
  document.querySelectorAll("[data-open-card-no]").forEach((el) => {
    const openTarget = () => {
      const cno = Number(el.getAttribute("data-open-card-no"));
      const idx = step.cards.findIndex((c) => Number(c.card_number) === cno);
      openCardImagePreviewModal(step.cards, idx >= 0 ? idx : 0);
    };
    el.addEventListener("click", openTarget);
    if (el.tagName !== "BUTTON") {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTarget();
        }
      });
    }
  });

  // 公式カードモード時は Canvas カード画像を各要素に非同期描画バインド
  if (gameState.dockViewMode === "card") {
    const posMap = computeGroupPositionMap(gameState.activeDeckCards);
    document.querySelectorAll("[data-real-card-no]").forEach((imgEl) => {
      const cno = Number(imgEl.getAttribute("data-real-card-no"));
      const card = step.cards.find((c) => Number(c.card_number) === cno);
      bindRealCardCanvasToImage(imgEl, card, posMap);
    });
  }

  // 10. イベントカードの選択肢アクション
  if (step.isEvent && evAnalysis) {
    bindEventActionHandlers(step, evAnalysis);
  }
}

function bindRealCardCanvasToImage(imgEl, card, posMap) {
  if (!imgEl || !card) return;
  const pos = posMap?.get(String(card.original_id || ""));
  const model = toCardRenderModel(card, card.group, {
    cardNumber: card.card_number,
    imageIds: store.imageIds,
    groupIndex: pos?.group_index ?? card.group_index,
    groupTotal: pos?.group_total ?? card.group_total,
  });
  if (model) {
    bindCardCanvasImage(imgEl, model, { showNumber: true });
  }
}

// ============================================================================
// 避難者・世帯カードの配置実行 ＆ フィードバック評価
// ============================================================================
export function placeCurrentStepIntoRoom(targetRoomId, step, stepAnalysis) {
  const room = gameState.rooms[targetRoomId];
  if (!room || room.closed) {
    showGameToast("⚠️ この区画は現在立入禁止・使用不可です", "warn");
    return;
  }

  saveUndoSnapshot();

  const splitPets =
    stepAnalysis?.hasPetWithHumans &&
    gameState.settings.autoSplitPets &&
    targetRoomId !== "corridor-pet";

  for (const card of step.cards) {
    const isPet = card.kind === "pet" || card.data?.data_type === "ペット";
    const destRoomId = splitPets && isPet ? "corridor-pet" : targetRoomId;
    gameState.placements[card.card_number] = {
      roomId: destRoomId,
      card,
      stepIdx: step.stepIdx,
      movedCount: 0,
    };
  }

  // 配置の適性評価とトーストフィードバック
  const isRec = stepAnalysis?.recommendedRooms?.includes(targetRoomId);
  let evalStatus = "good";
  let feedbackMsg = `✅ 「${room.shortName}」へ配置しました`;

  if (splitPets) {
    feedbackMsg = `✅ 家族を「${room.shortName}」、ペットを「渡り廊下(ペット区画)」へ配置しました`;
  } else if (!stepAnalysis?.isPetOnly && stepAnalysis?.pets?.length > 0 && !room.isPetZone && !room.isExternal) {
    evalStatus = "warn";
    feedbackMsg = `⚠️ ペットも同室に配置されました（渡り廊下ペット区画への分離が推奨されます）`;
  } else if (stepAnalysis?.isPetOnly && !room.isPetZone && areaIsIndoor(room.areaId)) {
    evalStatus = "warn";
    feedbackMsg = `⚠️ ペットが屋内一般室に配置されました（渡り廊下ペット区画が推奨されます）`;
  } else if (stepAnalysis?.hasMobilityIssue && (room.areaId === "floor2" || room.areaId === "floor3")) {
    evalStatus = "warn";
    feedbackMsg = `⚠️ 足腰・移動配慮が必要な方が上階(${room.shortName})に配置されました（1Fまたは体育館入口側推奨）`;
  } else if (stepAnalysis?.hasInfection && !room.isIsolation && room.id !== "f1-infirmary") {
    evalStatus = "warn";
    feedbackMsg = `⚠️ 発熱・感染症疑いの方が一般区画に配置されました（3F隔離室推奨）`;
  } else if (isRec) {
    evalStatus = "good";
  }

  gameState.operationLogs.push({
    stepIdx: step.stepIdx,
    cardNo: step.startNo,
    title: step.title,
    kind: "placement",
    actionText: splitPets
      ? `${room.shortName}（＋🐾渡り廊下）へ配置`
      : `${room.shortName} へ配置`,
    targetRoomId,
    evaluation: evalStatus,
  });

  sfx.playPlace();
  if (gameState.settings.assistMode === "guided" || evalStatus === "good") {
    showGameToast(feedbackMsg, evalStatus === "warn" ? "warn" : "success", 2300);
  } else {
    showGameToast(`✅ 「${room.shortName}」へ配置しました`, "info", 1600);
  }

  advanceToNextStep();
}

function areaIsIndoor(areaId) {
  return areaId === "gym" || areaId === "floor1" || areaId === "floor2" || areaId === "floor3";
}

// ============================================================================
// イベントカードの対応メモ記録＆次ステップ進行ハンドラ（選択肢なし・自由記述方式）
// ============================================================================
function bindEventActionHandlers(step, evAnalysis) {
  const card = step.cards[0];
  const cardKey = String(card.card_number);
  const memoInput = document.getElementById("hg-event-memo-input");
  const memoStatusEl = document.getElementById("hg-event-memo-status");

  const syncMemoDraft = (rawVal) => {
    const val = String(rawVal ?? "");
    if (!gameState.eventMemos) gameState.eventMemos = {};
    gameState.eventMemos[cardKey] = {
      stepIdx: step.stepIdx,
      cardNo: card.card_number,
      title: step.title,
      memo: val,
      updatedAt: new Date().toISOString(),
    };
    if (memoStatusEl) {
      memoStatusEl.textContent = val.trim().length > 0 ? "✅ メモ記入済み（自動保存）" : "✏️ 自由記入";
    }
  };

  memoInput?.addEventListener("input", (e) => {
    syncMemoDraft(e.target.value);
  });

  document.getElementById("hg-event-memo-submit-btn")?.addEventListener("click", () => {
    const memoText = String(memoInput ? memoInput.value : gameState.eventMemos?.[cardKey]?.memo || "").trim();
    saveUndoSnapshot();
    syncMemoDraft(memoInput ? memoInput.value : memoText);

    gameState.operationLogs.push({
      stepIdx: step.stepIdx,
      cardNo: card.card_number,
      title: step.title,
      kind: "event_memo",
      actionText: memoText ? `対応メモ記録: ${memoText}` : "イベント確認・現場操作完了（メモ未入力）",
      memo: memoText,
      targetRoomId: evAnalysis?.targetRoomId || "f1-hq",
      evaluation: "good",
    });

    sfx.playPlace();
    showGameToast(
      memoText ? "📝 対応メモを記録して次のカードへ進みます" : "➡️ イベントを完了し次のカードへ進みます",
      "success",
      1800
    );
    advanceToNextStep();
  });
}

function advanceToNextStep() {
  gameState.selectedRoomId = null;
  gameState.movingPawn = null;
  if (gameState.currentStepIdx < gameState.steps.length - 1) {
    gameState.currentStepIdx++;
    syncRecommendedAreaTabForCurrentStep();
    resetStepTimer();
    renderPlayView();
  } else {
    renderCompletionReportView();
  }
}

// ============================================================================
// モーダル1: 部屋の内訳・世帯/個人の別室移動・部屋ステータス変更 (Room Inspector)
// ============================================================================
export function openRoomInspectorModal(roomId) {
  closeAllGameModals();
  const room = gameState.rooms[roomId];
  if (!room) return;

  const occupants = getRoomOccupants(roomId);
  const allOpenRooms = Object.values(gameState.rooms).filter(
    (r) => r.id !== roomId && !r.closed && !r.locked
  );

  const overlay = document.createElement("div");
  overlay.className = "hg-modal-overlay";
  overlay.id = "hg-room-modal-overlay";
  overlay.setAttribute("data-testid", "hg-room-modal");

  overlay.innerHTML = `
    <div class="hg-modal-dialog" role="dialog" aria-modal="true">
      <div class="hg-modal-header">
        <h3>${room.icon} ${escapeHtml(room.name)}</h3>
        <button type="button" class="hg-btn hg-btn-sm" id="hg-room-modal-close">✕ 閉じる</button>
      </div>
      <div class="hg-modal-body">
        <div style="font-size:0.8rem;color:var(--hg-text-sub);background:#f8fafc;padding:0.5rem 0.65rem;border-radius:8px;border:1px solid #e2e8f0;">
          <div>${escapeHtml(room.desc)}</div>
          <div style="margin-top:0.35rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;">
            <span>現在: <strong>${occupants.length}</strong> / 定員目安 ${room.capacity}名 ・ 状態: <strong>${escapeHtml(room.status)}</strong></span>
            <button type="button" class="hg-btn hg-btn-sm ${room.closed ? "hg-btn-primary" : "hg-btn-danger"}" id="hg-toggle-room-closed-btn" data-testid="hg-toggle-room-closed-btn">
              ${room.closed ? "🔓 立入禁止を解除する" : "🚫 この区画を立入禁止にする"}
            </button>
          </div>
          <div style="margin-top:0.45rem;display:flex;align-items:center;flex-wrap:wrap;gap:0.3rem;" data-testid="hg-room-status-presets">
            <span style="font-size:0.72rem;font-weight:800;color:#475569;">運用状態:</span>
            ${["開放中", "稼働中(10基)", "✅ 受付・救護稼働中", "🦠 隔離運用中"]
              .map(
                (st) => `
                  <button
                    type="button"
                    class="hg-btn hg-btn-sm ${room.status === st ? "hg-btn-primary" : ""}"
                    data-status-preset="${escapeHtml(st)}"
                    data-testid="hg-room-status-preset"
                  >
                    ${escapeHtml(st)}
                  </button>
                `
              )
              .join("")}
          </div>
        </div>

        ${
          occupants.length > 0
            ? `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;flex-wrap:wrap;background:#eff6ff;padding:0.45rem 0.65rem;border-radius:8px;">
                <span style="font-size:0.78rem;font-weight:800;color:#1e40af;">🔄 この部屋の全員を一括移動:</span>
                <div style="display:flex;gap:0.35rem;align-items:center;flex-wrap:wrap;">
                  <select id="hg-bulk-move-select" class="hg-btn hg-btn-sm" data-testid="hg-bulk-move-select">
                    <option value="">-- 移動先の部屋を選択 --</option>
                    ${allOpenRooms
                      .map((r) => `<option value="${r.id}">${escapeHtml(r.shortName)} (${getRoomOccupants(r.id).length}/${r.capacity})</option>`)
                      .join("")}
                  </select>
                  <button type="button" class="hg-btn hg-btn-sm hg-btn-primary" id="hg-bulk-move-btn" data-testid="hg-bulk-move-btn">
                    一括移動
                  </button>
                </div>
              </div>

              <div style="display:flex;flex-direction:column;gap:0.45rem;" data-testid="hg-room-occupant-list">
                ${occupants
                  .map((occ) => {
                    const c = occ.card;
                    const d = c.data || {};
                    const isPet = c.kind === "pet" || d.data_type === "ペット";
                    return `
                      <div style="border:1px solid #cbd5e1;border-radius:10px;padding:0.5rem 0.65rem;background:#ffffff;display:flex;flex-direction:column;gap:0.35rem;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.45rem;">
                          <div style="display:flex;align-items:center;gap:0.5rem;min-width:0;">
                            <img
                              src="${getCardIllustrationUrl(c)}"
                              alt="${escapeHtml(d.name || c.title || "")}"
                              data-preview-card-no="${c.card_number}"
                              style="width:38px;height:38px;border-radius:8px;object-fit:contain;background:#fff7ed;border:1px solid #fed7aa;flex-shrink:0;cursor:pointer;"
                            />
                            <div style="min-width:0;">
                              <strong style="font-size:0.84rem;display:block;">
                                No.${c.card_number} ${isPet ? "🐾" : "👤"} ${escapeHtml(d.name || c.title || "")}
                              </strong>
                              <small style="color:#64748b;font-weight:600;">${escapeHtml(c.group?.group_name || "単身")}${d.age !== undefined && d.age !== null ? `・${escapeHtml(String(d.age))}歳` : ""}</small>
                            </div>
                          </div>
                          <button type="button" class="hg-btn hg-btn-sm" data-preview-card-no="${c.card_number}">
                            🖼️ カード
                          </button>
                        </div>
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;flex-wrap:wrap;">
                          <select class="hg-btn hg-btn-sm hg-single-move-select" data-card-no="${c.card_number}" data-group-id="${escapeHtml(c.group_id || "")}">
                            <option value="">-- 別の部屋へ移動 --</option>
                            ${allOpenRooms
                              .map((r) => `<option value="${r.id}">${escapeHtml(r.shortName)}</option>`)
                              .join("")}
                          </select>
                          <div style="display:flex;gap:0.25rem;">
                            <button type="button" class="hg-btn hg-btn-sm hg-btn-primary hg-move-person-btn" data-card-no="${c.card_number}">
                              この1人を移動
                            </button>
                            ${
                              c.group_id
                                ? `<button type="button" class="hg-btn hg-btn-sm hg-move-group-btn" data-card-no="${c.card_number}" data-group-id="${escapeHtml(c.group_id)}">
                                    世帯全員を移動
                                  </button>`
                                : ""
                            }
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `<div style="text-align:center;padding:1.5rem;color:#64748b;font-size:0.85rem;">現在この区画に配置されている避難者はいません。</div>`
        }
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#hg-room-modal-close")?.addEventListener("click", closeAllGameModals);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAllGameModals();
  });

  // 立入禁止トグル
  overlay.querySelector("#hg-toggle-room-closed-btn")?.addEventListener("click", () => {
    saveUndoSnapshot();
    room.closed = !room.closed;
    room.status = room.closed ? "🚫 立入禁止" : "開放中";
    showGameToast(
      room.closed ? `🚫 「${room.shortName}」を立入禁止にしました` : `🔓 「${room.shortName}」を開放しました`,
      "info"
    );
    closeAllGameModals();
    renderPlayView();
  });

  // 運用状態プリセット変更
  overlay.querySelectorAll("[data-status-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const st = btn.getAttribute("data-status-preset");
      if (!st) return;
      saveUndoSnapshot();
      room.locked = false;
      room.closed = false;
      room.status = st;
      showGameToast(`🔧 「${room.shortName}」の状態を「${st}」に更新しました`, "success", 1800);
      openRoomInspectorModal(roomId);
      renderPlayView();
    });
  });

  // 全員一括移動
  overlay.querySelector("#hg-bulk-move-btn")?.addEventListener("click", () => {
    const destId = overlay.querySelector("#hg-bulk-move-select")?.value;
    if (!destId) return;
    saveUndoSnapshot();
    for (const occ of occupants) {
      occ.roomId = destId;
      occ.movedCount = (occ.movedCount || 0) + 1;
    }
    showGameToast(`🔄 ${occupants.length}名を「${gameState.rooms[destId]?.shortName}」へ移動しました`, "success");
    closeAllGameModals();
    renderPlayView();
  });

  // 個人移動
  overlay.querySelectorAll(".hg-move-person-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cno = Number(btn.getAttribute("data-card-no"));
      const sel = overlay.querySelector(`.hg-single-move-select[data-card-no="${cno}"]`);
      const destId = sel?.value;
      if (!destId || !gameState.placements[cno]) return;
      saveUndoSnapshot();
      gameState.placements[cno].roomId = destId;
      gameState.placements[cno].movedCount = (gameState.placements[cno].movedCount || 0) + 1;
      showGameToast(`🔄 No.${cno} を「${gameState.rooms[destId]?.shortName}」へ移動しました`, "success");
      openRoomInspectorModal(roomId);
      renderPlayView();
    });
  });

  // 世帯全員移動
  overlay.querySelectorAll(".hg-move-group-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cno = Number(btn.getAttribute("data-card-no"));
      const gid = btn.getAttribute("data-group-id");
      const sel = overlay.querySelector(`.hg-single-move-select[data-card-no="${cno}"]`);
      const destId = sel?.value;
      if (!destId || !gid) return;
      saveUndoSnapshot();
      let cnt = 0;
      for (const p of Object.values(gameState.placements)) {
        const isPet = p.card.kind === "pet" || p.card.data?.data_type === "ペット";
        if (isPet && p.roomId !== roomId && gameState.rooms[p.roomId]?.isPetZone) {
          continue;
        }
        if (p.card.group_id === gid) {
          p.roomId = destId;
          p.movedCount = (p.movedCount || 0) + 1;
          cnt++;
        }
      }
      showGameToast(`🔄 世帯(${cnt}名)を「${gameState.rooms[destId]?.shortName}」へ移動しました`, "success");
      openRoomInspectorModal(roomId);
      renderPlayView();
    });
  });

  // カード画像プレビュー
  overlay.querySelectorAll("[data-preview-card-no]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cno = Number(btn.getAttribute("data-preview-card-no"));
      const p = gameState.placements[cno];
      if (p) openCardImagePreviewModal([p.card]);
    });
  });
}

// ============================================================================
// モーダル2: 公式HUGカード画像（Canvas描画）プレビューモーダル
// ============================================================================
export function openCardImagePreviewModal(cards, initialIdx = 0) {
  closeAllGameModals();
  if (!cards || cards.length === 0) return;

  let curIdx = Math.max(0, Math.min(cards.length - 1, initialIdx));

  const overlay = document.createElement("div");
  overlay.className = "hg-modal-overlay";
  overlay.id = "hg-card-img-modal-overlay";
  overlay.setAttribute("data-testid", "hg-card-img-modal");

  function renderModalContent() {
    const activeCard = cards[curIdx];
    const posMap = computeGroupPositionMap(gameState.activeDeckCards);

    overlay.innerHTML = `
      <div class="hg-modal-dialog" role="dialog" aria-modal="true">
        <div class="hg-modal-header">
          <h3>🃏 公式カードプレビュー (No.${activeCard.card_number})</h3>
          <button type="button" class="hg-btn hg-btn-sm" id="hg-card-modal-close">✕ 閉じる</button>
        </div>
        <div class="hg-modal-body">
          ${
            cards.length > 1
              ? `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
                  <button type="button" class="hg-btn hg-btn-sm" id="hg-card-prev-btn">◀ 前へ</button>
                  <span style="font-size:0.82rem;font-weight:800;">${curIdx + 1} / ${cards.length} 枚目</span>
                  <button type="button" class="hg-btn hg-btn-sm" id="hg-card-next-btn">次へ ▶</button>
                </div>
              `
              : ""
          }
          <div class="hg-card-canvas-wrap">
            <img class="hg-card-canvas-img" id="hg-card-canvas-img" data-testid="hg-card-canvas-img" alt="HUGカード画像" />
          </div>
        </div>
      </div>
    `;

    const imgEl = overlay.querySelector("#hg-card-canvas-img");
    bindRealCardCanvasToImage(imgEl, activeCard, posMap);

    overlay.querySelector("#hg-card-modal-close")?.addEventListener("click", closeAllGameModals);
    overlay.querySelector("#hg-card-prev-btn")?.addEventListener("click", () => {
      curIdx = (curIdx - 1 + cards.length) % cards.length;
      renderModalContent();
    });
    overlay.querySelector("#hg-card-next-btn")?.addEventListener("click", () => {
      curIdx = (curIdx + 1) % cards.length;
      renderModalContent();
    });
  }

  renderModalContent();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAllGameModals();
  });
  document.body.appendChild(overlay);
}

// ============================================================================
// モーダル3: インゲーム設定＆全体状況確認メニュー
// ============================================================================
export function openInGameMenuModal() {
  closeAllGameModals();
  const s = gameState.settings;
  const pop = getTotalShelterPopulation();

  const overlay = document.createElement("div");
  overlay.className = "hg-modal-overlay";
  overlay.id = "hg-ingame-menu-overlay";
  overlay.setAttribute("data-testid", "hg-ingame-menu");

  overlay.innerHTML = `
    <div class="hg-modal-dialog" role="dialog" aria-modal="true">
      <div class="hg-modal-header">
        <h3>☰ ゲーム設定 ＆ 避難所全体状況</h3>
        <button type="button" class="hg-btn hg-btn-sm" id="hg-menu-close-btn">✕ 閉じる</button>
      </div>
      <div class="hg-modal-body">
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:0.65rem 0.85rem;font-size:0.82rem;">
          <div style="font-weight:800;margin-bottom:0.25rem;">📊 現在の第五小学校 収容サマリー</div>
          <div>館内避難者: <strong>${pop.persons}名</strong> / ペット: <strong>${pop.pets}匹</strong> / 在宅・搬送・退所: <strong>${pop.external}名</strong></div>
        </div>

        <div class="hg-setting-box">
          <div class="hg-setting-label">👆 配置タップ方式</div>
          <div class="hg-pill-group">
            <button type="button" class="hg-pill-opt ${s.tapMode === "one_tap" ? "active" : ""}" id="hg-live-tap-one">⚡ ワンタップ即配置</button>
            <button type="button" class="hg-pill-opt ${s.tapMode === "two_tap" ? "active" : ""}" id="hg-live-tap-two">🛡️ 2タップ確認</button>
          </div>
        </div>

        <div class="hg-setting-box">
          <div class="hg-setting-label">💡 推奨エリア・配慮ガイド表示</div>
          <div class="hg-pill-group">
            <button type="button" class="hg-pill-opt ${s.assistMode === "guided" ? "active" : ""}" id="hg-live-assist-guided">💡 ガイドあり</button>
            <button type="button" class="hg-pill-opt ${s.assistMode === "challenge" ? "active" : ""}" id="hg-live-assist-challenge">🔥 ヒントなし</button>
          </div>
        </div>

        <div class="hg-setting-box">
          <div class="hg-setting-label">🔊 効果音</div>
          <button type="button" class="hg-btn hg-btn-sm ${s.soundEnabled ? "hg-btn-primary" : ""}" id="hg-live-sound-btn">
            ${s.soundEnabled ? "🔊 効果音 ON" : "🔇 効果音 OFF"}
          </button>
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.4rem;border-top:1px solid #e2e8f0;">
          <button type="button" class="hg-btn hg-btn-primary" id="hg-finish-now-btn" data-testid="hg-finish-now-btn" style="flex:1;">
            📊 ここまでの結果で振り返り講評を見る
          </button>
          <button type="button" class="hg-btn hg-btn-danger" id="hg-return-setup-btn" data-testid="hg-return-setup-btn">
            🏠 設定画面へ戻る
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#hg-menu-close-btn")?.addEventListener("click", closeAllGameModals);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAllGameModals();
  });

  overlay.querySelector("#hg-live-tap-one")?.addEventListener("click", () => {
    gameState.settings.tapMode = "one_tap";
    closeAllGameModals();
    renderPlayView();
  });
  overlay.querySelector("#hg-live-tap-two")?.addEventListener("click", () => {
    gameState.settings.tapMode = "two_tap";
    closeAllGameModals();
    renderPlayView();
  });
  overlay.querySelector("#hg-live-assist-guided")?.addEventListener("click", () => {
    gameState.settings.assistMode = "guided";
    closeAllGameModals();
    renderPlayView();
  });
  overlay.querySelector("#hg-live-assist-challenge")?.addEventListener("click", () => {
    gameState.settings.assistMode = "challenge";
    closeAllGameModals();
    renderPlayView();
  });
  overlay.querySelector("#hg-live-sound-btn")?.addEventListener("click", () => {
    gameState.settings.soundEnabled = !gameState.settings.soundEnabled;
    sfx.enabled = gameState.settings.soundEnabled;
    openInGameMenuModal();
  });
  overlay.querySelector("#hg-finish-now-btn")?.addEventListener("click", () => {
    closeAllGameModals();
    renderCompletionReportView();
  });
  overlay.querySelector("#hg-return-setup-btn")?.addEventListener("click", () => {
    closeAllGameModals();
    renderSetupView();
  });
}

export function closeAllGameModals() {
  ["hg-room-modal-overlay", "hg-card-img-modal-overlay", "hg-ingame-menu-overlay"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
}

// ============================================================================
// 4. 訓練完了＆振り返り講評レポート画面 (Completion & Review Report View)
// ============================================================================
export function evaluateTrainingPerformance() {
  const checks = [];
  let totalPoints = 0;
  let earnedPoints = 0;

  const placements = Object.values(gameState.placements);

  // 1. ペット同行避難の分離チェック
  const pets = placements.filter((p) => p.card.kind === "pet" || p.card.data?.data_type === "ペット");
  if (pets.length > 0) {
    totalPoints += 20;
    const properlySeparated = pets.filter((p) => {
      const r = gameState.rooms[p.roomId];
      return r && (r.isPetZone || r.areaId === "grounds" || r.isExternal);
    });
    if (properlySeparated.length === pets.length) {
      earnedPoints += 20;
      checks.push({
        good: true,
        title: "🐾 ペット同行避難の飼育区画分離（渡り廊下・ピロティ等）",
        detail: `ペット全${pets.length}匹が人間の一般居住区画と分離された専用エリアに適切に配置されました。`,
      });
    } else {
      earnedPoints += 8;
      checks.push({
        good: false,
        title: "🐾 ペット同行避難の空間分離に改善の余地あり",
        detail: `一部のペットが屋内居住区画に配置されました。動物アレルギーや鳴き声トラブル防止のため「渡り廊下（ペット区画）」への分離が原則です。`,
      });
    }
  }

  // 2. 要配慮者・車椅子・高齢者のバリアフリー配置チェック
  const mobilityCards = placements.filter((p) => {
    const t = JSON.stringify(p.card.data || {});
    return /車椅子|足腰|杖|歩行困難|視覚障害|要介護/.test(t);
  });
  if (mobilityCards.length > 0) {
    totalPoints += 25;
    const onUpperFloor = mobilityCards.filter((p) => {
      const r = gameState.rooms[p.roomId];
      return r && (r.areaId === "floor2" || r.areaId === "floor3");
    });
    if (onUpperFloor.length === 0) {
      earnedPoints += 25;
      checks.push({
        good: true,
        title: "♿ 車椅子・足腰不自由な要配慮者の1階/出入口近くへの配置",
        detail: `移動困難な要配慮者（${mobilityCards.length}名）全員が1階福祉教室・保健室・体育館A区画または福祉避難所へ適切に配置されました。`,
      });
    } else {
      earnedPoints += 12;
      checks.push({
        good: false,
        title: "♿ 階段移動が困難な方のフロア配置に注意",
        detail: `車椅子や足腰不自由な方のうち${onUpperFloor.length}名が2階・3階に配置されました。停電時はエレベーターも止まるため1階配置が重要です。`,
      });
    }
  }

  // 3. 医療・非常用電源・救護対応チェック
  const medicalCards = placements.filter((p) => {
    const t = JSON.stringify(p.card.data || {});
    return /電源|人工透析|酸素|インスリン|骨折|意識障害/.test(t);
  });
  if (medicalCards.length > 0) {
    totalPoints += 20;
    const wellPlaced = medicalCards.filter((p) =>
      ["f1-infirmary", "f1-welfare", "ext-hospital", "ext-welfare"].includes(p.roomId)
    );
    if (wellPlaced.length >= Math.ceil(medicalCards.length * 0.6)) {
      earnedPoints += 20;
      checks.push({
        good: true,
        title: "🏥 傷病者・医療機器電源必要者の救護・搬送対応",
        detail: `人工透析・酸素濃縮器・骨折等の要医療ケア者が1F保健室や医療機関搬送へ優先対応されました。`,
      });
    } else {
      earnedPoints += 10;
      checks.push({
        good: false,
        title: "🏥 要医療・電源依存者の優先確保を振り返りましょう",
        detail: `酸素濃縮器や骨折等の傷病者は、非常用電源とベッドがある「1F 保健室」または「救急搬送」への優先割当が必要です。`,
      });
    }
  }

  // 4. 乳幼児・妊婦・プライバシー配慮チェック
  const nurseryCards = placements.filter((p) => {
    const t = JSON.stringify(p.card.data || {});
    return /乳幼児|授乳|おむつ|妊婦|LGBTQ/.test(t);
  });
  if (nurseryCards.length > 0) {
    totalPoints += 15;
    earnedPoints += 15;
    checks.push({
      good: true,
      title: "🍼 乳幼児・妊婦・個別プライバシーへの配慮",
      detail: `授乳・おむつ替え・夜泣きや性的マイノリティ等の個別事情に応じた部屋割り・相談室活用を意識できました。`,
    });
  }

  // 5. 第五小学校のイベントカード対応メモ・振り返り記録チェック
  const eventStepsForEval = gameState.steps.filter((s) => s.isEvent);
  if (eventStepsForEval.length > 0) {
    totalPoints += 20;
    const memoWrittenCount = eventStepsForEval.filter((s) => {
      const k = String(s.cards?.[0]?.card_number ?? "");
      return (gameState.eventMemos?.[k]?.memo || "").trim().length > 0;
    }).length;
    if (memoWrittenCount >= eventStepsForEval.length) {
      earnedPoints += 20;
      checks.push({
        good: true,
        title: "📝 全イベントカードへの対応メモ・振り返り記録",
        detail: `全${eventStepsForEval.length}件のイベントについて対応メモを残し、五小の施設運用・現場対応を振り返り可能な状態にしました。`,
      });
    } else if (memoWrittenCount > 0) {
      earnedPoints += 15;
      checks.push({
        good: true,
        title: "📝 イベントカードへの対応メモ・振り返り記録",
        detail: `全${eventStepsForEval.length}件中${memoWrittenCount}件のイベントにメモを記録しました（下の振り返り一覧から追記・編集できます）。`,
      });
    } else {
      earnedPoints += 10;
      checks.push({
        good: false,
        title: "📝 イベントカードの対応メモを振り返り欄に記録しましょう",
        detail: `訓練中はメモ空欄で進行しました。下の「イベントカード対応メモ ＆ 振り返り一覧」から、各イベントでの判断・気付きを記録できます。`,
      });
    }
  }

  const finalScore = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 100;
  return { finalScore, checks };
}

export function renderCompletionReportView() {
  gameState.phase = "completed";
  document.body.classList.remove("is-playing");
  document.body.classList.add("is-setup");
  stopAllTimers();
  clearGameToasts();
  sfx.playFanfare();

  const main = document.getElementById("hg-main");
  if (!main) return;

  const pop = getTotalShelterPopulation();
  const { finalScore, checks } = evaluateTrainingPerformance();
  const eventSteps = gameState.steps.filter((s) => s.isEvent);

  main.innerHTML = `
    <div class="hg-report-wrap" data-testid="hg-report-view">
      <div class="hg-score-hero">
        <div style="font-size:0.85rem;color:#93c5fd;font-weight:800;">
          🎉 小平第五小学校 HUG訓練 完了レポート
        </div>
        <div class="hg-score-circle" data-testid="hg-report-score">
          <span class="hg-score-num">${finalScore}</span>
          <span class="hg-score-max">/ 100点</span>
        </div>
        <h2 style="margin:0;font-size:1.35rem;font-weight:800;">
          ${escapeHtml(gameState.deckTitle)}（対応時間: ${formatMMSS(gameState.elapsedSeconds)}）
        </h2>
        <div style="font-size:0.84rem;color:#e2e8f0;">
          館内滞在: <strong>${pop.persons}名</strong> ・ ペット: <strong>${pop.pets}匹</strong> ・ 在宅/搬送/退所: <strong>${pop.external}名</strong>
        </div>
      </div>

      <!-- イベントカード対応メモ ＆ 振り返り一覧 -->
      <section class="hg-setup-card" data-testid="hg-report-event-memos">
        <h3 class="hg-setup-section-title">📝 イベントカード対応メモ ＆ 振り返り一覧（${eventSteps.length}件）</h3>
        ${
          eventSteps.length > 0
            ? `
              <div class="hg-report-events-grid">
                ${eventSteps
                  .map((evStep) => {
                    const evCard = evStep.cards[0];
                    const d = evCard?.data || {};
                    const cardKey = String(evCard?.card_number ?? evStep.stepIdx);
                    const memoText = gameState.eventMemos?.[cardKey]?.memo || "";
                    const evInfo = analyzeEventCard(evCard);
                    return `
                      <div class="hg-report-event-card" data-testid="hg-report-event-memo-${evCard.card_number}">
                        <div class="hg-report-event-head">
                          <img
                            src="${getCardIllustrationUrl(evCard)}"
                            alt="${escapeHtml(evStep.title)}"
                            class="hg-report-event-thumb"
                            data-report-preview-card="${evCard.card_number}"
                            title="クリックしてカードを拡大表示"
                          />
                          <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;flex-wrap:wrap;">
                              <span class="hg-mark hg-mark-red">⚡ No.${evCard.card_number}</span>
                              <span class="hg-mark ${memoText.trim() ? "hg-mark-green" : "hg-mark-blue"}">
                                ${memoText.trim() ? "✅ メモ記録済み" : "✏️ 未入力（振り返り追記可）"}
                              </span>
                            </div>
                            <strong style="font-size:0.94rem;display:block;margin-top:0.2rem;color:#0f172a;">
                              ${escapeHtml(evStep.title)}
                            </strong>
                            <div style="font-size:0.78rem;color:#475569;margin-top:0.2rem;line-height:1.4;">
                              ${escapeHtml(d.content || evInfo.badgeText || "")}
                            </div>
                          </div>
                        </div>
                        ${
                          d.training_point
                            ? `<div class="hg-report-event-point">💡 <strong>振り返りの視点:</strong> ${escapeHtml(d.training_point)}</div>`
                            : ""
                        }
                        <label style="display:block;font-size:0.75rem;font-weight:800;color:#1e293b;margin-top:0.35rem;">
                          対応メモ（編集・追記できます）:
                        </label>
                        <textarea
                          class="hg-report-memo-textarea"
                          rows="2"
                          data-report-memo-card="${evCard.card_number}"
                          data-testid="hg-report-memo-${evCard.card_number}"
                          placeholder="このイベントでとった対応や気付き・話し合いたい点を記録..."
                        >${escapeHtml(memoText)}</textarea>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `<div style="font-size:0.84rem;color:#64748b;">この訓練デッキにイベントカードはありません。</div>`
        }
      </section>

      <!-- 講評・振り返りチェックリスト -->
      <section class="hg-setup-card">
        <h3 class="hg-setup-section-title">📋 避難所運営 振り返り講評ポイント</h3>
        <div class="hg-eval-list" data-testid="hg-eval-list">
          ${
            checks.length > 0
              ? checks
                  .map(
                    (c) => `
                    <div class="hg-eval-item ${c.good ? "eval-good" : "eval-warn"}">
                      <span style="font-size:1.25rem;">${c.good ? "✅" : "💡"}</span>
                      <div>
                        <strong style="font-size:0.9rem;display:block;margin-bottom:0.15rem;">${escapeHtml(c.title)}</strong>
                        <span style="font-size:0.8rem;color:var(--hg-text-sub);">${escapeHtml(c.detail)}</span>
                      </div>
                    </div>
                  `
                  )
                  .join("")
              : `<div class="hg-eval-item eval-good">✅ 訓練ステップを完了しました！</div>`
          }
        </div>
      </section>

      <!-- フロア・エリア別の最終配置一覧 -->
      <section class="hg-setup-card">
        <h3 class="hg-setup-section-title">🗺️ 小平第五小学校 エリア別 最終配置結果</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0.65rem;">
          ${Object.values(gameState.rooms)
            .map((r) => {
              const occs = getRoomOccupants(r.id);
              if (occs.length === 0 && !r.status.includes("✅") && !r.status.includes("稼働中") && !r.closed) return "";
              return `
                <div style="border:1px solid #e2e8f0;border-radius:8px;padding:0.55rem 0.7rem;background:#f8fafc;">
                  <div style="display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:0.82rem;">
                    <span>${r.icon} ${escapeHtml(r.shortName)}</span>
                    <span class="hg-mark hg-mark-blue">${occs.length}名 (${escapeHtml(r.status)})</span>
                  </div>
                  ${
                    occs.length > 0
                      ? `<div style="margin-top:0.35rem;font-size:0.75rem;color:#334155;display:flex;flex-wrap:wrap;gap:0.3rem;">
                          ${occs
                            .map(
                              (o) =>
                                `<span class="hg-occ-chip" style="display:inline-flex;align-items:center;gap:0.25rem;">
                                  <img src="${getCardIllustrationUrl(o.card)}" alt="" style="width:20px;height:20px;border-radius:4px;object-fit:contain;background:#fff;" />
                                  No.${o.card.card_number} ${escapeHtml(o.card.data?.name || "")}
                                </span>`
                            )
                            .join("")}
                        </div>`
                      : ""
                  }
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <!-- アクションボタン -->
      <div style="display:flex;gap:0.65rem;justify-content:center;flex-wrap:wrap;">
        <button type="button" class="hg-btn hg-btn-lg hg-btn-primary" id="hg-report-download-btn" data-testid="hg-report-download-btn">
          💾 訓練結果レポート(JSON)を保存
        </button>
        <button type="button" class="hg-btn hg-btn-lg hg-btn-success" id="hg-report-retry-btn" data-testid="hg-report-retry-btn">
          🔄 同じ設定でもう一度訓練する
        </button>
        <button type="button" class="hg-btn hg-btn-lg" id="hg-report-setup-btn" data-testid="hg-report-setup-btn">
          ⚙️ デッキ・ゲーム設定に戻る
        </button>
      </div>
    </div>
  `;

  document.querySelectorAll("[data-report-memo-card]").forEach((ta) => {
    ta.addEventListener("input", (e) => {
      const cno = ta.getAttribute("data-report-memo-card");
      if (!cno) return;
      if (!gameState.eventMemos) gameState.eventMemos = {};
      const evStep = eventSteps.find((s) => String(s.cards?.[0]?.card_number) === cno);
      gameState.eventMemos[cno] = {
        stepIdx: evStep?.stepIdx ?? 0,
        cardNo: Number(cno),
        title: evStep?.title || "",
        memo: e.target.value,
        updatedAt: new Date().toISOString(),
      };
    });
  });

  document.querySelectorAll("[data-report-preview-card]").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const cno = Number(thumb.getAttribute("data-report-preview-card"));
      const evStep = eventSteps.find((s) => Number(s.cards?.[0]?.card_number) === cno);
      if (evStep?.cards) openCardImagePreviewModal(evStep.cards, 0);
    });
  });

  document.getElementById("hg-report-retry-btn")?.addEventListener("click", () => {
    startGameSession();
  });
  document.getElementById("hg-report-setup-btn")?.addEventListener("click", () => {
    renderSetupView();
  });
  document.getElementById("hg-report-download-btn")?.addEventListener("click", () => {
    const reportPayload = {
      deck_title: gameState.deckTitle,
      completed_at: new Date().toISOString(),
      elapsed_seconds: gameState.elapsedSeconds,
      score: finalScore,
      settings: gameState.settings,
      checks,
      event_memos: gameState.eventMemos || {},
      operation_logs: gameState.operationLogs,
    };
    const blob = new Blob([JSON.stringify(reportPayload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hug_training_report_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// ============================================================================
// アプリ初期化エントリポイント
// ============================================================================
async function main() {
  await loadCardDatabase();
  const decks = await fetchServerSavedDecks();

  const params = new URLSearchParams(window.location.search);
  const deckNameParam = params.get("deck");
  const deckIdParam = params.get("deck_id");
  const sourceParam = params.get("source");

  let loaded = false;
  if (deckNameParam) {
    loaded = await loadServerDeckByName(deckNameParam);
  } else if (deckIdParam) {
    loaded = await loadServerDeckById(deckIdParam);
  } else if (sourceParam === "local") {
    loaded = loadLocalWebDeck();
  }

  if (!loaded && decks.length > 0) {
    // デフォルトは「五小rev5」または「基本セット」または先頭デッキを自動選択
    const preferred =
      decks.find((d) => String(d.name).includes("五小rev5")) ||
      decks.find((d) => String(d.name).includes("五小")) ||
      decks.find((d) => String(d.name) === "基本セット") ||
      decks[0];
    if (preferred) {
      loaded = await loadServerDeckById(preferred.id);
    }
  }

  if (!loaded && gameState.db) {
    // 万一保存デッキが0件の環境（テスト用初期DB等）でもDB全カードから初期デッキを構築して動作可能にする
    const built = buildInitialDeck(gameState.db, {}, { phaseFirst: false });
    gameState.fullDeckCards = built.cardEntries || [];
    gameState.deckTitle = "標準訓練デッキ";
    gameState.deckSourceInfo = `データベースより自動構築 (${gameState.fullDeckCards.length}枚)`;
  }

  renderSetupView();

  if (params.get("autostart") === "1" && gameState.fullDeckCards.length > 0) {
    startGameSession();
  }
}

main().catch((err) => {
  console.error("HUGゲーム初期化エラー:", err);
});
