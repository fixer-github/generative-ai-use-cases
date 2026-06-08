/**
 * 通知ベル（P4 / B6）。サイドバーのブランド行に置き、未読数バッジを表示する。
 * クリックで通知一覧パネル（サイドバー右隣にフロート）を開き、各行クリックで
 * その通知の link へ遷移＋既読化する。Phase 0 で「押せて空は混乱」として非表示に
 * していたベルを、実データ（NotificationTable）の流入により解禁する（着工方針メモ §4.3）。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StoredNotification, NotificationType } from 'generative-ai-use-cases';
import useNotifications from '../hooks/useNotifications';
import { GX } from '../strings';
import { IcBell, IcClose } from './icons';

// 通知種別 → ドットの見た目（成功 / 注意 / 失敗）。
const dotVariant = (type: NotificationType): 'ok' | 'warn' | 'alert' => {
  switch (type) {
    case 'minutes_ready':
      return 'ok';
    case 'sched_paused':
      return 'warn';
    case 'minutes_failed':
    case 'sched_failed':
    default:
      return 'alert';
  }
};

// createdDate（エポックミリ秒文字列）を日本語の相対時刻へ。date-fns の locale 依存を
// 避けるための軽量実装（サイドバーの groupByDate と同じく Number() でパース）。
const timeAgo = (createdDate: string): string => {
  const ms = Number(createdDate);
  if (!ms || Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(ms).toLocaleDateString('ja-JP');
};

const GxNotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = useState(false);

  const onItem = (n: StoredNotification) => {
    if (!n.read) {
      void markRead(n.notificationId);
    }
    setOpen(false);
    if (n.link) {
      navigate(n.link);
    }
  };

  return (
    <>
      <button
        className="sx-bell"
        aria-label={GX.notifications.ariaOpen}
        onClick={() => setOpen((v) => !v)}>
        <IcBell size={17} />
        {unreadCount > 0 && (
          <span className="sx-bell__badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="sx-noti-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="sx-noti"
            role="dialog"
            aria-label={GX.notifications.title}>
            <div className="sx-noti__head">
              <span className="sx-noti__title">{GX.notifications.title}</span>
              <div className="sx-noti__head-actions">
                {unreadCount > 0 && (
                  <button
                    className="sx-noti__markall"
                    onClick={() => void markAllRead()}>
                    {GX.notifications.markAllRead}
                  </button>
                )}
                <button
                  className="sx-iconbtn"
                  aria-label={GX.notifications.close}
                  onClick={() => setOpen(false)}>
                  <IcClose size={13} />
                </button>
              </div>
            </div>

            <div className="sx-noti__list">
              {notifications.length === 0 ? (
                <div className="sx-noti__empty">{GX.notifications.empty}</div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.notificationId}
                    className={'sx-noti-item' + (n.read ? '' : ' is-unread')}
                    onClick={() => onItem(n)}>
                    <span
                      className={`sx-noti-item__dot sx-noti-item__dot--${dotVariant(
                        n.type
                      )}`}
                    />
                    <span className="sx-noti-item__body">
                      <span className="sx-noti-item__title">{n.title}</span>
                      {n.body && (
                        <span className="sx-noti-item__desc">{n.body}</span>
                      )}
                      <span className="sx-noti-item__time">
                        {timeAgo(n.createdDate)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default GxNotificationBell;
