/* eslint-disable i18nhelper/no-jp-string */
/**
 * SendGrid Notification Utilities
 *
 * Sends execution result notifications via the SendGrid Mail Send API.
 *
 * Configuration is provided through two SSM parameters whose names are passed
 * as env vars:
 *   - SENDGRID_API_KEY_PARAM: SSM SecureString holding the SendGrid API key
 *   - MAIL_FROM_PARAM:        SSM String holding the authenticated sender address
 *
 * When either parameter name is unset (e.g. closed-network mode, or the feature
 * has not been configured yet), notifications are treated as disabled. The
 * recipient address is resolved per-execution from Cognito.
 */

import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { TokenUsage } from '../types';

const region = process.env.AWS_REGION!;
const userPoolId = process.env.USER_POOL_ID!;
const SENDGRID_API_KEY_PARAM = process.env.SENDGRID_API_KEY_PARAM;
const MAIL_FROM_PARAM = process.env.MAIL_FROM_PARAM;

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

// Generous body cap so a runaway agent result cannot produce a multi-MB email.
// (SendGrid's own limit is ~30MB; this is a UX/safety bound, not a hard API one.)
const MAX_BODY_SIZE = 256 * 1024;

const cognito = new CognitoIdentityProviderClient({ region });

// --- SSM value resolution (cached in module scope across warm invocations) ---

const SSM_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let ssmClient: SSMClient | undefined;
const getSsmClient = (): SSMClient => {
  if (!ssmClient) ssmClient = new SSMClient({ region });
  return ssmClient;
};

interface CachedParam {
  value: string;
  expiresAt: number;
}
const paramCache: Record<string, CachedParam> = {};

async function getSsmParameter(
  name: string,
  withDecryption: boolean
): Promise<string> {
  const now = Date.now();
  const cached = paramCache[name];
  if (cached && now < cached.expiresAt) {
    return cached.value;
  }
  const res = await getSsmClient().send(
    new GetParameterCommand({ Name: name, WithDecryption: withDecryption })
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter "${name}" is empty`);
  }
  paramCache[name] = { value, expiresAt: now + SSM_CACHE_TTL_MS };
  return value;
}

/**
 * Whether email notifications are configured. False in closed-network mode or
 * before the SendGrid parameters have been set, in which case callers should
 * skip notification and record emailSent=false.
 */
export function isNotificationConfigured(): boolean {
  return (
    !!SENDGRID_API_KEY_PARAM &&
    SENDGRID_API_KEY_PARAM.length > 0 &&
    !!MAIL_FROM_PARAM &&
    MAIL_FROM_PARAM.length > 0
  );
}

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
 * Send a plaintext email through the SendGrid Mail Send API.
 */
async function sendViaSendGrid(
  toEmail: string,
  subject: string,
  body: string
): Promise<void> {
  if (!isNotificationConfigured()) {
    throw new Error('SendGrid notification is not configured');
  }

  const [apiKey, mailFrom] = await Promise.all([
    getSsmParameter(SENDGRID_API_KEY_PARAM!, true),
    getSsmParameter(MAIL_FROM_PARAM!, false),
  ]);

  const res = await fetch(SENDGRID_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: mailFrom },
      subject: subject.substring(0, 998), // RFC 5322 subject length guard
      content: [{ type: 'text/plain', value: body }],
    }),
  });

  if (res.status >= 400) {
    const detail = await res.text().catch(() => '');
    throw new Error(`SendGrid request failed: ${res.status} ${detail}`);
  }
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

  await sendViaSendGrid(toEmail, `[GaiXer] タスク実行完了: ${taskName}`, body);
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

  await sendViaSendGrid(
    toEmail,
    `[GaiXer] タスク実行エラー: ${taskName}`,
    body
  );
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
