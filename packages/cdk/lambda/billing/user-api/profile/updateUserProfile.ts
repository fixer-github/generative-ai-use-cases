/**
 * Update User Profile API
 *
 * ユーザープロファイル更新用のエンドポイント。
 * - DynamoDB（保護者同意情報）を更新
 *
 * PUT /api/user/profile
 *
 * Note: birthdateは別途専用のAPIで管理されているため、このAPIでは扱いません。
 * Note: 保護者メールアドレス(parentEmail)は支払い成功時にのみ保存されます。
 *       webhookEventFlowのhandleParentalControlActivationを参照。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getTenantId, getUserSub } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * リクエストボディの型定義
 */
interface UpdateUserProfileRequest {
  parentalConsent?: boolean; // 保護者同意フラグ
}

/**
 * レスポンスボディの型定義
 */
interface UpdateUserProfileResponse {
  success: boolean;
  parentalConsent?: ParentalConsentInfo | null;
}

/**
 * 保護者同意情報の型定義
 */
interface ParentalConsentInfo {
  agreed: boolean;
  agreedAt: string; // ISO 8601形式
}

/**
 * 保護者同意情報をDynamoDBに保存する
 */
async function saveParentalConsent(
  userId: string,
  agreed: boolean
): Promise<ParentalConsentInfo> {
  const agreedAt = new Date().toISOString();

  const consentInfo: ParentalConsentInfo = {
    agreed,
    agreedAt,
  };

  await docClient.send(
    new UpdateCommand({
      TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
      Key: { userId },
      UpdateExpression: 'SET parentalConsent = :consent',
      ExpressionAttributeValues: {
        ':consent': consentInfo,
      },
    })
  );

  return consentInfo;
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Update User Profile request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const username = getUserIdFromCognitoEvent(event);
    const tenantId = getTenantId(event);
    const userSub = getUserSub(event); // DynamoDB用のユーザーID (sub)

    if (!username || !tenantId) {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
      });
    }

    console.log('Request context:', { username, tenantId, userSub });

    // 2. リクエストボディの解析
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
      });
    }

    let requestBody: UpdateUserProfileRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    // 3. 更新する属性がない場合
    if (requestBody.parentalConsent === undefined) {
      return badRequest400Response({
        message: '更新する項目が指定されていません',
        code: 'NO_UPDATE_FIELDS',
      });
    }

    // 4. レスポンス用の変数
    const response: UpdateUserProfileResponse = {
      success: true,
    };

    // 5. 保護者同意情報の処理（DynamoDB）
    if (requestBody.parentalConsent !== undefined) {
      if (!USER_REGISTRATION_METADATA_TABLE_NAME) {
        console.error(
          'USER_REGISTRATION_METADATA_TABLE_NAME is not configured'
        );
        return internalServerError500Response({
          message: '設定エラーが発生しました',
          code: 'CONFIGURATION_ERROR',
        });
      }

      if (userSub === 'unknown') {
        console.error('User sub (userId for DynamoDB) is not available');
        return internalServerError500Response({
          message: 'ユーザー情報の取得に失敗しました',
          code: 'USER_ID_ERROR',
        });
      }

      // 同意情報を保存
      const consentInfo = await saveParentalConsent(
        userSub,
        requestBody.parentalConsent
      );
      response.parentalConsent = consentInfo;

      console.log('Parental consent saved:', {
        userSub,
        agreed: consentInfo.agreed,
        agreedAt: consentInfo.agreedAt,
      });
    }

    console.log('User profile updated successfully');
    return ok200Response(response);
  } catch (error) {
    console.error('Error updating user profile:', error);

    // エラーの詳細をログ
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
      });
    }

    return internalServerError500Response({
      message: 'プロファイルの更新に失敗しました',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
};
