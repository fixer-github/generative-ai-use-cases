import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GenerateVideoRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultVideoGenerationModel } from './utils/models';
import { createJob } from './repositoryVideoJob';
import { getUsername } from './utils/tenantUtils';
import {
  internalServerError500Response,
  ok200Response,
} from './utils/apiResponse';
import { getTenantCredentials } from './utils/tenantCredentials';
import { createOpenFgaClient, checkFeatureAccess } from './utils/openFgaClient';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const req: GenerateVideoRequest = JSON.parse(event.body!);
    const model = req.model || defaultVideoGenerationModel;

    // Create OpenFGA client (internally gets tenant credentials)
    const openFgaClient = await createOpenFgaClient(event);

    // Check authorization for video generation feature
    const hasAccess = await checkFeatureAccess(
      openFgaClient,
      userId,
      'video-generation'
    );
    if (!hasAccess) {
      console.warn(`User ${userId} does not have access to video generation`);
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'You do not have permission to use video generation',
        }),
      };
    }

    const invocationArn = await api[model.type].generateVideo(
      model,
      req.params
    );

    const res = await createJob(userId, invocationArn, req);

    return ok200Response(res);
  } catch (error) {
    console.log(error);
    return internalServerError500Response({
      message: (error as Error).message,
    });
  }
};
