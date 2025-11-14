import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  generatePresignedUploadUrl,
  validateFileExtension,
} from './pptxService';
import { getUsername, getTenantId } from '../utils/tenantUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  internalServerError500Response,
} from '../utils/apiResponse';

interface QueryParams {
  filename: string;
  contentType?: string;
}

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

    // Parse query parameters
    const filename = event.queryStringParameters?.filename;
    const contentType =
      event.queryStringParameters?.content_type ||
      'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    if (!filename) {
      return badRequest400Response({
        message: 'Filename parameter is required',
      });
    }

    // Validate file extension
    if (!validateFileExtension(filename)) {
      return badRequest400Response({
        message: 'Only PPTX and POTX files are allowed',
      });
    }

    // Generate presigned URL (pass event for tenant role assumption)
    const presignedUrl = await generatePresignedUploadUrl(
      event,
      tenantId,
      userId,
      filename,
      contentType,
      'template'
    );

    return ok200Response({
      upload_url: presignedUrl.uploadUrl,
      s3_key: presignedUrl.s3Key,
      expires_in: presignedUrl.expiresIn,
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
