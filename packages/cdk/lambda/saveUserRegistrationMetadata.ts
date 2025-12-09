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

  const metadata: UserRegistrationMetadata = {
    userId,
    registeredAt,
    clientMetadata: clientMetadata || undefined,
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
      })
    );

    console.log(
      `saveUserRegistrationMetadata - Successfully saved metadata for user ${userId}`
    );
    return true;
  } catch (error) {
    console.error(
      `saveUserRegistrationMetadata - Failed to save metadata for user ${userId}:`,
      error
    );
    return false;
  }
}
