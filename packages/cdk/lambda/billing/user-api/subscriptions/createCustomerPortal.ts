import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import {
  ok200Response,
  badRequest400Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const lambdaClient = new LambdaClient({});

/**
 * Lambda関数のメインハンドラー
 * Stripe Customer Portalセッションを作成するラッパー
 *
 * @deprecated Use createPaymentMethodUpdateSession for updating payment methods.
 * This API will be removed in a future version.
 *
 * Note: Customer Portal updates the customer's default payment method,
 * but does NOT update the subscription's payment method immediately.
 * The subscription continues using its original payment method until
 * the next billing cycle.
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
      return badRequest400Response({
        message: 'Request body is required',
        code: 'MISSING_BODY',
        details: {},
      });
    }

    const requestBody = JSON.parse(event.body);
    const { returnUrl } = requestBody;

    if (!returnUrl) {
      return badRequest400Response({
        message: 'returnUrl is required',
        code: 'MISSING_FIELD',
        details: { field: 'returnUrl' },
      });
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
      const responseBody = JSON.parse(responsePayload.body);
      return ok200Response(responseBody);
    } else {
      // エラーレスポンスもそのまま返す
      const errorBody = responsePayload.body
        ? JSON.parse(responsePayload.body)
        : {
            message: 'Failed to create Customer Portal session',
            code: 'PORTAL_SESSION_ERROR',
            details: {},
          };
      return internalServerError500Response(errorBody);
    }
  } catch (error) {
    console.error('Error creating Customer Portal session:', error);

    return internalServerError500Response({
      message: 'Customer Portalセッションの作成に失敗しました',
      code: 'INTERNAL_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}
