/**
 * 新UI（/g 配下）のルート定義。
 * 旧UIのルート（/）には一切手を入れず、/g プレフィックスで併存させる。
 * 各画面の中身は Phase 1 以降で差し替える（Phase 0 はプレースホルダ）。
 */
import { RouteObject } from 'react-router-dom';
import GxPlaceholderPage from './pages/GxPlaceholderPage';
import GxChatPlaceholder from './pages/GxChatPlaceholder';
import { GX } from './strings';

export const gxRoutes: RouteObject[] = [
  { path: '/g', element: <GxPlaceholderPage title={GX.pages.home} /> },
  { path: '/g/chat', element: <GxChatPlaceholder /> },
  { path: '/g/chat/:chatId', element: <GxChatPlaceholder /> },
  { path: '/g/agents', element: <GxPlaceholderPage title={GX.pages.agents} /> },
  { path: '/g/minutes', element: <GxPlaceholderPage title={GX.pages.minutes} /> },
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
