import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetSummariesResponse } from 'generative-ai-use-cases';
import {
  getYesterdayDailySummary,
  getUserSummary,
  getUserSummaryConfig,
} from './repository/userSummary';
import {
  ok200Response,
  unauthorized401Response,
  internalServerError500Response,
} from './utils/apiResponse';

/**
 * GET /summaries
 * Returns the user's daily summary (yesterday's) and user summary
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

    // Fetch all summary data in parallel
    const [dailySummary, userSummary, config] = await Promise.all([
      getYesterdayDailySummary(userId, event).catch((error) => {
        console.warn('Failed to get daily summary:', error);
        return null;
      }),
      getUserSummary(userId, event).catch((error) => {
        console.warn('Failed to get user summary:', error);
        return null;
      }),
      getUserSummaryConfig(userId, event).catch((error) => {
        console.warn('Failed to get summary config:', error);
        return null;
      }),
    ]);

    const response: GetSummariesResponse = {};

    if (dailySummary) {
      response.dailySummary = dailySummary;
    }

    if (userSummary) {
      response.userSummary = userSummary;
    }

    if (config) {
      response.config = config;
    }

    return ok200Response(response);
  } catch (error) {
    console.error('Failed to get summaries:', error);
    return internalServerError500Response({
      message: 'Failed to retrieve summaries',
    });
  }
};
