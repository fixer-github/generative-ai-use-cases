import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { verifyToken } from './utils/auth';
import {
  badRequest400Response,
  internalServerError500Response,
  ok200Response,
  unauthorized401Response,
} from './utils/apiResponse';

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION!,
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME!;

// リクエストの型定義
interface SetBirthdateRequest {
  birthdate: string;
}

// レスポンスの型定義
interface SetBirthdateResponse {
  message: string;
  birthdate: string;
}

/**
 * 生年月日のバリデーション
 * @param birthdate YYYY-MM-DD形式の生年月日文字列
 * @returns バリデーション結果。成功時はnull、失敗時はエラーメッセージ
 */
function validateBirthdate(birthdate: unknown): string | null {
  // 必須チェック（空値・null不可）
  if (birthdate === null || birthdate === undefined || birthdate === '') {
    return 'birthdate is required';
  }

  // 型チェック
  if (typeof birthdate !== 'string') {
    return 'birthdate must be a string';
  }

  // 形式チェック（YYYY-MM-DD）
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(birthdate)) {
    return 'birthdate must be in YYYY-MM-DD format';
  }

  // 日付をパース
  const [yearStr, monthStr, dayStr] = birthdate.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // 年の範囲チェック（1900年〜現在の年）
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) {
    return `year must be between 1900 and ${currentYear}`;
  }

  // 月の範囲チェック（1〜12）
  if (month < 1 || month > 12) {
    return 'month must be between 1 and 12';
  }

  // 日の範囲チェック（うるう年考慮）
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return `day must be between 1 and ${daysInMonth} for ${year}-${monthStr}`;
  }

  // 未来日付チェック
  const inputDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 時刻を0に設定して日付のみで比較

  if (inputDate > today) {
    return 'birthdate cannot be a future date';
  }

  return null;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // 認証チェック: Authorization headerからトークンを取得
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return unauthorized401Response({
        message: 'Authorization header is required',
      });
    }

    // 'Bearer ' プレフィックスを除去
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    // トークンを検証してユーザー情報を取得
    const claims = await verifyToken(token);
    if (!claims) {
      return unauthorized401Response({ message: 'Invalid or expired token' });
    }

    // ユーザーID（sub）を取得
    const userId = claims.sub;
    if (!userId) {
      return unauthorized401Response({
        message: 'User ID not found in token',
      });
    }

    // リクエストボディの解析
    let requestBody: SetBirthdateRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch {
      return badRequest400Response({ message: 'Invalid JSON in request body' });
    }

    // 生年月日のバリデーション
    const validationError = validateBirthdate(requestBody.birthdate);
    if (validationError) {
      return badRequest400Response({ message: validationError });
    }

    const { birthdate } = requestBody;

    // DynamoDBに生年月日を保存（既存レコードを更新、なければ新規作成）
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
          Key: { userId },
          UpdateExpression:
            'SET birthdate = :birthdate, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':birthdate': birthdate,
            ':updatedAt': new Date().toISOString(),
          },
        })
      );

      console.log(`Successfully set birthdate for user: ${userId}`);

      return ok200Response<SetBirthdateResponse>({
        message: 'Birthdate set successfully',
        birthdate,
      });
    } catch (error) {
      console.error(`Failed to set birthdate for user ${userId}:`, error);
      throw error;
    }
  } catch (error) {
    console.error('Error setting birthdate:', error);
    return internalServerError500Response({
      message: 'Failed to set birthdate',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
