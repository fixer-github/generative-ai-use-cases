import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';

const lambdaClient = new LambdaClient({});

/**
 * Lambda関数のメインハンドラー
 * Stripe Customer Portalセッションを作成するラッパー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Create Customer Portal request received');

  try {
    // ユーザー認証情報を取得
    const userId = getUserIdFromCognitoEvent(event);
    const tenantId = getTenantId(event);

    // リクエストボディを取得
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const requestBody = JSON.parse(event.body);
    const { returnUrl } = requestBody;

    if (!returnUrl) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required field',
          message: 'returnUrl is required',
        }),
      };
    }

    console.log('Creating Customer Portal session:', {
      userId,
      tenantId,
      returnUrl,
    });

    // Payment Gateway のCreateCustomerPortalSession関数を呼び出す
    const functionName = `${process.env.ENVIRONMENT}-billing-payment-customer-portal`;
    const payload = {
      body: JSON.stringify({
        userId,
        returnUrl,
      }),
      headers: event.headers, // Authorizationヘッダーを含む
      requestContext: event.requestContext, // 認証情報を渡す
    };

    const invokeCommand = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(payload),
    });

    const response = await lambdaClient.send(invokeCommand);
    const responsePayload = JSON.parse(
      new TextDecoder().decode(response.Payload)
    );

    // Payment Gateway関数からのレスポンスをそのまま返す
    if (responsePayload.statusCode === 200) {
      return {
        statusCode: 200,
        body: responsePayload.body,
      };
    } else {
      // エラーレスポンスもそのまま返す
      return {
        statusCode: responsePayload.statusCode || 500,
        body:
          responsePayload.body ||
          JSON.stringify({
            error: 'Failed to create Customer Portal session',
          }),
      };
    }
  } catch (error) {
    console.error('Error creating Customer Portal session:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Customer Portalセッションの作成に失敗しました',
      }),
    };
  }
}
