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
} as const;
