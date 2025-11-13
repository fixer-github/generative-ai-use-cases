import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findTemplateById, deleteTemplateById } from './pptxRepository';
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
    // Check admin status from flat context (Lambda Request Authorizer)
    const isAdmin =
      event.requestContext.authorizer?.['custom:is_admin'] === 'true';

    if (!userId || !tenantId) {
      return unauthorized401Response('Unauthorized');
    }

    // Get template ID from path parameters
    const templateId = event.pathParameters?.templateId;

    if (!templateId) {
      return badRequest400Response('Template ID is required');
    }

    // Find the template to check permissions
    const template = await findTemplateById(event, templateId);

    if (!template) {
      return notFound404Response('Template not found');
    }

    // Check permission - only owner or admin can delete
    if (template.userId !== userId && !isAdmin) {
      return forbidden403Response('Not authorized to delete this template');
    }

    // Delete the template
    await deleteTemplateById(event, templateId);

    return ok200Response({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    return internalServerError500Response('Internal Server Error');
  }
};
