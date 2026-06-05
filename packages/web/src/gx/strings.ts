/**
 * 新UI（GaiXer 医療版）の表示文言を集約する定数ファイル。
 *
 * 決定 D3（判断メモ_Phase1着工ブロッカー.md）に基づき、新UIは日本語固定とする。
 * i18n（t()）は使わず、文言はJSXに直書きせず本ファイルへ集約する。将来多言語化が
 * 必要になった場合は、本ファイルを翻訳キー定義へ機械的に変換できる形を保つこと。
 */
export const GX = {
  brand: {
    name: 'GaiXer',
    tag: '医療版',
  },
  sidebar: {
    newWork: '新しい作業',
    sectionFeatures: '機能',
    sectionHistory: '会話履歴',
    searchPlaceholder: '会話・議事録・実行を検索',
    admin: '管理者設定',
    adminBadge: '管理者',
    adminTitle: '管理者ロールのみ表示',
    settingsTitle: '設定',
    autoBadge: '自動',
    emptyHistory: '会話履歴はまだありません',
  },
  nav: {
    agents: 'AIエージェント',
    minutes: '議事録生成',
    scheduler: 'スケジューラー',
  },
  dateGroups: {
    today: '今日',
    yesterday: '昨日',
    last7: '過去7日間',
    older: 'それ以前',
  },
  pages: {
    home: 'トップ',
    chat: 'チャット',
    agents: 'AIエージェント一覧',
    minutes: '議事録ワークベンチ',
    scheduler: 'スケジューラー運用コンソール',
    admin: '管理コンソール',
    settings: '設定',
  },
  placeholder: {
    note: 'この画面はPhase 1以降で実装予定です（Phase 0: シェルのみ）',
  },
  chat: {
    crumbRoot: '会話',
    newTitle: '新しい会話',
    modelLabel: 'GaiXer Medical',
    filesButton: 'ファイル',
    emptyTitle: '何をお手伝いしましょうか',
    emptySub: '相談したいことを入力してください。資料の添付もできます。',
    loadingMessages: '会話を読み込んでいます…',
  },
  message: {
    you: 'あなた',
    aiName: 'GaiXer Medical',
    copy: 'コピー',
    retry: '再生成',
  },
  composer: {
    placeholderInline: 'メッセージを入力…（Shift + Enter で改行）',
    placeholderHero: '相談したいことを入力してください…',
    attach: 'ファイルを添付',
    send: '送信',
    stop: '生成を停止',
    startGenerate: '生成をはじめる',
    // D2：ファイルパネル本体は Phase 1 では出さない。参照ファイルトレイはパネル着工時に有効化する。
  },
  agents: {
    // ヒーロー（GxPageHero）
    eyebrow: 'AI エージェント · ライブラリ',
    // 見出しは GxAgentsPage 側でグラデ強調を組み込むため、語片で持つ
    titleLead: 'どんなことを',
    titleEmphasis: '任せたい',
    titleTrail: 'ですか？',
    sub: 'やりたいことを入力すると、当院で使えるエージェントから合うものを絞り込みます。',
    // 検索
    searchPlaceholder:
      '例: 退院時の塩分制限の指導文を作るのに使えるエージェントは？',
    examplesLabel: '例:',
    examples: ['退院サマリ', '感染対策の通知文', '診療報酬の確認', '外来FAQ'],
    // 一覧セクション
    sectionTitle: 'すべてのエージェント',
    countSuffix: '件',
    // バッジ（GxOriginBadge）
    badgeSystem: '公式',
    badgeUser: '院内',
    // 状態
    loading: 'エージェントを読み込んでいます…',
    empty: '該当するエージェントが見つかりませんでした。',
    emptyHint: '別のキーワードで試してみてください。',
    // フッタ
    footer:
      '入力内容は一覧の絞り込みにのみ使用され、医療記録には保存されません。',
  },
} as const;
