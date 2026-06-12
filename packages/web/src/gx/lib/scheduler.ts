/**
 * スケジューラー画面（step 7）の表示ヘルパー。
 * 旧UI schedulerUtils.formatScheduleLabel を i18n から GX 固定文言へ移植し、
 * 日時整形・所要時間・トークン整形を共通化する。
 */
import { GX } from '../strings';
import type {
  ScheduleConfig,
  TaskStatus,
  ScheduledTaskResponse,
  ExecutionTrigger,
  TokenUsage,
} from '../../hooks/useSchedulerApi';

/** ScheduleConfig を人間可読なJPラベルへ（例「毎日 07:30」「毎週 月・水 09:00」）。 */
export const formatScheduleLabel = (s: ScheduleConfig): string => {
  const L = GX.scheduler.label;
  const time = s.time;
  if (s.type === 'daily') return `${L.daily} ${time}`;
  if (s.type === 'weekly') {
    const days = (s.daysOfWeek ?? [])
      .map((d) => L.weekdayShort[d] ?? '')
      .filter(Boolean)
      .join('・');
    return `${L.weeklyPrefix}${days} ${time}`;
  }
  if (s.type === 'monthly') {
    return `${L.monthlyPrefix}${s.dayOfMonth ?? 1}${L.monthlyDayUnit}${time}`;
  }
  return time;
};

/** status を返す（status が無い旧データは enabled から射影）。 */
export const statusOf = (
  t: Pick<ScheduledTaskResponse, 'status' | 'enabled'>
): TaskStatus => t.status ?? (t.enabled ? 'active' : 'paused');

const JST = 'Asia/Tokyo';

/** ISO → 「M/D HH:mm」（JST）。 */
export const fmtDateTime = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    timeZone: JST,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** ISO → 「YYYY/MM/DD HH:mm」（JST）。 */
export const fmtFull = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** 開始〜完了の所要時間（秒）。 */
export const fmtDuration = (started?: string, completed?: string): string => {
  if (!started || !completed) return '—';
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
};

/** 入力＋出力トークンの合計を桁区切りで。 */
export const fmtTokens = (t?: TokenUsage): string =>
  t ? (t.inputTokens + t.outputTokens).toLocaleString() : '—';

/** 実行のタイムラインラベル（トリガー＋試行番号）。 */
export const triggerLabel = (
  trigger?: ExecutionTrigger,
  attempt?: number
): string => {
  if (trigger === 'manual') return GX.scheduler.exec.triggerManual;
  if (trigger === 'retry') {
    const n = attempt && attempt > 1 ? attempt - 1 : 1;
    return `${GX.scheduler.exec.triggerRetry} ${n}/3`;
  }
  // 'schedule' または旧データ（trigger 無し）
  return GX.scheduler.exec.triggerSchedule;
};
