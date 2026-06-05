/**
 * 新UI（/g 配下）で画面間に受け渡す型の集約。
 *
 * `Phase1_チャットシェル実行経路統一_着工方針メモ.md §3` で確定した
 * 「チャットの開始コンテキスト」型。トップ（D5：シーン→チャット）と
 * エージェント一覧（D6：エージェント→チャット）の両方が同一型に乗る。
 */

/** 実行先の記述子。送信トランスポートだけが分岐する（メモ §1）。 */
export type GxAgentTarget =
  // 公式エージェント（AgentCore ランタイムを ARN 実行）。v1 の主コンテンツ。
  | { kind: 'agentcore'; arn: string }
  // ユーザ作成エージェント（systemPrompt 注入）/ 素のチャット。
  // systemPrompt 注入の実装は後フェーズ（D6）。型は先に用意しておく。
  | { kind: 'chat'; systemPrompt?: string };

/**
 * チャット画面（GxChatPage）を開くときに react-router の location.state で渡す。
 * いずれも任意：未指定なら素のチャット（target 省略＝kind:'chat'）として開く。
 */
export type GxChatStartContext = {
  /** D5：シーン選択などで流し込むコンポーザ初期値 */
  content?: string;
  /** エージェント一覧のカードクリックなどで流し込む実行先 */
  target?: GxAgentTarget;
};
