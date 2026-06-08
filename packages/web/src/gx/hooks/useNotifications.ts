/**
 * 通知（P4 / B6）フック。サイドバーのベル＋未読バッジを支える。
 *
 * 永続通知は専用 NotificationTable が正で、`GET /notifications` をポーリング
 * （60s）して取得する。リアルタイム性は不要なので WebSocket/SSE は使わない
 * （PoC ではオーバースペック＝着工方針メモ §4.3）。
 *
 * 既存の揮発トースト（useAppNotificationStore）とは二層構成：トースト＝今この
 * 瞬間の操作結果／ベル＝後から見返す永続通知。本フックは後者のみを扱う。
 */
import useHttp from '../../hooks/useHttp';
import {
  ListNotificationsResponse,
  StoredNotification,
} from 'generative-ai-use-cases';

const POLL_INTERVAL_MS = 60_000;

// notificationId は `notification#<uuid>` 形式。API パスには bare uuid を渡す
// （repository が `notification#` を再付与する＝議事録/会議の規約と同じ）。
const toBareId = (notificationId: string): string =>
  notificationId.replace(/^notification#/, '');

const useNotifications = () => {
  const http = useHttp();
  const { data, mutate, isLoading } = http.get<ListNotificationsResponse>(
    '/notifications',
    { refreshInterval: POLL_INTERVAL_MS }
  );

  const notifications: StoredNotification[] = data?.data ?? [];
  const unreadCount = notifications.reduce((n, x) => (x.read ? n : n + 1), 0);

  const markRead = async (notificationId: string): Promise<void> => {
    // 楽観更新：先に未読を落としてからサーバへ。失敗時は再検証で復元される。
    if (data) {
      mutate(
        {
          ...data,
          data: data.data.map((n) =>
            n.notificationId === notificationId ? { ...n, read: true } : n
          ),
        },
        { revalidate: false }
      );
    }
    await http.post(`/notifications/${toBareId(notificationId)}/read`, {});
    mutate();
  };

  const markAllRead = async (): Promise<void> => {
    if (data) {
      mutate(
        { ...data, data: data.data.map((n) => ({ ...n, read: true })) },
        { revalidate: false }
      );
    }
    await http.post('/notifications/read-all', {});
    mutate();
  };

  return {
    notifications,
    unreadCount,
    isLoading,
    markRead,
    markAllRead,
    mutate,
  };
};

export default useNotifications;
