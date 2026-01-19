/**
 * アシスタントのナレッジベースに関する制限値
 */
export const ASSISTANT_LIMITS = {
  /** ファイルサイズの上限（バイト） - バックエンドと同じ10MB */
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  /** ナレッジソース（ファイル + URL）の合計件数上限
   * NOTE: API Gatewayの29秒タイムアウト回避のため、暫定的に10件に制限
   */
  MAX_KNOWLEDGE_SOURCES: 10,
};
