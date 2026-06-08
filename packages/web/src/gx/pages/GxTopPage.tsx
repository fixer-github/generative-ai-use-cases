/**
 * GxTopPage — 新UIのトップ（Bento ランチャー＋エージェント自動提案 / Phase 1）。
 *
 * 着工方針：`Phase1_トップページ_着工方針メモ.md`。
 *
 * スコープ：
 *   - step 1（ランチャー）：hero＋統合コンポーザ（GxComposer hero 再利用）＋クイック
 *     ＋シーン Bento（テキスト系14・feature=patient-explain は 2×2）＋カテゴリ pill。
 *     押下で `GxChatStartContext.content`（D5）を積んで `/g/chat` へ。
 *   - step 2-3（提案）：入力を止める（1.5s デバウンス）と判定エンドポイント
 *     `/predict/agent-suggest`（defaultModel）を呼び、合うエージェントを最大3件表示。
 *     提案カードは `target`（agentcore/chat）を積んで `/g/chat` へ（メモ §2・§7）。
 *
 * 仕分け（移植規約 1.3）：
 *   - (a) 新規UI型：hero / Bento / クイック / pill / 提案エリア（プロト OptionB.jsx）
 *   - (b) 再スキン型：コンポーザは共有 GxComposer、提案カードは GxAgentIdentity を再利用。
 *     エージェント一覧は useAgentBuilderList を流用（公式＋ユーザ作成の正規化は既存）。
 *
 * 縮退（メモ §4.3 / ユーザー指示）：利用統計タイル・頻度ソートは出さない。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentConfiguration, FileLimit } from 'generative-ai-use-cases';
import useAgentBuilderList from '../../hooks/agentBuilder/useAgentBuilderList';
import useChatApi from '../../hooks/useChatApi';
import { AcceptedDotExtensions } from '../../utils/MediaUtils';
import GxComposer from '../components/GxComposer';
import GxAgentIdentity from '../components/GxAgentIdentity';
import {
  IcArrowRight,
  IcClock,
  IcClose,
  IcSpark,
  ScPatientExplain,
  ScDischarge,
  ScResultExplain,
  ScHandover,
  ScCommittee,
  ScGuideline,
  ScPaperSummary,
  ScTranslate,
  ScNotice,
  ScManual,
  ScForm,
  ScTraining,
  ScStudy,
  ScFAQ,
} from '../components/icons';
import { GX } from '../strings';
import { GxChatStartContext, GxAgentTarget } from '../types';
import { toTarget } from '../agentTarget';
import '../styles/components.css';
import '../styles/top.css';

const CHAT_PATH = '/g/chat';
const FEATURE_ID = 'patient-explain';
// 添付の制約（チャットと同じ）。トップで添付したファイルは fileScope=CHAT_PATH の
// useFiles ストアへ入り、遷移先の新規チャット（/g/chat）がそのまま読み出す。
const TOP_FILE_LIMIT: FileLimit = {
  accept: AcceptedDotExtensions,
  maxFileCount: 5,
  maxFileSizeMB: 4.5,
  maxImageFileCount: 20,
  maxImageFileSizeMB: 3.75,
  maxVideoFileCount: 1,
  maxVideoFileSizeMB: 1000,
};
const TOP_ACCEPT: string[] = [
  ...AcceptedDotExtensions.doc,
  ...AcceptedDotExtensions.image,
];
// 提案エリアの状態機械（プロト OptionB.jsx：idle→debouncing→loading→ready）。
const DEBOUNCE_MS = 1500;

type IconComp = React.ComponentType<{ size?: number }>;

// シーン id → アイコン（構造データ。Japanese は strings.ts 側に集約）。
const SCENE_ICON: Record<string, IconComp> = {
  'patient-explain': ScPatientExplain,
  discharge: ScDischarge,
  'result-explain': ScResultExplain,
  handover: ScHandover,
  committee: ScCommittee,
  guideline: ScGuideline,
  paper: ScPaperSummary,
  translate: ScTranslate,
  notice: ScNotice,
  manual: ScManual,
  form: ScForm,
  training: ScTraining,
  study: ScStudy,
  faq: ScFAQ,
};

// クイックボタンの icon 名（strings.ts の文字列）→ コンポーネント。
const QUICK_ICON: Record<string, IconComp> = {
  ScDischarge,
  ScResultExplain,
  ScPaperSummary,
  ScNotice,
  ScForm,
};

// カテゴリの表示順と dot 色（プロト CATEGORIES の生 hex は対応トークンへ寄せる）。
type CatId = keyof typeof GX.top.categories;
const CAT_ORDER: CatId[] = [
  'patient',
  'meeting',
  'clinical',
  'admin',
  'learning',
  'visualize',
];
const CAT_COLOR: Record<CatId, string> = {
  patient: 'var(--indigo-500)',
  meeting: 'var(--teal-500)',
  clinical: 'var(--purple-500)',
  admin: 'var(--navy-600)',
  learning: 'var(--success-500)',
  visualize: 'var(--warning-500)',
};

// 'all' のとき feature を 2×2 に置いた後の残りタイルに付ける span パターン
// （プロト OptionB.jsx layoutPattern を踏襲：要所を wide に）。
const WIDE_AT = new Set([2, 6]);

type Scene = (typeof GX.top.scenes)[number];
type SgStatus = 'idle' | 'debouncing' | 'loading' | 'ready';
type Suggestion = { agent: AgentConfiguration; reason: string };

const GxTopPage: React.FC = () => {
  const navigate = useNavigate();
  const { suggestAgents } = useChatApi();
  const { externalAgents, publicAgents, myAgents } = useAgentBuilderList();

  const [filter, setFilter] = useState<'all' | CatId>('all');
  const [content, setContent] = useState('');
  const [sgStatus, setSgStatus] = useState<SgStatus>('idle');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const scenes = GX.top.scenes;

  // 提案用のエージェントカタログ（公式＋ユーザ作成を agentId で重複排除）。
  // エージェント一覧と同じ供給源（useAgentBuilderList）。
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

  const byId = useMemo(() => {
    const m = new Map<string, AgentConfiguration>();
    for (const a of catalog) m.set(a.agentId, a);
    return m;
  }, [catalog]);

  // 判定エンドポイントへ渡す軽量ペイロード（id/name/description のみ）。
  const payload = useMemo(
    () =>
      catalog.map((a) => ({
        id: a.agentId,
        name: a.name,
        description: a.description ?? '',
      })),
    [catalog]
  );

  // カタログの「値として安定なシグネチャ」。useAgentBuilderList は返り値を
  // memoize しないため catalog/payload/byId は毎レンダー新しい参照になる。
  // それらを effect 依存に入れると、再レンダーのたびに状態機械が再起動して
  // debounce→loading→（再レンダーでキャンセル）→debounce の無限ループに陥る。
  // 文字列（中身が変わらない限り Object.is で不変）を依存に使ってループを断つ。
  const agentsKey = useMemo(
    () => catalog.map((a) => a.agentId).join('|'),
    [catalog]
  );

  // payload/byId は毎レンダー新参照になるため、effect 依存には入れず ref で
  // 最新を読む（タイマー発火時点の最新カタログを使う）。
  const payloadRef = useRef(payload);
  const byIdRef = useRef(byId);
  const suggestAgentsRef = useRef(suggestAgents);
  payloadRef.current = payload;
  byIdRef.current = byId;
  suggestAgentsRef.current = suggestAgents;

  // 状態機械：入力を止めて 1.5s 経つと判定エンドポイントを1回呼ぶ。
  // 入力が続く間はタイマーをリセット、空入力で即 idle（プロト踏襲・メモ §2.5）。
  // 依存は content と agentsKey（値安定）のみ。再レンダーでは再起動しない。
  useEffect(() => {
    const q = content.trim();
    if (!q || payloadRef.current.length === 0) {
      setSgStatus('idle');
      setSuggestions([]);
      return;
    }
    setSgStatus('debouncing');
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setSgStatus('loading');
      suggestAgentsRef
        .current({ query: q, agents: payloadRef.current })
        .then((res) => {
          if (cancelled) return;
          const joined = res.matches
            .map((m) => {
              const agent = byIdRef.current.get(m.id);
              return agent ? { agent, reason: m.reason } : null;
            })
            .filter((x): x is Suggestion => x !== null);
          setSuggestions(joined);
          setSgStatus('ready');
        })
        .catch(() => {
          // 失敗時は提案なし（空）。送信は素のチャットへ倒す。
          if (cancelled) return;
          setSuggestions([]);
          setSgStatus('ready');
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, agentsKey]);

  // チャットへ開始コンテキストを積んで遷移（D5・統一メモ §3）。target 省略＝素のチャット。
  const start = useCallback(
    (c: string, target?: GxAgentTarget) => {
      const startContext: GxChatStartContext = {
        content: c,
        ...(target ? { target } : {}),
      };
      navigate(CHAT_PATH, { state: startContext });
    },
    [navigate]
  );

  const isAll = filter === 'all';
  const feature = useMemo(
    () => scenes.find((s) => s.id === FEATURE_ID),
    [scenes]
  );
  const FeatureIcon = feature ? SCENE_ICON[feature.id] : undefined;

  // 表示タイル：'all' は feature を別枠で出し残りを Bento に。カテゴリ選択時は
  // そのカテゴリのシーンを均一タイルで（feature は patient 専用のため特別扱いしない）。
  const tiles: Scene[] = useMemo(() => {
    if (isAll) return scenes.filter((s) => s.id !== FEATURE_ID);
    return scenes.filter((s) => s.cat === filter);
  }, [scenes, isAll, filter]);

  const count = isAll ? scenes.length : tiles.length;

  const heroTitle = (
    <>
      {GX.top.titleLead}
      <span className="gx-grad">{GX.top.titleEmphasis}</span>
      {GX.top.titleTrail}
    </>
  );

  const renderTile = (s: Scene, span: '' | 'wide') => {
    const Icon = SCENE_ICON[s.id];
    if (span === 'wide') {
      return (
        <button
          key={s.id}
          type="button"
          className="gx-top-tile wide"
          onClick={() => start(s.content)}>
          <div className="row">
            <div className="icon">{Icon && <Icon size={26} />}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="title" style={{ marginBottom: 4 }}>
                {s.title}
              </div>
              <div className="one">{s.one}</div>
            </div>
            <span className="corner-time">
              <IcClock size={10} /> {s.time}
            </span>
          </div>
        </button>
      );
    }
    return (
      <button
        key={s.id}
        type="button"
        className="gx-top-tile"
        onClick={() => start(s.content)}>
        <div className="head">
          <div className="icon">{Icon && <Icon size={22} />}</div>
          <span className="corner-time">{s.time}</span>
        </div>
        <div className="body">
          <div className="title">{s.title}</div>
          <div className="one">{s.one}</div>
        </div>
      </button>
    );
  };

  const renderSuggestionCard = ({ agent, reason }: Suggestion) => {
    const origin = agent.createdBy === 'System' ? 'system' : 'user';
    const tags = (agent.tags || []).filter((t) => t !== 'AgentCore').slice(0, 2);
    return (
      <button
        key={agent.agentId}
        type="button"
        className={'gx-top-sg-card ' + (origin === 'system' ? 'is-system' : 'is-user')}
        onClick={() => start(content, toTarget(agent))}>
        <GxAgentIdentity
          name={agent.name}
          creator={agent.createdBy}
          origin={origin}
          iconSize={38}
        />
        <div className="gx-top-sg-reason">
          <span className="dot" />
          <span>{reason}</span>
        </div>
        <div className="gx-top-sg-foot">
          <div className="gx-top-sg-tags">
            {tags.map((t) => (
              <span key={t} className="gx-top-sg-tag">
                {t}
              </span>
            ))}
          </div>
          <span className="gx-top-sg-send">
            {GX.top.suggest.send} <IcArrowRight size={12} />
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="gx-top">
      <div className="gx-top-hero">
        <div className="gx-top-eyebrow">
          <span className="badge">{GX.top.eyebrowBadge}</span>
          <span>{GX.top.eyebrowText}</span>
        </div>
        <h1 className="gx-top-title">{heroTitle}</h1>
        <p className="gx-top-sub">{GX.top.sub}</p>

        <GxComposer
          variant="hero"
          content={content}
          onChangeContent={setContent}
          onSend={() => start(content)}
          placeholder={GX.top.composerPlaceholder}
          mic
          fileUpload
          accept={TOP_ACCEPT}
          fileLimit={TOP_FILE_LIMIT}
          fileScope={CHAT_PATH}
        />

        {/* クイックは idle のときだけ（入力が始まれば提案エリアへ譲る・プロト踏襲） */}
        {sgStatus === 'idle' && (
          <div className="gx-top-quicks">
            <span className="label">{GX.top.quickLabel}</span>
            {GX.top.quicks.map((q) => {
              const QI = QUICK_ICON[q.icon];
              return (
                <button
                  key={q.label}
                  type="button"
                  className="gx-top-quick"
                  onClick={() => start(q.content)}>
                  {QI && <QI size={14} />} {q.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== エージェント自動提案エリア（loading / ready / empty） ===== */}
      {sgStatus === 'loading' && (
        <div className="gx-top-sg is-loading">
          <div className="gx-top-sg-head">
            <div className="gx-top-sg-title">
              <span className="spark">
                <IcSpark size={12} />
              </span>
              {GX.top.suggest.loading}
              <span className="gx-top-sg-dots">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
          <div className="gx-top-sg-cards">
            {[0, 1, 2].map((i) => (
              <div key={i} className="gx-top-sg-card is-skeleton" aria-hidden>
                <div className="gx-top-sg-skel-head">
                  <span className="gx-top-skelbar skel-icon" />
                  <div className="gx-top-sg-skel-id">
                    <span className="gx-top-skelbar skel-name" />
                    <span className="gx-top-skelbar skel-creator" />
                  </div>
                </div>
                <span className="gx-top-skelbar skel-reason" />
                <div className="gx-top-sg-foot">
                  <span className="gx-top-skelbar skel-tag" />
                  <span className="gx-top-skelbar skel-btn" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sgStatus === 'ready' && suggestions.length > 0 && (
        <div className="gx-top-sg">
          <div className="gx-top-sg-head">
            <div className="gx-top-sg-title">
              <span className="spark">
                <IcSpark size={12} />
              </span>
              {GX.top.suggest.readyTitle}
              <em>
                {GX.top.suggest.countLead}
                {suggestions.length}
                {GX.top.suggest.countTail}
              </em>
            </div>
            <button
              type="button"
              className="gx-top-sg-skip"
              onClick={() => start(content)}>
              {GX.top.suggest.skip} <IcClose size={12} />
            </button>
          </div>
          <div className="gx-top-sg-cards">
            {suggestions.map(renderSuggestionCard)}
          </div>
        </div>
      )}

      {sgStatus === 'ready' && suggestions.length === 0 && (
        <div className="gx-top-sg-empty">
          <span className="dot" />
          <span>
            {GX.top.suggest.emptyLead}
            <b>{GX.top.suggest.emptyBold}</b>
            {GX.top.suggest.emptyTail}
          </span>
        </div>
      )}

      <div className="gx-top-filter">
        <div className="gx-top-filter-pills">
          <button
            type="button"
            className={'gx-top-pill' + (isAll ? ' active' : '')}
            onClick={() => setFilter('all')}>
            {GX.top.filterAll}
          </button>
          {CAT_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              className={'gx-top-pill' + (filter === c ? ' active' : '')}
              onClick={() => setFilter(c)}>
              <span
                className="dot"
                style={{ background: filter === c ? '#fff' : CAT_COLOR[c] }}
              />
              {GX.top.categories[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="gx-top-section-title">
        <h2>{GX.top.sectionTitle}</h2>
        <span className="meta">
          {count}
          {GX.top.countSuffix}
        </span>
      </div>

      <div className="gx-top-bento">
        {isAll && feature && (
          <button
            type="button"
            className="gx-top-tile feature"
            onClick={() => start(feature.content)}>
            <div className="head-row">
              <div className="icon">{FeatureIcon && <FeatureIcon size={30} />}</div>
              <span className="badge">{GX.top.featureBadge}</span>
            </div>
            <div className="body" style={{ marginTop: 16, gap: 8 }}>
              <div className="title">{feature.title}</div>
              <div className="one">{feature.detail}</div>
              <div className="open">
                {GX.top.featureCta} <IcArrowRight size={14} />
              </div>
            </div>
          </button>
        )}

        {tiles.map((s, i) =>
          renderTile(s, isAll && WIDE_AT.has(i) ? 'wide' : '')
        )}
      </div>

      <div className="gx-top-foot">
        <span className="pulse" />
        {GX.top.footer}
      </div>
    </div>
  );
};

export default GxTopPage;
