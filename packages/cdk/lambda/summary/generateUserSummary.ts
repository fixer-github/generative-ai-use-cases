import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { initBedrockRuntimeClient } from '../utils/bedrockClient';
import {
  buildUserSummarySystemPrompt,
  buildUserSummaryUserPrompt,
  truncateSummary,
} from '../utils/summaryPrompts';
import {
  saveUserSummary,
  getUserSummaryConfig,
  getDailySummariesInRange,
  calculateTermStart,
  getYesterdayDate,
} from '../repository/userSummary';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { DailySummary } from 'generative-ai-use-cases';

// Configuration from environment
const SUMMARY_MODEL_ID =
  process.env.SUMMARY_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
const MODEL_REGION = process.env.MODEL_REGION || 'us-east-1';
const USER_SUMMARY_MAX_CHARS = parseInt(
  process.env.USER_SUMMARY_MAX_CHARS || '500'
);
const DEFAULT_TERM_UNIT = (process.env.DEFAULT_TERM_UNIT || 'month') as
  | 'month'
  | 'year';
const DEFAULT_TERM_VALUE = parseInt(process.env.DEFAULT_TERM_VALUE || '1');

interface UserSummaryEvent {
  tenantId: string;
  userId: string;
  termEnd?: string; // YYYY-MM-DD, defaults to yesterday
}

interface BatchEvent {
  tenantId?: string;
  termEnd?: string;
  users?: Array<{ userId: string }>;
}

/**
 * Create a synthetic API Gateway event for tenant-aware operations
 */
function createSyntheticEvent(
  userId: string,
  tenantId: string
): APIGatewayProxyEvent {
  return {
    headers: {
      'x-tenant-id': tenantId,
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: userId,
          'custom:tenantId': tenantId,
        },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

/**
 * Generate user summary for a single user
 */
export async function generateUserSummaryForUser(
  userId: string,
  tenantId: string,
  termEnd?: string
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    const syntheticEvent = createSyntheticEvent(userId, tenantId);

    // Determine term end date (default: yesterday)
    const endDate = termEnd || getYesterdayDate();

    // Get user's term configuration (or use defaults)
    const config = await getUserSummaryConfig(userId, syntheticEvent);
    const termUnit = config?.termUnit || DEFAULT_TERM_UNIT;
    const termValue = config?.termValue || DEFAULT_TERM_VALUE;

    // Calculate term start date
    const startDate = calculateTermStart(termUnit, termValue, endDate);

    // Get daily summaries within the term
    const dailySummaries = await getDailySummariesInRange(
      userId,
      startDate,
      endDate,
      syntheticEvent
    );

    if (dailySummaries.length === 0) {
      console.log(`No daily summaries found for user ${userId} in term ${startDate} to ${endDate}`);
      return { success: true, summary: undefined };
    }

    // Format daily summaries for the prompt
    const formattedSummaries = dailySummaries.map((s: DailySummary) => ({
      date: s.date,
      summary: s.summary,
    }));

    // Generate user summary using Bedrock
    const client = await initBedrockRuntimeClient({ region: MODEL_REGION });

    const systemPrompt = buildUserSummarySystemPrompt(USER_SUMMARY_MAX_CHARS);
    const userPrompt = buildUserSummaryUserPrompt(
      formattedSummaries,
      startDate,
      endDate
    );

    const response = await client.send(
      new ConverseCommand({
        modelId: SUMMARY_MODEL_ID,
        messages: [
          {
            role: 'user',
            content: [{ text: userPrompt }],
          },
        ],
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          maxTokens: 512,
          temperature: 0.3,
        },
      })
    );

    const rawSummary =
      response.output?.message?.content?.[0]?.text || '';
    const summary = truncateSummary(rawSummary.trim(), USER_SUMMARY_MAX_CHARS);

    // Save the user summary
    await saveUserSummary(
      {
        userId,
        tenantId,
        summary,
        termUnit,
        termValue,
        termStart: startDate,
        termEnd: endDate,
        dailySummaryDates: dailySummaries.map((s: DailySummary) => s.date),
        generatedAt: new Date().toISOString(),
        tokenUsage: {
          inputTokens: response.usage?.inputTokens || 0,
          outputTokens: response.usage?.outputTokens || 0,
        },
      },
      syntheticEvent
    );

    return { success: true, summary };
  } catch (error) {
    console.error(`Failed to generate user summary for user ${userId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Lambda handler for generating user summaries
 * Typically invoked by Step Functions after daily summary generation completes
 */
export const handler = async (
  event: UserSummaryEvent | BatchEvent
): Promise<{
  statusCode: number;
  body: string;
}> => {
  console.log('User summary generation triggered:', JSON.stringify(event));

  try {
    // Check if this is a single user request
    if ('userId' in event && 'tenantId' in event) {
      const { userId, tenantId, termEnd } = event as UserSummaryEvent;

      const result = await generateUserSummaryForUser(userId, tenantId, termEnd);

      return {
        statusCode: result.success ? 200 : 500,
        body: JSON.stringify(result),
      };
    }

    // Batch processing for multiple users (from Step Functions)
    if ('users' in event && Array.isArray(event.users)) {
      const batchEvent = event as BatchEvent;
      const tenantId = batchEvent.tenantId || 'default';
      const termEnd = batchEvent.termEnd;

      const results = await Promise.allSettled(
        batchEvent.users.map((user) =>
          generateUserSummaryForUser(user.userId, tenantId, termEnd)
        )
      );

      const summary = {
        total: results.length,
        successful: results.filter(
          (r) => r.status === 'fulfilled' && r.value.success
        ).length,
        failed: results.filter(
          (r) =>
            r.status === 'rejected' ||
            (r.status === 'fulfilled' && !r.value.success)
        ).length,
      };

      return {
        statusCode: 200,
        body: JSON.stringify(summary),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Invalid event format. Expected userId/tenantId or users array.',
      }),
    };
  } catch (error) {
    console.error('User summary generation failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
