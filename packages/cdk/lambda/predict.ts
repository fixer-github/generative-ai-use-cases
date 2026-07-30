import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { invokeWithMetadata } from './utils/bedrockApi';
import {
  LICENSE_ENABLED,
  blockMessage,
  chargeLlmUsageSafely,
  checkLicense,
  isLicenseExemptUsecase,
  usecaseToCategory,
} from './utils/license';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: PredictRequest = JSON.parse(event.body!);
    const model = req.model || defaultModel;

    // License gate for the non-streaming LLM path (translation, diagram type
    // detection, meeting-minutes helpers, ...). RAG query generation is
    // exempt (requirement 2).
    const meterUsage =
      LICENSE_ENABLED &&
      model.type === 'bedrock' &&
      !isLicenseExemptUsecase(req.id);

    if (meterUsage) {
      const licenseUserId =
        event.requestContext.authorizer?.claims?.['cognito:username'];
      const check = licenseUserId
        ? await checkLicense(licenseUserId, { modelId: model.modelId })
        : ({ allowed: false, reason: 'error' } as const);
      if (!check.allowed) {
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            message: blockMessage(check.reason),
            reason: check.reason,
          }),
        };
      }

      const chunk = await invokeWithMetadata(model, req.messages, req.id);
      if (chunk.metadata?.usage) {
        await chargeLlmUsageSafely(
          licenseUserId,
          model.modelId,
          chunk.metadata.usage,
          usecaseToCategory(req.id)
        );
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(chunk.text),
      };
    }

    const response = await api[model.type].invoke?.(
      model,
      req.messages,
      req.id
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
