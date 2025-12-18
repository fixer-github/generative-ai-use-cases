/**
 * ユーザー登録メタデータをDynamoDBに保存する関数
 *
 * PostConfirmationトリガーから呼び出され、clientMetadataを
 * UserRegistrationMetadataテーブルに保存します。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PostConfirmationTriggerEvent } from 'aws-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME || '';

export interface UserRegistrationMetadata {
  userId: string;
  registeredAt: string;
  birthdate?: string;
  clientMetadata?: Record<string, string>;
}

/**
 * ユーザー登録メタデータを保存する
 *
 * @param event PostConfirmationTriggerEvent
 * @returns 保存成功の場合true、失敗の場合false
 */
export async function saveUserRegistrationMetadata(
  event: PostConfirmationTriggerEvent
): Promise<boolean> {
  const userId = event.request.userAttributes.sub;
  const clientMetadata = event.request.clientMetadata;

  if (!USER_REGISTRATION_METADATA_TABLE_NAME) {
    console.warn(
      'saveUserRegistrationMetadata - USER_REGISTRATION_METADATA_TABLE_NAME is not set, skipping metadata save'
    );
    return false;
  }

  if (!userId) {
    console.error('saveUserRegistrationMetadata - userId (sub) is required');
    return false;
  }

  // サーバー側で登録日時を生成（法的証跡として信頼性を確保）
  const registeredAt = new Date().toISOString();

  // clientMetadataからbirthdateを取り出してトップレベルに保存
  // setBirthdate.tsと同じデータ構造に統一
  const birthdate = clientMetadata?.birthdate;

  // clientMetadataからbirthdateを除外した残りを保存
  const { birthdate: _, ...restClientMetadata } = clientMetadata || {};
  const hasRestClientMetadata = Object.keys(restClientMetadata).length > 0;

  const metadata: UserRegistrationMetadata = {
    userId,
    registeredAt,
    birthdate: birthdate || undefined,
    clientMetadata: hasRestClientMetadata ? restClientMetadata : undefined,
  };

  try {
    console.log(
      `saveUserRegistrationMetadata - Saving metadata for user ${userId}`
    );
    console.log('Metadata:', JSON.stringify(metadata, null, 2));

    await docClient.send(
      new PutCommand({
        TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
        Item: metadata,
        ConditionExpression: 'attribute_not_exists(userId)',
      })
    );

    console.log(
      `saveUserRegistrationMetadata - Successfully saved metadata for user ${userId}`
    );
    return true;
  } catch (error) {
    // 既にメタデータが存在する場合は上書きせずに成功として扱う
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      console.log(
        `saveUserRegistrationMetadata - Metadata already exists for user ${userId}, skipping`
      );
      return true;
    }

    console.error(
      `saveUserRegistrationMetadata - Failed to save metadata for user ${userId}:`,
      error
    );
    return false;
  }
}
