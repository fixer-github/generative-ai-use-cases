/**
 * データアクセス層Lambda関数呼び出し用クライアント
 *
 * VPC外のビジネスロジック層から、VPC内のデータアクセス層Lambda関数を呼び出すためのヘルパー
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { extractTenantId } from '../../utils/assumeRoleWithWebIdentity';
import { getTenantCredentials } from '../../utils/tenantCredentials';

/**
 * データアクセス層の種類
 */
export type DataAccessType = 'plan' | 'subscription' | 'user-plan-application';

/**
 * Lambda関数名を環境変数とテナントIDから構築
 */
function getDataAccessFunctionName(
  tenantId: string,
  dataAccessType: DataAccessType
): string {
  const env = process.env.ENVIRONMENT || 'dev';
  return `${env}-${tenantId}-${dataAccessType}-data-access`;
}

/**
 * データアクセス層Lambda関数を呼び出す共通ヘルパー
 *
 * @param event API Gateway イベント（テナントID抽出とクレデンシャル取得に使用）
 * @param dataAccessType データアクセス層の種類
 * @param operation 実行する操作名
 * @param params 操作に渡すパラメータ
 * @returns データアクセス層からの戻り値
 * @throws DataAccessError データアクセス層でエラーが発生した場合
 */
export async function invokeDataAccessFunction<TResponse>(
  event: APIGatewayProxyEvent,
  dataAccessType: DataAccessType,
  operation: string,
  params: any
): Promise<TResponse> {
  // 1. テナントIDを取得
  const tenantId = extractTenantId(event);

  // 2. テナント専用のIAMクレデンシャルを取得
  const { credentials } = await getTenantCredentials(event);

  // クレデンシャルの検証
  if (
    !credentials.AccessKeyId ||
    !credentials.SecretAccessKey ||
    !credentials.SessionToken
  ) {
    throw new DataAccessError(
      'INVALID_CREDENTIALS',
      'Failed to obtain valid tenant credentials',
      { tenantId }
    );
  }

  // 3. Lambda クライアントを作成（テナント専用クレデンシャルを使用）
  // Credentials型からAwsCredentialIdentity型に変換
  const lambdaClient = new LambdaClient({
    region: process.env.AWS_REGION || 'ap-northeast-1',
    credentials: {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      expiration: credentials.Expiration,
    },
  });

  // 4. データアクセス層Lambda関数名を決定
  const functionName = getDataAccessFunctionName(tenantId, dataAccessType);

  // 5. ペイロードを作成
  const payload = {
    operation,
    params,
    tenantId,
  };

  console.log(`Invoking data access function: ${functionName}`, {
    operation,
    tenantId,
  });

  // 6. Lambda関数を同期呼び出し
  const invokeCommand = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'RequestResponse', // 同期呼び出し
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  try {
    const response = await lambdaClient.send(invokeCommand);

    // 7. レスポンスをパース
    if (!response.Payload) {
      throw new Error('No payload returned from data access function');
    }

    const payloadString = new TextDecoder().decode(response.Payload);
    const result = JSON.parse(payloadString);

    // 8. エラーチェック
    if (!result.success) {
      const error = new DataAccessError(
        result.error?.code || 'UNKNOWN_ERROR',
        result.error?.message || 'Unknown error occurred in data access layer',
        result.error?.details
      );
      throw error;
    }

    // 9. データを返却
    return result.data as TResponse;
  } catch (error) {
    console.error('Error invoking data access function:', error);

    if (error instanceof DataAccessError) {
      throw error;
    }

    throw new DataAccessError(
      'INVOKE_ERROR',
      'Failed to invoke data access function',
      {
        functionName,
        operation,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
}

/**
 * データアクセス層のエラー
 *
 * データアクセス層で発生したエラーをビジネスロジック層で扱うためのエラークラス
 */
export class DataAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DataAccessError';
  }
}
