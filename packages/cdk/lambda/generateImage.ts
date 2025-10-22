import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GenerateImageRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultImageGenerationModel } from './utils/models';
import {
  internalServerError500Response,
  ok200Base64Response,
} from './utils/apiResponse';
import { getTenantCredentials } from './utils/tenantCredentials';
import { createOpenFgaClient, checkFeatureAccess } from './utils/openFgaClient';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: GenerateImageRequest = JSON.parse(event.body!);
    const model = req.model || defaultImageGenerationModel;
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    // Get tenant credentials and create OpenFGA client
    const { credentials } = await getTenantCredentials(event);
    const openFgaClient = await createOpenFgaClient(event, credentials);

    // Check authorization for image generation feature
    const hasAccess = await checkFeatureAccess(
      openFgaClient,
      userId,
      'image-generation'
    );
    if (!hasAccess) {
      console.warn(`User ${userId} does not have access to image generation`);
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'You do not have permission to use image generation',
        }),
      };
    }

    const res = await api[model.type].generateImage(model, req.params);

    return ok200Base64Response(res);
  } catch (error) {
    console.log(error);
    return internalServerError500Response({
      message: (error as Error).message,
    });
  }
};
