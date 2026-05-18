/* eslint-disable i18nhelper/no-jp-string */
/**
 * SNS Notification Utilities
 *
 * Manages per-user SNS topics and sends execution result notifications.
 */

import {
  SNSClient,
  CreateTopicCommand,
  SubscribeCommand,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
} from '@aws-sdk/client-sns';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { TokenUsage } from '../types';

const region = process.env.AWS_REGION!;
const userPoolId = process.env.USER_POOL_ID!;

const sns = new SNSClient({ region });
const cognito = new CognitoIdentityProviderClient({ region });

// SNS message size limit (256KB). Reserve space for subject/metadata.
const MAX_MESSAGE_SIZE = 250 * 1024;

/**
 * Ensure SNS topic exists for the user and email is subscribed.
 * Returns the topic ARN.
 *
 * CreateTopic is idempotent: if the topic already exists, it returns the existing ARN.
 */
export async function ensureUserNotificationTopic(
  userId: string
): Promise<{ topicArn: string; email: string }> {
  // Get user email from Cognito
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

  // Create or get existing topic (idempotent)
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const topicName = `gaixer-notification-${sanitizedUserId}`;
  const topicResult = await sns.send(
    new CreateTopicCommand({ Name: topicName })
  );
  const topicArn = topicResult.TopicArn!;

  // Check if email is already subscribed
  const subscriptions = await sns.send(
    new ListSubscriptionsByTopicCommand({ TopicArn: topicArn })
  );
  const isSubscribed = subscriptions.Subscriptions?.some(
    (sub: { Protocol?: string; Endpoint?: string }) =>
      sub.Protocol === 'email' && sub.Endpoint === email
  );

  if (!isSubscribed) {
    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'email',
        Endpoint: email,
      })
    );
  }

  return { topicArn, email };
}

/**
 * Send success notification
 */
export async function sendSuccessNotification(
  topicArn: string,
  taskName: string,
  resultText: string,
  executionTime: string,
  tokenUsage?: TokenUsage
): Promise<void> {
  const tokenInfo = tokenUsage
    ? `\nトークン消費: 入力 ${tokenUsage.inputTokens.toLocaleString()} / 出力 ${tokenUsage.outputTokens.toLocaleString()}`
    : '';

  let body = `タスク「${taskName}」の実行が完了しました。

■ 実行結果
${resultText}

■ 実行情報
実行日時: ${formatJstDateTime(executionTime)}${tokenInfo}

詳細はGaiXerのスケジューラ画面からご確認いただけます。`;

  // Truncate if exceeds SNS limit
  if (Buffer.byteLength(body, 'utf-8') > MAX_MESSAGE_SIZE) {
    const truncationNote =
      '\n\n[メール本文が上限を超えたため省略されました。続きはGaiXerの画面でご確認ください。]';
    // Calculate available space for resultText
    const overhead = Buffer.byteLength(body.replace(resultText, ''), 'utf-8');
    const availableBytes =
      MAX_MESSAGE_SIZE - overhead - Buffer.byteLength(truncationNote, 'utf-8');
    const truncatedResult =
      truncateUtf8(resultText, availableBytes) + truncationNote;
    body = body.replace(resultText, truncatedResult);
  }

  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: `[GaiXer] タスク実行完了: ${taskName}`.substring(0, 100),
      Message: body,
    })
  );
}

/**
 * Send error notification
 */
export async function sendErrorNotification(
  topicArn: string,
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

  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: `[GaiXer] タスク実行エラー: ${taskName}`.substring(0, 100),
      Message: body,
    })
  );
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
