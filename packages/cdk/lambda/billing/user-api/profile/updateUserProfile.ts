/**
 * Update User Profile API
 *
 * ユーザープロファイル更新用のエンドポイント。
 * - Cognitoカスタム属性（保護者メールアドレス）を更新
 * - DynamoDB（保護者同意情報）を更新
 *
 * PUT /api/user/profile
 *
 * Note: birthdateは別途専用のAPIで管理されているため、このAPIでは扱いません。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
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

const USER_POOL_ID = process.env.USER_POOL_ID || '';
const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * リクエストボディの型定義
 */
interface UpdateUserProfileRequest {
  parentEmail?: string; // 保護者メールアドレス（空文字/nullでクリア）
  parentalConsent?: boolean; // 保護者同意フラグ
}

/**
 * レスポンスボディの型定義
 */
interface UpdateUserProfileResponse {
  success: boolean;
  parentEmail?: string | null;
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
 * メールアドレス形式チェック
 */
function isValidEmail(email: string): boolean {
  // RFC 5322 準拠の簡易メールアドレス検証
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Cognitoユーザー属性を更新する
 */
async function updateCognitoAttributes(
  username: string,
  attributes: { Name: string; Value: string }[]
): Promise<void> {
  const client = new CognitoIdentityProviderClient({});

  const command = new AdminUpdateUserAttributesCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
    UserAttributes: attributes,
  });

  await client.send(command);
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
    if (
      requestBody.parentEmail === undefined &&
      requestBody.parentalConsent === undefined
    ) {
      return badRequest400Response({
        message: '更新する項目が指定されていません',
        code: 'NO_UPDATE_FIELDS',
      });
    }

    // 4. レスポンス用の変数
    const response: UpdateUserProfileResponse = {
      success: true,
    };

    // 5. 保護者メールアドレスの処理（Cognito）
    if (requestBody.parentEmail !== undefined) {
      const attributesToUpdate: { Name: string; Value: string }[] = [];
      let newParentEmail: string | null;

      // 保護者メールアドレスの処理
      // - 有効なメールアドレス: 設定
      // - 空文字/null: クリア
      if (requestBody.parentEmail && requestBody.parentEmail.trim() !== '') {
        if (!isValidEmail(requestBody.parentEmail)) {
          return badRequest400Response({
            message: 'メールアドレスの形式が正しくありません',
            code: 'INVALID_EMAIL_FORMAT',
          });
        }
        attributesToUpdate.push({
          Name: 'custom:parent_email',
          Value: requestBody.parentEmail,
        });
        newParentEmail = requestBody.parentEmail;
      } else {
        // 空文字列またはnullの場合、属性をクリア
        attributesToUpdate.push({
          Name: 'custom:parent_email',
          Value: '',
        });
        newParentEmail = null;
      }

      // Cognito属性を更新
      console.log('Updating Cognito attributes:', {
        username,
        attributeNames: attributesToUpdate.map((a) => a.Name),
      });

      await updateCognitoAttributes(username, attributesToUpdate);
      response.parentEmail = newParentEmail;

      console.log('Parent email updated:', {
        username,
        parentEmail: newParentEmail ? '(set)' : '(cleared)',
      });
    }

    // 6. 保護者同意情報の処理（DynamoDB）
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
