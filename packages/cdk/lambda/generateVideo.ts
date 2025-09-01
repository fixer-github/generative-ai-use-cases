import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GenerateVideoRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultVideoGenerationModel } from './utils/models';
import { createJob } from './repositoryVideoJob';
import { getTenantCredentials } from './utils/tenantCredentials';
import { isDefaultTenant } from './utils/tenantS3Utils';
import { getTenantId } from './utils/tenantUtils';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const req: GenerateVideoRequest = JSON.parse(event.body!);
    const model = req.model || defaultVideoGenerationModel;

    // Extract tenant ID for video generation
    const tenantId = getTenantId(event);

    // Get tenant-scoped credentials for ABAC when not using default tenant
    let invocationArn: string;
    if (model.type === 'bedrock') {
      if (isDefaultTenant(tenantId)) {
        // For default tenant, use Lambda execution role
        invocationArn = await api.bedrock.generateVideo(
          model,
          req.params,
          tenantId
        );
      } else {
        // For tenant users, use tenant-scoped credentials from Cognito Identity Pool
        console.log(`Getting tenant-scoped credentials for tenant: ${tenantId}`);
        const tenantCredentials = await getTenantCredentials(event);
        
        if (!tenantCredentials.AccessKeyId || !tenantCredentials.SecretKey) {
          throw new Error('Failed to obtain tenant credentials for video generation');
        }
        
        console.log(`Successfully obtained tenant credentials for tenant: ${tenantId}`);
        console.log(`Credentials expiration: ${tenantCredentials.Expiration}`);
        
        // Validate credentials before use
        const credentials = {
          accessKeyId: tenantCredentials.AccessKeyId,
          secretAccessKey: tenantCredentials.SecretKey,
          sessionToken: tenantCredentials.SessionToken,
        };
        
        // Additional validation to ensure credentials are complete
        if (!credentials.accessKeyId || !credentials.secretAccessKey) {
          throw new Error('Invalid tenant credentials: missing accessKeyId or secretAccessKey');
        }
        
        invocationArn = await api.bedrock.generateVideo(
          model,
          req.params,
          tenantId,
          credentials
        );
      }
    } else {
      invocationArn = await api[model.type].generateVideo(model, req.params);
    }

    const res = await createJob(userId, invocationArn, req, event);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(res),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: (error as Error).message }),
    };
  }
};
