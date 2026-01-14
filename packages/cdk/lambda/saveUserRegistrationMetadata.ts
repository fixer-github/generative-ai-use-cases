/**
 * ユーザー登録メタデータをDynamoDBに保存する関数
 *
 * PostConfirmationトリガーから呼び出され、clientMetadataを
 * UserRegistrationMetadataテーブルに保存します。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { PostConfirmationTriggerEvent } from 'aws-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME || '';

export interface UserRegistrationMetadata {
  userId: string;
  registeredAt: string;
  birthdate?: string;
  metadata?: Record<string, string>;
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

  const userRegistrationMetadata: UserRegistrationMetadata = {
    userId,
    registeredAt,
    birthdate: birthdate || undefined,
    metadata: hasRestClientMetadata ? restClientMetadata : undefined,
  };

  try {
    console.log(
      `saveUserRegistrationMetadata - Saving metadata for user ${userId}`
    );
    // PIIをマスクしてログ出力（birthdateは個人情報のため）
    const maskedMetadata = {
      ...userRegistrationMetadata,
      birthdate: userRegistrationMetadata.birthdate ? '****-**-**' : undefined,
    };
    console.log('Metadata:', JSON.stringify(maskedMetadata, null, 2));

    await docClient.send(
      new PutCommand({
        TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
        Item: userRegistrationMetadata,
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
        `saveUserRegistrationMetadata - Metadata already exists for user ${userId}`
      );

      // birthdateがあれば、既存レコードに追加（未設定の場合のみ）
      if (birthdate) {
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
              Key: { userId },
              UpdateExpression:
                'SET birthdate = if_not_exists(birthdate, :birthdate)',
              ExpressionAttributeValues: {
                ':birthdate': birthdate,
              },
            })
          );
          console.log(
            `saveUserRegistrationMetadata - Updated birthdate for existing user ${userId}`
          );
        } catch (updateError) {
          console.error(
            `saveUserRegistrationMetadata - Failed to update birthdate for user ${userId}:`,
            updateError
          );
        }
      }
      return true;
    }

    console.error(
      `saveUserRegistrationMetadata - Failed to save metadata for user ${userId}:`,
      error
    );
    return false;
  }
}
