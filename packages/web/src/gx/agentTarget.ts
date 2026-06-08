/**
 * AgentConfiguration → チャット開始コンテキストの target（統一メモ §3・§4）。
 *
 * エージェント一覧（GxAgentsPage）とトップの提案カード（GxTopPage）が共通で使う
 * 「エージェント → 実行先」の対応。公式（AgentCore）は ARN 実行、それ以外は素の
 * チャット（systemPrompt 注入は後フェーズ）。
 *
 * 注: tags 'Bedrock'（MODELS.agents 由来）は ARN 実行経路を持たないため当面 chat 扱い
 *     （統一メモ §5-6）。
 */
import { AgentConfiguration } from 'generative-ai-use-cases';
import { GxChatStartContext } from './types';

export const toTarget = (
  a: AgentConfiguration
): GxChatStartContext['target'] => {
  if (a.tags?.includes('AgentCore')) {
    return { kind: 'agentcore', arn: a.agentId };
  }
  return { kind: 'chat', systemPrompt: a.systemPrompt || undefined };
};
