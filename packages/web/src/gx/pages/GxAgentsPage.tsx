/**
 * GxAgentsPage — 新UIのエージェント一覧（Phase 1）。
 *
 * 着工方針：`Phase1_エージェント一覧_着工方針メモ.md`／実行経路は
 * `Phase1_チャットシェル実行経路統一_着工方針メモ.md`。
 *
 * 到達ゴール（メモ §7）：公式（AgentCore）とユーザ作成（AgentBuilder）を区別なく
 * 1カタログに統合し、「探す→選ぶ→チャットを始める」がデザイン忠実に動く。
 *
 * 仕分け（移植規約ドラフト 1.3）：
 *   - (a) 新規UI型：ヒーロー・検索・カードグリッド（プロト AgentList.jsx の移植）
 *   - (b) 再スキン型：一覧取得は現行 useAgentBuilderList を流用（公式＋ユーザ作成の
 *     正規化は既存）。タブ分割（external/my/public/favorites）を外し1リスト化する。
 *
 * v1スコープ（D8：フラットカタログ）：公式が現状少数のため「多数を絞り込む」装置
 *   （カテゴリ軸・お気に入り・今週のおすすめ・最近使用rail・samples・caps・usage）は
 *   v1では出さない。残すのはテキスト絞り込み（純フロント）のみ。
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentConfiguration } from 'generative-ai-use-cases';
import useAgentBuilderList from '../../hooks/agentBuilder/useAgentBuilderList';
import GxPageHero from '../components/GxPageHero';
import GxAgentIdentity from '../components/GxAgentIdentity';
import { IcSearch } from '../components/icons';
import { GX } from '../strings';
import { GxChatStartContext } from '../types';
import '../styles/components.css';
import '../styles/agents.css';

// チャット新規会話のパス（現行 GxSidebar と同じ literal を踏襲）。
const CHAT_PATH = '/g/chat';

// AgentConfiguration → 開始コンテキストの target（統一メモ §3・§4）。
// 公式（AgentCore）は ARN 実行、それ以外は素のチャット（systemPrompt 注入は後フェーズ）。
// 注: tags 'Bedrock'（MODELS.agents 由来）は ARN 実行経路を持たないため当面 chat 扱い。
//     対象スタックで MODELS.agents が空かは要確認（統一メモ §5-6）。
const toTarget = (a: AgentConfiguration): GxChatStartContext['target'] => {
  if (a.tags?.includes('AgentCore')) {
    return { kind: 'agentcore', arn: a.agentId };
  }
  return { kind: 'chat', systemPrompt: a.systemPrompt || undefined };
};

const GxAgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    externalAgents,
    publicAgents,
    myAgents,
    isLoadingMyAgents,
    isLoadingPublicAgents,
  } = useAgentBuilderList();

  const [query, setQuery] = useState('');

  // 公式＋ユーザ作成を区別なく1リストに統合（タブ分割を外す）。agentId で重複排除。
  const catalog = useMemo(() => {
    const seen = new Set<string>();
    const merged: AgentConfiguration[] = [];
    for (const a of [...externalAgents, ...publicAgents, ...myAgents]) {
      if (!a || seen.has(a.agentId)) continue;
      seen.add(a.agentId);
      merged.push(a);
    }
    return merged;
  }, [externalAgents, publicAgents, myAgents]);

  // テキスト絞り込み（名前・説明・タグ・作成者の部分一致）。純フロント（D8）。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((a) => {
      const hay = [a.name, a.description, (a.tags || []).join(' '), a.createdBy]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [catalog, query]);

  const onPick = (a: AgentConfiguration) => {
    const startContext: GxChatStartContext = { target: toTarget(a) };
    navigate(CHAT_PATH, { state: startContext });
  };

  // 外部（公式）は同期取得・即時。ユーザ作成系のみ非同期なので、カタログが空かつ
  // 読込中のときだけスケルトンを出す（押せて空にしない＝Phase 0 踏襲）。
  const showSkeleton =
    catalog.length === 0 && (isLoadingMyAgents || isLoadingPublicAgents);
  const showEmpty = !showSkeleton && filtered.length === 0;

  const heroTitle = (
    <>
      {GX.agents.titleLead}
      <span className="gx-grad">{GX.agents.titleEmphasis}</span>
      {GX.agents.titleTrail}
    </>
  );

  return (
    <div className="gx-agents">
      <GxPageHero
        eyebrow={GX.agents.eyebrow}
        title={heroTitle}
        sub={GX.agents.sub}>
        <div className="gx-agents__search">
          <div className="gx-agents__search-inner">
            <span className="gx-agents__search-icon">
              <IcSearch size={18} />
            </span>
            <input
              type="text"
              className="gx-agents__search-input"
              placeholder={GX.agents.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="gx-agents__examples">
          <span className="gx-agents__examples-label">
            {GX.agents.examplesLabel}
          </span>
          {GX.agents.examples.map((ex) => (
            <button
              key={ex}
              type="button"
              className="gx-agents__example"
              onClick={() => setQuery(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </GxPageHero>

      <div className="gx-agents__section-head">
        <h2 className="gx-agents__section-title">{GX.agents.sectionTitle}</h2>
        <span className="gx-agents__count">
          {filtered.length}
          {GX.agents.countSuffix}
        </span>
      </div>

      {showSkeleton ? (
        <div className="gx-agents__grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="gx-agents__card is-skeleton" aria-hidden>
              <div className="gx-agents__skel-head" />
              <div className="gx-agents__skel-line" />
              <div className="gx-agents__skel-line short" />
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <div className="gx-agents__empty">
          <div className="gx-agents__empty-title">{GX.agents.empty}</div>
          <div className="gx-agents__empty-hint">{GX.agents.emptyHint}</div>
        </div>
      ) : (
        <div className="gx-agents__grid">
          {filtered.map((a) => {
            const origin = a.createdBy === 'System' ? 'system' : 'user';
            return (
              <button
                key={a.agentId}
                type="button"
                className={
                  'gx-agents__card ' +
                  (origin === 'system' ? 'is-system' : 'is-user')
                }
                onClick={() => onPick(a)}>
                <GxAgentIdentity
                  name={a.name}
                  creator={a.createdBy}
                  origin={origin}
                />
                <div className="gx-agents__desc">{a.description}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="gx-agents__foot">{GX.agents.footer}</div>
    </div>
  );
};

export default GxAgentsPage;
