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

    // Check permission - only owner can view
    if (generation.userId !== userId) {
      return forbidden403Response({
        message: 'Not authorized to view this generation',
      });
    }

    // Generate download URL if generation is completed
    let downloadUrl = null;
    if (generation.status === 'completed' && generation.s3OutputKey) {
      try {
        downloadUrl = await getPptxDownloadUrl(
          event,
          tenantId,
          generation.s3OutputKey
        );
      } catch (error) {
        console.error('Error generating download URL:', error);
        // Continue without download URL - don't fail the request
      }
    }

    // Convert to response format
    const response = {
      generation_id: generation.generationId,
      status: generation.status,
      progress: undefined, // Could be added later for real-time progress tracking
      message:
        generation.status === 'failed' ? generation.errorMessage : undefined,
      download_url: downloadUrl,
      error_message: generation.errorMessage,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error getting generation status:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
