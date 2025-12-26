/**
 * データアクセス層Lambda関数呼び出し用クライアント
 *
 * VPC外のビジネスロジック層から、VPC内のデータアクセス層Lambda関数を呼び出すためのヘルパー
 * クロスアカウント呼び出しに対応
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { extractTenantId } from '../../utils/assumeRoleWithWebIdentity';
import {
  getTenantCredentials,
  getTenantCredentialsForInternalCall,
} from '../../utils/tenantCredentials';
import { getTenant, Tenant } from '../../tenantManager';

/**
 * データアクセス層の種類
 */
export type DataAccessType = 'plan' | 'subscription' | 'user-plan-application';

/**
 * Lambda関数名をテナント情報から構築
 * クロスアカウントの場合はテナントのenvironmentを使用
 */
function getDataAccessFunctionName(
  tenant: Tenant,
  dataAccessType: DataAccessType
): string {
  // テナント固有の環境名を使用（クロスアカウント対応）
  const env = tenant.environment || process.env.ENVIRONMENT || 'dev';
  return `${env}-${tenant.tenantId}-${dataAccessType}-data-access`;
}

/**
 * クロスアカウント呼び出し用のLambda ARNを構築
 */
function getDataAccessFunctionArn(
  tenant: Tenant,
  dataAccessType: DataAccessType
): string {
  const functionName = getDataAccessFunctionName(tenant, dataAccessType);
  const region = tenant.region || process.env.AWS_REGION || 'ap-northeast-1';
  return `arn:aws:lambda:${region}:${tenant.accountId}:function:${functionName}`;
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
  params: Record<string, unknown>
): Promise<TResponse> {
  // 1. テナントIDを取得
  const tenantId = extractTenantId(event);

  // 2. テナント情報を取得
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    throw new DataAccessError(
      'TENANT_NOT_FOUND',
      `Tenant not found: ${tenantId}`,
      { tenantId }
    );
  }

  // 3. テナント専用のIAMクレデンシャルを取得
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

  // 4. Lambda クライアントを作成（テナント専用クレデンシャルを使用）
  // クロスアカウントの場合はテナントのリージョンを使用
  const targetRegion = tenant.region || process.env.AWS_REGION || 'ap-northeast-1';
  const lambdaClient = new LambdaClient({
    region: targetRegion,
    credentials: {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      expiration: credentials.Expiration,
    },
  });

  // 5. データアクセス層Lambda関数ARNを決定（クロスアカウント対応）
  const functionArn = getDataAccessFunctionArn(tenant, dataAccessType);

  // 6. ペイロードを作成
  const payload = {
    operation,
    params,
    tenantId,
  };

  console.log(`Invoking data access function: ${functionArn}`, {
    operation,
    tenantId,
    targetAccountId: tenant.accountId,
  });

  // 7. Lambda関数を同期呼び出し
  const invokeCommand = new InvokeCommand({
    FunctionName: functionArn,
    InvocationType: 'RequestResponse', // 同期呼び出し
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  try {
    const response = await lambdaClient.send(invokeCommand);

    // 8. レスポンスをパース
    if (!response.Payload) {
      throw new Error('No payload returned from data access function');
    }

    const payloadString = new TextDecoder().decode(response.Payload);
    const result = JSON.parse(payloadString);

    // 9. エラーチェック
    if (!result.success) {
      const error = new DataAccessError(
        result.error?.code || 'UNKNOWN_ERROR',
        result.error?.message || 'Unknown error occurred in data access layer',
        result.error?.details
      );
      throw error;
    }

    // 10. データを返却
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
        functionArn,
        operation,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
}

/**
 * 内部Lambda関数から、tenantIdを直接指定してデータアクセス層Lambda関数を呼び出す
 *
 * Lambda-to-Lambda呼び出しで使用します。API Gateway経由ではないため、
 * テナント専用のIAMクレデンシャルは不要で、Lambda実行ロールで呼び出します。
 * クロスアカウント呼び出しに対応しています。
 *
 * @param tenantId テナントID
 * @param dataAccessType データアクセス層の種類
 * @param operation 実行する操作名
 * @param params 操作に渡すパラメータ
 * @returns データアクセス層からの戻り値
 * @throws DataAccessError データアクセス層でエラーが発生した場合
 */
export async function invokeDataAccessFunctionByTenantId<TResponse>(
  tenantId: string,
  dataAccessType: DataAccessType,
  operation: string,
  params: Record<string, unknown>
): Promise<TResponse> {
  // 1. クロスアカウント対応のクレデンシャルを取得
  // 同一アカウントの場合はnull、クロスアカウントの場合はクレデンシャルが返る
  const tenantCredentials = await getTenantCredentialsForInternalCall(tenantId);

  // 2. テナント情報を取得（クレデンシャル取得時に既に取得済みだが、nullの場合は再取得）
  const tenant = tenantCredentials?.tenant ?? (await getTenant(tenantId));
  if (!tenant) {
    throw new DataAccessError(
      'TENANT_NOT_FOUND',
      `Tenant not found: ${tenantId}`,
      { tenantId }
    );
  }

  // 3. Lambda クライアントを作成
  const targetRegion = tenant.region || process.env.AWS_REGION || 'ap-northeast-1';
  const isCrossAccount = tenantCredentials !== null;

  let lambdaClient: LambdaClient;
  if (tenantCredentials) {
    // クロスアカウントの場合はテナントロールのクレデンシャルを使用
    lambdaClient = new LambdaClient({
      region: targetRegion,
      credentials: {
        accessKeyId: tenantCredentials.credentials.AccessKeyId!,
        secretAccessKey: tenantCredentials.credentials.SecretAccessKey!,
        sessionToken: tenantCredentials.credentials.SessionToken,
      },
    });
  } else {
    // 同一アカウントの場合はLambda実行ロールを使用
    lambdaClient = new LambdaClient({
      region: targetRegion,
    });
  }

  // 4. データアクセス層Lambda関数ARNを決定（クロスアカウント対応）
  const functionArn = getDataAccessFunctionArn(tenant, dataAccessType);

  // 5. ペイロードを作成
  const payload = {
    operation,
    params,
    tenantId,
  };

  console.log(`Invoking data access function: ${functionArn}`, {
    operation,
    tenantId,
    targetAccountId: tenant.accountId,
    isCrossAccount,
  });

  // 5. Lambda関数を同期呼び出し
  const invokeCommand = new InvokeCommand({
    FunctionName: functionArn,
    InvocationType: 'RequestResponse', // 同期呼び出し
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  try {
    const response = await lambdaClient.send(invokeCommand);

    // 6. レスポンスをパース
    if (!response.Payload) {
      throw new Error('No payload returned from data access function');
    }

    const payloadString = new TextDecoder().decode(response.Payload);
    const result = JSON.parse(payloadString);

    // 7. エラーチェック
    if (!result.success) {
      const error = new DataAccessError(
        result.error?.code || 'UNKNOWN_ERROR',
        result.error?.message || 'Unknown error occurred in data access layer',
        result.error?.details
      );
      throw error;
    }

    // 8. データを返却
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
        functionArn,
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
