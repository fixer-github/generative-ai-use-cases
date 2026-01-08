/**
 * Update User Profile API
 *
 * ユーザープロファイル更新用のエンドポイント。
 * 認証済みユーザーのCognitoカスタム属性を更新します。
 *
 * PUT /api/user/profile
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getTenantId } from '../../../utils/tenantUtils';
import {
  getUserIdFromCognitoEvent,
  getUserClaimsFromCognitoEvent,
} from '../../../utils/cognitoUtils';
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
  birthdate?: string; // YYYY-MM-DD形式
  parentEmail?: string; // 保護者メールアドレス
}

/**
 * レスポンスボディの型定義
 */
interface UpdateUserProfileResponse {
  success: boolean;
  birthdate?: string | null;
  parentEmail?: string | null;
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
 * 生年月日形式チェック (YYYY-MM-DD)
 */
function isValidBirthdate(birthdate: string): boolean {
  const birthdateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!birthdateRegex.test(birthdate)) {
    return false;
  }

  // 実際に有効な日付かチェック
  const date = new Date(birthdate);
  if (isNaN(date.getTime())) {
    return false;
  }

  // 入力値と一致するか確認（不正な日付の自動補正を検出）
  const [year, month, day] = birthdate.split('-').map(Number);
  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
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
    const claims = getUserClaimsFromCognitoEvent(event);

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
    if (
      requestBody.birthdate === undefined &&
      requestBody.parentEmail === undefined
    ) {
      return badRequest400Response({
        message: '更新する項目が指定されていません',
        code: 'NO_UPDATE_FIELDS',
      });
    }

    // 4. バリデーション
    const attributesToUpdate: { Name: string; Value: string }[] = [];

    // 生年月日のバリデーションと更新準備
    if (requestBody.birthdate !== undefined) {
      if (requestBody.birthdate !== null && requestBody.birthdate !== '') {
        if (!isValidBirthdate(requestBody.birthdate)) {
          return badRequest400Response({
            message: '生年月日はYYYY-MM-DD形式で入力してください',
            code: 'INVALID_BIRTHDATE_FORMAT',
          });
        }
        attributesToUpdate.push({
          Name: 'birthdate',
          Value: requestBody.birthdate,
        });
      }
    }

    // 保護者メールアドレスのバリデーションと更新準備
    if (requestBody.parentEmail !== undefined) {
      if (requestBody.parentEmail !== null && requestBody.parentEmail !== '') {
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
      } else {
        // 空文字列またはnullの場合、属性をクリア
        attributesToUpdate.push({
          Name: 'custom:parent_email',
          Value: '',
        });
      }
    }

    // 5. Cognito属性を更新
    if (attributesToUpdate.length > 0) {
      console.log('Updating Cognito attributes:', {
        userId,
        attributeNames: attributesToUpdate.map((a) => a.Name),
      });

      await updateCognitoAttributes(userId, attributesToUpdate);
    }

    // 6. レスポンスを構築
    // 現在のclaimsから既存の値を取得し、更新後の値で上書き
    const currentBirthdate = claims?.['birthdate'] || null;
    const currentParentEmail = claims?.['custom:parent_email'] || null;

    const response: UpdateUserProfileResponse = {
      success: true,
      birthdate:
        requestBody.birthdate !== undefined
          ? requestBody.birthdate || null
          : currentBirthdate,
      parentEmail:
        requestBody.parentEmail !== undefined
          ? requestBody.parentEmail || null
          : currentParentEmail,
    };

    console.log('User profile updated successfully:', {
      userId,
      updatedFields: attributesToUpdate.map((a) => a.Name),
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
