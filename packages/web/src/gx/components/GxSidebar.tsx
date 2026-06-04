/**
 * 新UI 共通サイドバー（案D・統合シェル）。
 * デザインバンドル project/app/Sidebar.jsx を TSX へ移植し、現行の実データに結線：
 *   - 会話履歴：useChatList（既存 Chat テーブル）を日付グループ表示（D1 / Phase 0 はチャットのみ）
 *   - 管理者リンク：useAdmin（Cognito admin 判定）でロール出し分け
 *   - アカウント：email を表示名に使用（cognito:username は UUID になりうるため）。所属は P1 未確定のため当面非表示
 *
 * Phase 0 の方針（判断メモ D1）に従い、以下はあえて出さない：
 *   - 種別フィルタ chip（議事録・実行の履歴流入は Phase 2）
 *   - 通知ベル（P4 通知基盤は Phase 2。押せて空は混乱のため非表示）
 *   - 機能ナビのアラートバッジ（集計供給源が未実装）
 *
 * 検索は「縮退（タイトル検索で開始）」としてクライアント側の部分一致で動かす。
 */
import React, { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import useChatList from '../../hooks/useChatList';
import useAdmin from '../../hooks/useAdmin';
import { Chat } from 'generative-ai-use-cases';
import { GX } from '../strings';
import { IcChat, IcAgent, IcMinutes, IcScheduler, IcAdmin, IcSearch, IcGear, IcPlus } from './icons';

type NavId = 'home' | 'agents' | 'minutes' | 'scheduler' | 'admin' | 'settings';

const NAV_TO_PATH: Record<NavId, string> = {
  home: '/g',
  agents: '/g/agents',
  minutes: '/g/minutes',
  scheduler: '/g/scheduler',
  admin: '/g/admin',
  settings: '/g/settings',
};

const NAV_ITEMS: { id: NavId; label: string; Icon: typeof IcAgent }[] = [
  { id: 'agents', label: GX.nav.agents, Icon: IcAgent },
  { id: 'minutes', label: GX.nav.minutes, Icon: IcMinutes },
  { id: 'scheduler', label: GX.nav.scheduler, Icon: IcScheduler },
];

type DateGroup = { key: string; label: string; items: Chat[] };

// 既存 Chat テーブルを日付グループ（今日 / 昨日 / 過去7日間 / それ以前）へ仕分ける。
// 注: 現行スキーマの updatedDate は常に空文字（lambda 側で更新されない）。
// 実際の時刻は createdDate（`${Date.now()}` のエポックミリ秒文字列）にしか無いため、
// Number() で数値化してからパースする（一覧の降順ソートも createdDate 基準）。
const groupByDate = (chats: Chat[]): DateGroup[] => {
  const buckets: Record<string, Chat[]> = {
    today: [],
    yesterday: [],
    last7: [],
    older: [],
  };
  for (const c of chats) {
    const ms = Number(c.createdDate);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) buckets.older.push(c);
    else if (isToday(d)) buckets.today.push(c);
    else if (isYesterday(d)) buckets.yesterday.push(c);
    else if (differenceInCalendarDays(new Date(), d) <= 7) buckets.last7.push(c);
    else buckets.older.push(c);
  }
  return [
    { key: 'today', label: GX.dateGroups.today, items: buckets.today },
    { key: 'yesterday', label: GX.dateGroups.yesterday, items: buckets.yesterday },
    { key: 'last7', label: GX.dateGroups.last7, items: buckets.last7 },
    { key: 'older', label: GX.dateGroups.older, items: buckets.older },
  ].filter((g) => g.items.length > 0);
};

// chatId は `chat#<uuid>` 形式。ルーティング用に uuid 部分を取り出す。
const toChatId = (chatId: string): string => chatId.replace(/^chat#/, '');

const GxSidebar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { chats } = useChatList();
  const { isAdmin, currentUsername, email } = useAdmin();
  const [query, setQuery] = useState('');

  // cognito:username が UUID になりうるため、人が読める email を優先（無ければユーザー名）
  const displayName = email || currentUsername;

  const activeRoute: NavId | null = useMemo(() => {
    const entry = (Object.entries(NAV_TO_PATH) as [NavId, string][])
      .filter(([, p]) => pathname === p || pathname.startsWith(p + '/'))
      .sort((a, b) => b[1].length - a[1].length)[0];
    return entry ? entry[0] : null;
  }, [pathname]);

  const groups = useMemo(() => {
    const q = query.trim();
    const filtered = q
      ? chats.filter((c) => (c.title ?? '').includes(q))
      : chats;
    return groupByDate(filtered);
  }, [chats, query]);

  const initial = (displayName || '?').charAt(0).toUpperCase();

  return (
    <aside className="sb sx" aria-label={GX.pages.home}>
      {/* ブランド */}
      <div className="sx-brand">
        <div className="sx-brand__mark" />
        <span className="sx-brand__name">{GX.brand.name}</span>
        <span className="sx-brand__tag">{GX.brand.tag}</span>
      </div>

      {/* 新しい作業 → Bento ランチャー（トップ） */}
      <button className="sx-new" onClick={() => navigate(NAV_TO_PATH.home)}>
        <IcPlus />
        {GX.sidebar.newWork}
      </button>

      {/* 機能ナビ */}
      <div className="sx-label">{GX.sidebar.sectionFeatures}</div>
      <nav className="sx-nav">
        {NAV_ITEMS.map((n) => (
          <div
            key={n.id}
            className={'sx-nav-item' + (activeRoute === n.id ? ' is-active' : '')}
            onClick={() => navigate(NAV_TO_PATH[n.id])}>
            <n.Icon size={18} />
            <span className="sx-nav-item__label">{n.label}</span>
          </div>
        ))}
      </nav>

      <div className="sx-div" />

      {/* グローバル検索（Phase 0 は読み込み済みタイトルの部分一致＝縮退） */}
      <div className="sx-search">
        <IcSearch size={13} />
        <input
          placeholder={GX.sidebar.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 会話履歴（D1：Phase 0 は既存 Chat のみ。種別 chip は非表示） */}
      <div className="sx-label">{GX.sidebar.sectionHistory}</div>
      <div className="sx-hist">
        {groups.length === 0 ? (
          <div className="sx-date">{GX.sidebar.emptyHistory}</div>
        ) : (
          groups.map((grp) => (
            <React.Fragment key={grp.key}>
              <div className="sx-date">{grp.label}</div>
              {grp.items.map((it) => (
                <div
                  className="sx-hi"
                  key={it.chatId}
                  onClick={() => navigate(`/g/chat/${toChatId(it.chatId)}`)}>
                  <span className="sx-hi__icon" style={{ color: '#2d5be9' }}>
                    <IcChat size={15} />
                  </span>
                  <span className="sx-hi__title">{it.title}</span>
                </div>
              ))}
            </React.Fragment>
          ))
        )}
      </div>

      {/* 管理者設定（管理者ロールのみ） */}
      {isAdmin && (
        <>
          <div className="sx-div" />
          <div className="sx-admin">
            <div
              className={'sx-nav-item' + (activeRoute === 'admin' ? ' is-active' : '')}
              onClick={() => navigate(NAV_TO_PATH.admin)}
              title={GX.sidebar.adminTitle}>
              <IcAdmin size={18} />
              <span className="sx-nav-item__label">{GX.sidebar.admin}</span>
              <span className="sx-badge sx-badge--soft">{GX.sidebar.adminBadge}</span>
            </div>
          </div>
        </>
      )}

      {/* アカウント（所属は P1 未確定のため当面ユーザー名＋イニシャルのみ） */}
      <div className="sx-acct">
        <div className="sx-ava">{initial}</div>
        <div className="sx-acct__meta">
          <div className="sx-acct__name">{displayName}</div>
        </div>
        <div className="sx-acct__actions">
          <button
            className="sx-iconbtn"
            title={GX.sidebar.settingsTitle}
            onClick={() => navigate(NAV_TO_PATH.settings)}>
            <IcGear size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default GxSidebar;
