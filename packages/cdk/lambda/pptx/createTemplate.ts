import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid4 } from 'uuid';
import { createTemplate } from './pptxRepository';
import { getUsername, getTenantId } from '../utils/tenantUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  internalServerError500Response,
} from '../utils/apiResponse';

interface CreateTemplateRequest {
  template_name: string;
  template_description?: string;
  is_public?: boolean;
  tags?: string[];
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

    // Parse request body
    if (!event.body) {
      return badRequest400Response({ message: 'Request body is required' });
    }

    const templateInput: CreateTemplateRequest = JSON.parse(event.body);
    const s3Key = event.queryStringParameters?.s3_key;

    if (!s3Key) {
      return badRequest400Response({ message: 'S3 key parameter is required' });
    }

    // Validate required fields
    if (
      !templateInput.template_name ||
      templateInput.template_name.trim().length === 0
    ) {
      return badRequest400Response({ message: 'Template name is required' });
    }

    if (templateInput.template_name.length > 100) {
      return badRequest400Response(
        'Template name must be 100 characters or less'
      );
    }

    if (
      templateInput.template_description &&
      templateInput.template_description.length > 500
    ) {
      return badRequest400Response(
        'Template description must be 500 characters or less'
      );
    }

    // Generate template ID and create template
    const templateId = uuid4();

    const template = await createTemplate(
      event,
      templateId,
      userId,
      templateInput.template_name,
      templateInput.template_description,
      s3Key,
      templateInput.is_public || false,
      templateInput.tags || []
    );

    // Convert to response format
    const response = {
      template_id: template.templateId,
      tenant_id: template.tenantId,
      user_id: template.userId,
      template_name: template.templateName,
      template_description: template.templateDescription,
      s3_key: template.s3Key,
      thumbnail_s3_key: template.thumbnailS3Key,
      is_public: template.isPublic === 'true',
      tags: template.tags,
      created_at: template.createdAt,
      updated_at: template.updatedAt,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error creating template:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
