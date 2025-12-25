/**
 * デフォルトプランをユーザーに適用するユーティリティ関数
 *
 * 新規ユーザー登録時にデフォルトプランを自動適用するために使用されます。
 */

import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ApplyPlanToUserInput } from './billing/plan-management/applyPlanToUser';

const lambda = new LambdaClient({});

/**
 * ワイルドカードパターンにマッチするLambda関数名を取得
 * @param pattern - Lambda関数名のパターン（例: "dev-*-plan-data-access"）
 * @param tenantId - テナントID
 * @returns マッチする関数名、見つからない場合はnull
 */
async function findLambdaFunctionName(
  pattern: string,
  tenantId: string
): Promise<string | null> {
  try {
    // ワイルドカードパターンを含む場合、テナントIDで具体的な関数名を構築
    if (pattern.includes('*')) {
      const functionName = pattern.replace('*', tenantId);
      console.log(`findLambdaFunctionName - Resolved function name: ${functionName}`);
      return functionName;
    }
    // ワイルドカードを含まない場合はそのまま返す
    return pattern;
  } catch (error) {
    console.error('findLambdaFunctionName - Error finding function:', error);
    return null;
  }
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

    // Lambda関数名パターンから実際の関数名を取得
    const planDataAccessPattern = process.env.PLAN_DATA_ACCESS_FUNCTION_NAME;
    if (!planDataAccessPattern) {
      console.error('applyDefaultPlanToUser - PLAN_DATA_ACCESS_FUNCTION_NAME not configured');
      return false; // 設定されていない場合はエラーとして報告
    }

    const planDataAccessFunctionName = await findLambdaFunctionName(
      planDataAccessPattern,
      tenantId
    );
    if (!planDataAccessFunctionName) {
      console.error('applyDefaultPlanToUser - Could not resolve plan data access function name');
      return false;
    }

    // 1. データアクセス層からデフォルトプランを取得
    const getDefaultPlanResponse = await lambda.send(
      new InvokeCommand({
        FunctionName: planDataAccessFunctionName,
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

    // 3. applyPlanToUser関数名を取得
    const applyPlanPattern = process.env.APPLY_PLAN_TO_USER_FUNCTION_NAME;
    if (!applyPlanPattern) {
      console.warn('applyDefaultPlanToUser - APPLY_PLAN_TO_USER_FUNCTION_NAME not configured');
      return false;
    }

    const applyPlanFunctionName = await findLambdaFunctionName(
      applyPlanPattern,
      tenantId
    );
    if (!applyPlanFunctionName) {
      console.error('applyDefaultPlanToUser - Could not resolve apply plan function name');
      return false;
    }

    // 4. デフォルトプランをユーザーに適用
    const applyPlanInput: ApplyPlanToUserInput = {
      userId: userId,
      planId: defaultPlan.plan_id,
      applicationSource: 'default',
      validFrom: new Date().toISOString(),
      // デフォルトプランは無期限
      validUntil: undefined,
      tenantId: tenantId,
    };

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