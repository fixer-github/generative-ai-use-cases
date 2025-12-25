/**
 * Approve Plan Change API (Public Endpoint)
 *
 * 保護者向けのプラン変更承認API。
 * メールで送信された承認リンクから呼び出され、プラン変更を実行します。
 * 認証なし（公開エンドポイント）- 保護者はログインしていないため。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  PlanChangeFlowInput,
  PlanChangeFlowOutput,
} from '../../orchestration/types/flowTypes';

const PENDING_PLAN_CHANGES_TABLE_NAME =
  process.env.PENDING_PLAN_CHANGES_TABLE_NAME || '';
const PLAN_CHANGE_FLOW_FUNCTION_NAME =
  process.env.PLAN_CHANGE_FLOW_FUNCTION_NAME || '';

/**
 * リクエストボディの型
 */
interface ApprovePlanChangeRequest {
  token: string;
}

/**
 * 保留中のプラン変更リクエスト
 */
interface PendingPlanChangeRequest {
  requestId: string;
  approvalToken: string;
  tenantId: string;
  userId: string;
  subscriptionId: string;
  currentPlanId: string;
  newPlanId: string;
  parentEmail: string;
  childEmail: string;
  changeType: 'upgrade' | 'downgrade';
  status: 'pending' | 'approved' | 'expired';
  createdAt: number;
  expiresAt: number;
}

/**
 * DynamoDB Client
 */
const dynamoDbClient = new DynamoDBClient({});

/**
 * Lambda Client
 */
const lambdaClient = new LambdaClient({});

/**
 * レスポンスを作成するヘルパー関数
 */
function createResponse(
  statusCode: number,
  body: Record<string, unknown>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

/**
 * トークンで保留リクエストを検索
 */
async function findPendingRequestByToken(
  token: string
): Promise<PendingPlanChangeRequest | null> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
      IndexName: 'approvalToken-index',
      KeyConditionExpression: 'approvalToken = :token',
      ExpressionAttributeValues: {
        ':token': { S: token },
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0];
  return {
    requestId: item.requestId?.S || '',
    approvalToken: item.approvalToken?.S || '',
    tenantId: item.tenantId?.S || '',
    userId: item.userId?.S || '',
    subscriptionId: item.subscriptionId?.S || '',
    currentPlanId: item.currentPlanId?.S || '',
    newPlanId: item.newPlanId?.S || '',
    parentEmail: item.parentEmail?.S || '',
    childEmail: item.childEmail?.S || '',
    changeType: (item.changeType?.S as 'upgrade' | 'downgrade') || 'upgrade',
    status: (item.status?.S as 'pending' | 'approved' | 'expired') || 'pending',
    createdAt: Number(item.createdAt?.N || 0),
    expiresAt: Number(item.expiresAt?.N || 0),
  };
}

/**
 * リクエストのステータスを更新
 */
async function updateRequestStatus(
  requestId: string,
  newStatus: 'approved' | 'expired',
  flowExecutionId?: string
): Promise<void> {
  const updateExpression = flowExecutionId
    ? 'SET #status = :status, approvedAt = :approvedAt, flowExecutionId = :flowExecutionId'
    : 'SET #status = :status, approvedAt = :approvedAt';

  const expressionAttributeValues: Record<
    string,
    { S: string } | { N: string }
  > = {
    ':status': { S: newStatus },
    ':approvedAt': { N: Date.now().toString() },
  };

  if (flowExecutionId) {
    expressionAttributeValues[':flowExecutionId'] = { S: flowExecutionId };
  }

  await dynamoDbClient.send(
    new UpdateItemCommand({
      TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
      Key: {
        requestId: { S: requestId },
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Public API: Approve Plan Change request received');

  try {
    // 1. リクエストボディを取得
    if (!event.body) {
      return createResponse(400, {
        success: false,
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
      });
    }

    let requestBody: ApprovePlanChangeRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return createResponse(400, {
        success: false,
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { token } = requestBody;

    if (!token) {
      return createResponse(400, {
        success: false,
        message: 'トークンが指定されていません',
        code: 'MISSING_TOKEN',
      });
    }

    console.log('Processing approval request with token');

    // 2. トークンで保留リクエストを検索
    const pendingRequest = await findPendingRequestByToken(token);

    if (!pendingRequest) {
      console.error('Pending request not found for token');
      return createResponse(400, {
        success: false,
        message:
          '無効な承認リンクです。リンクが間違っているか、既に使用されています。',
        code: 'INVALID_TOKEN',
      });
    }

    console.log('Pending request found:', {
      requestId: pendingRequest.requestId,
      status: pendingRequest.status,
    });

    // 3. ステータスを確認
    if (pendingRequest.status !== 'pending') {
      return createResponse(400, {
        success: false,
        message:
          pendingRequest.status === 'approved'
            ? 'このプラン変更は既に承認されています。'
            : 'この承認リンクは期限切れです。',
        code:
          pendingRequest.status === 'approved'
            ? 'ALREADY_APPROVED'
            : 'TOKEN_EXPIRED',
      });
    }

    // 4. 有効期限を確認
    const now = Date.now();
    if (now > pendingRequest.expiresAt) {
      // 期限切れの場合、ステータスを更新
      await updateRequestStatus(pendingRequest.requestId, 'expired');
      return createResponse(400, {
        success: false,
        message:
          'この承認リンクは期限切れです。お子様に再度リクエストを依頼してください。',
        code: 'TOKEN_EXPIRED',
      });
    }

    // 5. planChangeFlowを呼び出す
    const flowInput: PlanChangeFlowInput = {
      tenantId: pendingRequest.tenantId,
      userId: pendingRequest.userId,
      currentPlanId: pendingRequest.currentPlanId,
      newPlanId: pendingRequest.newPlanId,
      subscriptionId: pendingRequest.subscriptionId,
    };

    console.log('Invoking plan change flow:', {
      functionName: PLAN_CHANGE_FLOW_FUNCTION_NAME,
      input: flowInput,
    });

    const invokeCommand = new InvokeCommand({
      FunctionName: PLAN_CHANGE_FLOW_FUNCTION_NAME,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(flowInput),
    });

    const invokeResult = await lambdaClient.send(invokeCommand);

    // 6. Lambda呼び出し結果の処理
    if (invokeResult.FunctionError) {
      console.error('Plan change flow function error:', {
        functionError: invokeResult.FunctionError,
        payload: invokeResult.Payload
          ? new TextDecoder().decode(invokeResult.Payload)
          : null,
      });

      return createResponse(500, {
        success: false,
        message:
          'プラン変更処理中にエラーが発生しました。しばらく経ってから再度お試しください。',
        code: 'PLAN_CHANGE_FLOW_ERROR',
      });
    }

    if (!invokeResult.Payload) {
      console.error('Plan change flow returned no payload');
      return createResponse(500, {
        success: false,
        message: 'プラン変更処理からのレスポンスが不正です',
        code: 'INVALID_FLOW_RESPONSE',
      });
    }

    const flowOutput: PlanChangeFlowOutput = JSON.parse(
      new TextDecoder().decode(invokeResult.Payload)
    );

    console.log('Plan change flow completed:', {
      success: flowOutput.success,
      flowExecutionId: flowOutput.flowExecutionId,
    });

    // 7. フロー実行結果の確認
    if (!flowOutput.success) {
      console.error('Plan change flow failed:', {
        flowExecutionId: flowOutput.flowExecutionId,
        errorDetails: flowOutput.errorDetails,
      });

      return createResponse(500, {
        success: false,
        message:
          flowOutput.errorDetails?.errorMessage ||
          'プラン変更処理に失敗しました。しばらく経ってから再度お試しください。',
        code: flowOutput.errorDetails?.errorCode || 'PLAN_CHANGE_FAILED',
      });
    }

    // 8. リクエストのステータスを「承認済み」に更新
    await updateRequestStatus(
      pendingRequest.requestId,
      'approved',
      flowOutput.flowExecutionId
    );

    // 9. 成功レスポンスを返す
    const message =
      flowOutput.changeType === 'upgrade'
        ? 'プランがアップグレードされました。新しいプランは即座に有効になります。'
        : 'プランのダウングレードが予約されました。現在の請求期間終了時に新しいプランに切り替わります。';

    console.log('Plan change approved successfully:', {
      requestId: pendingRequest.requestId,
      flowExecutionId: flowOutput.flowExecutionId,
      changeType: flowOutput.changeType,
    });

    return createResponse(200, {
      success: true,
      message,
      flowExecutionId: flowOutput.flowExecutionId,
      changeType: flowOutput.changeType,
      effectiveDate: flowOutput.effectiveDate,
    });
  } catch (error) {
    console.error('Unexpected error in approvePlanChange:', error);

    return createResponse(500, {
      success: false,
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
};
