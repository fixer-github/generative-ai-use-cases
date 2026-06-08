/**
 * 新UI（/g 配下）のルート定義。
 * 旧UIのルート（/）には一切手を入れず、/g プレフィックスで併存させる。
 * 各画面の中身は Phase 1 以降で差し替える（Phase 0 はプレースホルダ）。
 */
import { RouteObject } from 'react-router-dom';
import GxPlaceholderPage from './pages/GxPlaceholderPage';
import GxTopPage from './pages/GxTopPage';
import GxChatPage from './pages/GxChatPage';
import GxAgentsPage from './pages/GxAgentsPage';
import GxMinutesPage from './pages/GxMinutesPage';
import GxMinutesRecordPage from './pages/GxMinutesRecordPage';
import GxMinutesFilePage from './pages/GxMinutesFilePage';
import GxMinutesWorkbenchPage from './pages/GxMinutesWorkbenchPage';
import { GX } from './strings';

export const gxRoutes: RouteObject[] = [
  { path: '/g', element: <GxTopPage /> },
  { path: '/g/chat', element: <GxChatPage /> },
  { path: '/g/chat/:chatId', element: <GxChatPage /> },
  { path: '/g/agents', element: <GxAgentsPage /> },
  // 議事録：入口「方法を選ぶ」（step 3a）／録音（3b）／ファイル（3c）／編集ワークベンチ（step 5）。
  // 静的セグメント（record/file/draft）は :meetingId より優先マッチするため衝突なし。
  { path: '/g/minutes', element: <GxMinutesPage /> },
  { path: '/g/minutes/record', element: <GxMinutesRecordPage /> },
  { path: '/g/minutes/file', element: <GxMinutesFilePage /> },
  // 入口からのドラフト（録音/ファイル完了直後・location.state で受け渡し）。
  { path: '/g/minutes/draft', element: <GxMinutesWorkbenchPage /> },
  // 既存会議の再開（サイドバー履歴・bare meetingId）。
  { path: '/g/minutes/:meetingId', element: <GxMinutesWorkbenchPage /> },
  {
    path: '/g/scheduler',
    element: <GxPlaceholderPage title={GX.pages.scheduler} />,
  },
  { path: '/g/admin', element: <GxPlaceholderPage title={GX.pages.admin} /> },
  {
    path: '/g/settings',
    element: <GxPlaceholderPage title={GX.pages.settings} />,
  },
];
