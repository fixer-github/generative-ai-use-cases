import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GenerateImageRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultImageGenerationModel } from './utils/models';
import { internalServerError500Response } from './utils/apiResponse';
import { CORS_HEADERS } from '@generative-ai-use-cases/common';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: GenerateImageRequest = JSON.parse(event.body!);
    const model = req.model || defaultImageGenerationModel;
    const res = await api[model.type].generateImage(model, req.params);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: res,
      isBase64Encoded: true,
    };
  } catch (error) {
    console.log(error);
    return internalServerError500Response((error as Error).message);
  }
};
