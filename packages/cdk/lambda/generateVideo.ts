import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GenerateVideoRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultVideoGenerationModel } from './utils/models';
import { createJob } from './repositoryVideoJob';
import { getUsername } from './utils/tenantUtils';
import {
  ok200Response,
  internalServerError500Response,
} from './utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const req: GenerateVideoRequest = JSON.parse(event.body!);
    const model = req.model || defaultVideoGenerationModel;
    const invocationArn = await api[model.type].generateVideo(
      model,
      req.params
    );

    const res = await createJob(userId, invocationArn, req);

    return ok200Response(res);
  } catch (error) {
    console.log(error);
    return internalServerError500Response((error as Error).message);
  }
};
