/* eslint-disable i18nhelper/no-jp-string */
/**
 * Scheduler Notification Utilities
 *
 * Builds scheduler-specific success/error emails and delivers them through the
 * shared SendGrid helper (../../utils/sendgrid). The recipient address is
 * resolved per-execution from Cognito.
 */

import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { TokenUsage } from '../types';
import { sendMail } from '../../utils/sendgrid';

const region = process.env.AWS_REGION!;
const userPoolId = process.env.USER_POOL_ID!;

// Generous body cap so a runaway agent result cannot produce a multi-MB email.
// (SendGrid's own limit is ~30MB; this is a UX/safety bound, not a hard API one.)
const MAX_BODY_SIZE = 256 * 1024;

const cognito = new CognitoIdentityProviderClient({ region });

/**
 * Resolve the user's email address from Cognito.
 */
export async function getUserEmail(userId: string): Promise<string> {
  const userResponse = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: userId,
    })
  );
  const email = userResponse.UserAttributes?.find(
    (a) => a.Name === 'email'
  )?.Value;
  if (!email) {
    throw new Error(`Email not found for user ${userId}`);
  }
  return email;
}

/**
 * Send success notification to the given recipient.
 */
export async function sendSuccessNotification(
  toEmail: string,
  taskName: string,
  resultText: string,
  executionTime: string,
  tokenUsage?: TokenUsage
): Promise<void> {
  const tokenInfo = tokenUsage
    ? `\nトークン消費: 入力 ${tokenUsage.inputTokens.toLocaleString()} / 出力 ${tokenUsage.outputTokens.toLocaleString()}`
    : '';

  const safeResult = capResultText(resultText);

  const body = `タスク「${taskName}」の実行が完了しました。

■ 実行結果
${safeResult}

■ 実行情報
実行日時: ${formatJstDateTime(executionTime)}${tokenInfo}

詳細はGaiXerのスケジューラ画面からご確認いただけます。`;

  await sendMail(toEmail, `[GaiXer] タスク実行完了: ${taskName}`, body);
}

/**
 * Send error notification to the given recipient.
 */
export async function sendErrorNotification(
  toEmail: string,
  taskName: string,
  errorMessage: string,
  executionTime: string
): Promise<void> {
  const body = `タスク「${taskName}」の実行中にエラーが発生しました。

■ エラー内容
${errorMessage}

■ 実行情報
実行日時: ${formatJstDateTime(executionTime)}

タスクの設定をご確認ください。`;

  await sendMail(toEmail, `[GaiXer] タスク実行エラー: ${taskName}`, body);
}

// --- Bell notification text (step 5) -------------------------------------
// The persisted bell notification (NotificationTable) is written by the
// scheduler repository; this module owns the user-facing JP copy (it already
// carries the i18nhelper disable). `body` is capped so a runaway error message
// cannot bloat the row.

const MAX_NOTIFICATION_BODY = 500;

/**
 * Copy for a task that hit a permanent error and was stopped immediately.
 */
export function buildSchedFailedNotification(
  taskName: string,
  errorMessage: string
): { title: string; body: string } {
  return {
    title: `タスク「${taskName}」の実行に失敗しました`,
    body: capNotificationBody(`エラーのため自動停止しました。${errorMessage}`),
  };
}

/**
 * Copy for a task auto-stopped after repeated transient failures (3 retries).
 */
export function buildSchedPausedNotification(taskName: string): {
  title: string;
  body: string;
} {
  return {
    title: `タスク「${taskName}」を自動停止しました`,
    body: '一時的なエラーが連続したため自動停止しました。設定を確認して再開してください。',
  };
}

function capNotificationBody(text: string): string {
  return text.length <= MAX_NOTIFICATION_BODY
    ? text
    : text.slice(0, MAX_NOTIFICATION_BODY) + '…';
}

/**
 * Cap result text to a generous byte limit, appending a notice when truncated.
 */
function capResultText(resultText: string): string {
  if (Buffer.byteLength(resultText, 'utf-8') <= MAX_BODY_SIZE) {
    return resultText;
  }
  const truncationNote =
    '\n\n[メール本文が上限を超えたため省略されました。続きはGaiXerの画面でご確認ください。]';
  const availableBytes =
    MAX_BODY_SIZE - Buffer.byteLength(truncationNote, 'utf-8');
  return truncateUtf8(resultText, availableBytes) + truncationNote;
}

/**
 * Format ISO date string to JST display string
 */
function formatJstDateTime(isoString: string): string {
  const date = new Date(isoString);
  return (
    date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' (JST)'
  );
}

/**
 * Truncate string to fit within a UTF-8 byte limit
 */
function truncateUtf8(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) return str;

  // Binary search for the right character count
  let low = 0;
  let high = str.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(str.substring(0, mid)).length <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return str.substring(0, low);
}
