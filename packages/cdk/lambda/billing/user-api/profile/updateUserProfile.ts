/**
 * Update User Profile API
 *
 * ユーザープロファイル更新用のエンドポイント。
 * 認証済みユーザーのCognitoカスタム属性（保護者メールアドレス）を更新します。
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
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const USER_POOL_ID = process.env.USER_POOL_ID || '';

/**
 * リクエストボディの型定義
 */
interface UpdateUserProfileRequest {
  parentEmail?: string; // 保護者メールアドレス（空文字/nullでクリア）
}

/**
 * レスポンスボディの型定義
 */
interface UpdateUserProfileResponse {
  success: boolean;
  parentEmail: string | null;
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
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Update User Profile request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const userId = getUserIdFromCognitoEvent(event);
    const tenantId = getTenantId(event);

    if (!userId || !tenantId) {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
      });
    }

    console.log('Request context:', { userId, tenantId });

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
    if (requestBody.parentEmail === undefined) {
      return badRequest400Response({
        message: '更新する項目が指定されていません',
        code: 'NO_UPDATE_FIELDS',
      });
    }

    // 4. バリデーションと更新準備
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

    // 5. Cognito属性を更新
    console.log('Updating Cognito attributes:', {
      userId,
      attributeNames: attributesToUpdate.map((a) => a.Name),
    });

    await updateCognitoAttributes(userId, attributesToUpdate);

    // 6. レスポンスを構築
    const response: UpdateUserProfileResponse = {
      success: true,
      parentEmail: newParentEmail,
    };

    console.log('User profile updated successfully:', {
      userId,
      parentEmail: newParentEmail ? '(set)' : '(cleared)',
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Error updating user profile:', error);

    // Cognitoエラーの詳細をログ
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
