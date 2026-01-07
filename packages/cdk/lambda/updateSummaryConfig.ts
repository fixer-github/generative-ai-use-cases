import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  UpdateSummaryConfigRequest,
  UserSummaryConfig,
} from 'generative-ai-use-cases';
import {
  getUserSummaryConfig,
  saveUserSummaryConfig,
  updateUserSummaryConfig,
} from './repository/userSummary';
import { getTenantId } from './utils/tenantUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  internalServerError500Response,
} from './utils/apiResponse';

/**
 * PUT /summaries/config
 * Updates the user's summary configuration
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId =
      event.requestContext.authorizer?.claims?.['cognito:username'] ||
      event.requestContext.authorizer?.claims?.sub;

    if (!userId) {
      return unauthorized401Response({ message: 'User ID not found' });
    }

    if (!event.body) {
      return badRequest400Response({ message: 'Request body is required' });
    }

    const requestBody: UpdateSummaryConfigRequest = JSON.parse(event.body);

    // Validate term unit if provided
    if (
      requestBody.termUnit &&
      !['month', 'year'].includes(requestBody.termUnit)
    ) {
      return badRequest400Response({
        message: 'Invalid termUnit. Must be "month" or "year"',
      });
    }

    // Validate term value if provided
    if (
      requestBody.termValue !== undefined &&
      (requestBody.termValue < 1 || requestBody.termValue > 12)
    ) {
      return badRequest400Response({
        message: 'Invalid termValue. Must be between 1 and 12',
      });
    }

    // Check if config exists
    const existingConfig = await getUserSummaryConfig(userId, event);
    const tenantId = getTenantId(event) || 'default';

    let updatedConfig: UserSummaryConfig | null;

    if (existingConfig) {
      // Update existing config
      updatedConfig = await updateUserSummaryConfig(userId, requestBody, event);
    } else {
      // Create new config with defaults for missing fields
      updatedConfig = await saveUserSummaryConfig(
        {
          userId,
          tenantId,
          termUnit: requestBody.termUnit || 'month',
          termValue: requestBody.termValue || 1,
          externalContextPrompt: requestBody.externalContextPrompt,
          enabled: requestBody.enabled ?? true,
        },
        event
      );
    }

    return ok200Response({
      message: 'Configuration updated successfully',
      config: updatedConfig,
    });
  } catch (error) {
    console.error('Failed to update summary config:', error);
    return internalServerError500Response({
      message: 'Failed to update configuration',
    });
  }
};
