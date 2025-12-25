/**
 * デフォルトプランをユーザーに適用するユーティリティ関数
 *
 * 新規ユーザー登録時にデフォルトプランを自動適用するために使用されます。
 * クロスアカウント呼び出しに対応しています。
 */

import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ApplyPlanToUserInput } from './billing/plan-management/applyPlanToUser';
import { getTenantCredentialsForInternalCall } from './utils/tenantCredentials';
import { getTenant } from './tenantManager';

const lambda = new LambdaClient({});

/**
 * テナント用のLambdaクライアントを取得（クロスアカウント対応）
 * @param tenantId テナントID
 * @returns LambdaClientとテナント情報
 */
async function getTenantLambdaClient(tenantId: string): Promise<{
  client: LambdaClient;
  tenant: Awaited<ReturnType<typeof getTenant>>;
  isCrossAccount: boolean;
}> {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const tenantCredentials = await getTenantCredentialsForInternalCall(tenantId);

  if (tenantCredentials) {
    // クロスアカウントの場合はテナントロールのクレデンシャルを使用
    const targetRegion = tenant.region || process.env.AWS_REGION || 'us-east-1';
    return {
      client: new LambdaClient({
        region: targetRegion,
        credentials: {
          accessKeyId: tenantCredentials.credentials.AccessKeyId!,
          secretAccessKey: tenantCredentials.credentials.SecretAccessKey!,
          sessionToken: tenantCredentials.credentials.SessionToken,
        },
      }),
      tenant,
      isCrossAccount: true,
    };
  }

  // 同一アカウントの場合はデフォルトのLambdaクライアントを使用
  return {
    client: lambda,
    tenant,
    isCrossAccount: false,
  };
}

/**
 * データアクセス層Lambda関数のARNを構築（クロスアカウント対応）
 */
function getPlanDataAccessFunctionArn(
  tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>,
  environment: string
): string {
  const functionName = `${environment}-${tenant.tenantId}-plan-data-access`;
  const region = tenant.region || process.env.AWS_REGION || 'us-east-1';
  return `arn:aws:lambda:${region}:${tenant.accountId}:function:${functionName}`;
}

/**
 * デフォルトプランをユーザーに適用する
 * @param event - Cognito Post Confirmationイベント
 * @param tenantId - ユーザーのテナントID
 * @returns 処理成功時true、失敗時false
 */
export async function applyDefaultPlanToUser(
  event: PostConfirmationTriggerEvent,
  tenantId: string
): Promise<boolean> {
  try {
    console.log(`applyDefaultPlanToUser - Starting default plan application for user ${event.userName}`);

    // 環境名を取得（Lambda関数名構築に使用）
    const environment = process.env.PLAN_DATA_ACCESS_FUNCTION_NAME?.split('-')[0];
    if (!environment) {
      console.error('applyDefaultPlanToUser - Could not determine environment from PLAN_DATA_ACCESS_FUNCTION_NAME');
      return false;
    }

    // テナント情報とクロスアカウント対応のLambdaクライアントを取得
    const { client: tenantLambdaClient, tenant, isCrossAccount } = await getTenantLambdaClient(tenantId);
    if (!tenant) {
      console.error(`applyDefaultPlanToUser - Tenant not found: ${tenantId}`);
      return false;
    }

    // 1. データアクセス層からデフォルトプランを取得（クロスアカウント対応）
    const planDataAccessArn = getPlanDataAccessFunctionArn(tenant, environment);
    console.log(`applyDefaultPlanToUser - Invoking plan-data-access: ${planDataAccessArn} (crossAccount: ${isCrossAccount})`);

    const getDefaultPlanResponse = await tenantLambdaClient.send(
      new InvokeCommand({
        FunctionName: planDataAccessArn,
        Payload: JSON.stringify({
          operation: 'getDefaultPlan',
          params: {},
          tenantId: tenantId,
        }),
      })
    );

    const defaultPlanResult = JSON.parse(new TextDecoder().decode(getDefaultPlanResponse.Payload));

    if (!defaultPlanResult.success || !defaultPlanResult.data) {
      console.warn('applyDefaultPlanToUser - No default plan configured in the system');
      // デフォルトプランが設定されていない場合は、エラーではなく正常終了とする
      // （管理者がデフォルトプランを設定するまでの期間を考慮）
      return true;
    }

    const defaultPlan = defaultPlanResult.data;
    console.log(`applyDefaultPlanToUser - Found default plan: ${defaultPlan.plan_id} (${defaultPlan.internal_name})`);

    // 2. ユーザーのemailからuserId（ユーザーの一意識別子）を取得
    // CognitoではユーザープールのusernameをuserIdとして使用
    const userId = event.userName;

    // 3. applyPlanToUser関数名を取得（コントロールプレーンアカウント内のLambda）
    const applyPlanFunctionName = process.env.APPLY_PLAN_TO_USER_FUNCTION_NAME;
    if (!applyPlanFunctionName) {
      console.warn('applyDefaultPlanToUser - APPLY_PLAN_TO_USER_FUNCTION_NAME not configured');
      return false;
    }

    // 4. デフォルトプランをユーザーに適用（同一アカウント内のLambda呼び出し）
    const applyPlanInput: ApplyPlanToUserInput = {
      userId: userId,
      planId: defaultPlan.plan_id,
      applicationSource: 'default',
      validFrom: new Date().toISOString(),
      // デフォルトプランは無期限
      validUntil: undefined,
      tenantId: tenantId,
    };

    console.log(`applyDefaultPlanToUser - Invoking apply-plan: ${applyPlanFunctionName}`);

    const applyPlanResponse = await lambda.send(
      new InvokeCommand({
        FunctionName: applyPlanFunctionName,
        Payload: JSON.stringify(applyPlanInput),
      })
    );

    const applyPlanResult = JSON.parse(new TextDecoder().decode(applyPlanResponse.Payload));

    if (applyPlanResult.code && applyPlanResult.code !== 'SUCCESS') {
      console.error('applyDefaultPlanToUser - Failed to apply default plan:', applyPlanResult);
      return false;
    }

    console.log(`applyDefaultPlanToUser - Successfully applied default plan to user ${userId}:`, {
      applicationId: applyPlanResult.applicationId,
      planId: applyPlanResult.planId,
    });

    return true;
  } catch (error) {
    console.error('applyDefaultPlanToUser - Error applying default plan:', error);
    // デフォルトプラン適用の失敗はユーザー登録を妨げないようにする
    // ログにエラーを記録して、管理者が後から手動で対応できるようにする
    return false;
  }
}