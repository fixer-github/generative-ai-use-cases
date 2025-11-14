import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findGenerationById } from './pptxRepository';
import { getPptxDownloadUrl } from './pptxService';
import { getUsername, getTenantId } from '../utils/tenantUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  forbidden403Response,
  notFound404Response,
  internalServerError500Response,
} from '../utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Get user info from Cognito
    const userId = getUsername(event);
    const tenantId = getTenantId(event);

    if (!userId || !tenantId) {
      return unauthorized401Response({ message: 'Unauthorized' });
    }

    // Get generation ID from path parameters
    const generationId = event.pathParameters?.generationId;

    if (!generationId) {
      return badRequest400Response({ message: 'Generation ID is required' });
    }

    // Find the generation
    const generation = await findGenerationById(event, generationId);

    if (!generation) {
      return notFound404Response({ message: 'Generation not found' });
    }

    // Check permission - only owner can download
    if (generation.userId !== userId) {
      return forbidden403Response({
        message: 'Not authorized to download this generation',
      });
    }

    // Check if generation is completed and has output
    if (generation.status !== 'completed' || !generation.s3OutputKey) {
      return badRequest400Response(
        'Generation not completed or no output available'
      );
    }

    // Generate download URL
    const downloadUrl = await getPptxDownloadUrl(
      event,
      tenantId,
      generation.s3OutputKey
    );

    return ok200Response({ download_url: downloadUrl });
  } catch (error) {
    console.error('Error getting download URL:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
