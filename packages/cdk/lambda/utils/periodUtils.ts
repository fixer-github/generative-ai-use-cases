/**
 * 期間計算ユーティリティ
 *
 * 利用回数制限の期間計算に使用される共通関数を提供します。
 * - daily: 日本時間の日次開始時刻
 * - monthly: 日本時間の月初開始時刻（廃止予定、後方互換性のため残す）
 * - billing_period: 請求期間ベースの開始時刻
 */

/**
 * 期間タイプの定義
 * - daily: 日本時間0時でリセット
 * - monthly: 毎月1日日本時間0時でリセット（廃止予定、後方互換性のため残す）
 * - billing_period: 請求期間ベースでリセット（periodStartを直接使用）
 */
export type PeriodType = 'daily' | 'monthly' | 'billing_period';

/**
 * 制限タイプの定義
 * - unlimited: 無制限
 * - daily: 日次制限
 * - monthly: 月次制限（廃止予定、後方互換性のため残す）
 * - billing_period: 請求期間ベースの制限
 */
export type LimitType = 'unlimited' | 'daily' | 'monthly' | 'billing_period';

/**
 * 日本時間のオフセット（ミリ秒）
 */
const JST_OFFSET = 9 * 60 * 60 * 1000; // 9時間

/**
 * 期間の開始時刻を計算する（日本時間基準）
 *
 * @param periodType 期間タイプ（'daily' | 'monthly'）
 * @returns 期間開始時刻（Unixタイムスタンプ、ミリ秒単位）
 *
 * 注意: 'billing_period'はこの関数では処理しません。
 * billing_periodの場合はPermissionGrantのperiodStartを直接使用してください。
 */
export function getPeriodStartTime(periodType: 'daily' | 'monthly'): number {
  const now = new Date();

  // 現在時刻をJSTに変換
  const nowJST = new Date(now.getTime() + JST_OFFSET);

  let startTimeJST: Date;

  if (periodType === 'daily') {
    // 今日の午前0時（JST）
    startTimeJST = new Date(nowJST);
    startTimeJST.setUTCHours(0, 0, 0, 0);
  } else {
    // 今月1日の午前0時（JST）
    startTimeJST = new Date(nowJST);
    startTimeJST.setUTCDate(1);
    startTimeJST.setUTCHours(0, 0, 0, 0);
  }

  // JSTからUTCに戻してミリ秒単位で返す
  const startTimeUTC = new Date(startTimeJST.getTime() - JST_OFFSET);
  return startTimeUTC.getTime();
}

/**
 * 請求期間の開始時刻を取得する
 *
 * billing_periodタイプの場合、PermissionGrantに保存されているperiodStartを使用します。
 * periodStartはUnixタイムスタンプ（秒単位）で保存されているため、ミリ秒に変換して返します。
 *
 * @param periodStartSeconds 期間開始時刻（Unixタイムスタンプ、秒単位）
 * @returns 期間開始時刻（Unixタイムスタンプ、ミリ秒単位）
 * @throws periodStartSecondsがundefinedまたはnullの場合はエラー
 */
export function getBillingPeriodStartTime(
  periodStartSeconds: number | undefined | null
): number {
  if (periodStartSeconds === undefined || periodStartSeconds === null) {
    throw new Error(
      'billing_period type requires periodStart to be set on PermissionGrant. ' +
        'This is a data integrity error - periodStart should have been set when the permission was granted.'
    );
  }

  // 秒単位からミリ秒単位に変換
  return periodStartSeconds * 1000;
}

/**
 * 指定した期間タイプに応じて開始時刻を取得する統合関数
 *
 * @param limitType 制限タイプ
 * @param periodStartSeconds billing_periodの場合に必要なperiodStart（秒単位）
 * @returns 期間開始時刻（Unixタイムスタンプ、ミリ秒単位）
 */
export function getPeriodStartTimeForLimitType(
  limitType: LimitType,
  periodStartSeconds?: number | null
): number {
  switch (limitType) {
    case 'unlimited':
      // unlimitedの場合は開始時刻は意味がないが、0を返す
      return 0;
    case 'daily':
      return getPeriodStartTime('daily');
    case 'monthly':
      return getPeriodStartTime('monthly');
    case 'billing_period':
      return getBillingPeriodStartTime(periodStartSeconds);
    default:
      // 未知のlimitTypeの場合はエラー
      throw new Error(`Unknown limitType: ${limitType}`);
  }
}
