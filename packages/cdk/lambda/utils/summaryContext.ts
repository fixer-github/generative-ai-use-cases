import { APIGatewayProxyEvent } from 'aws-lambda';
import { DailySummary, UserSummary } from 'generative-ai-use-cases';
import {
  getLatestDailySummary,
  getUserSummary,
} from '../repository/userSummary';

// Check if summary feature is enabled (set at deployment time)
const SUMMARY_JOB_ENABLED = process.env.SUMMARY_JOB_ENABLED === 'true';

/**
 * Build summary context XML to inject into system prompts
 * Returns empty string if summary feature is disabled for this environment
 * @param userId User ID (without 'user#' prefix)
 * @param event API Gateway event for tenant context
 * @returns XML-formatted summary context string, or empty string if no summaries or feature disabled
 */
export async function buildSummaryContext(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<string> {
  // Skip if summary feature is not enabled for this environment
  if (!SUMMARY_JOB_ENABLED) {
    console.log('Summary feature is disabled (SUMMARY_JOB_ENABLED != true)');
    return '';
  }

  console.log(`Building summary context for user: ${userId}`);

  try {
    // Fetch both summaries in parallel
    const [dailySummary, userSummary] = await Promise.all([
      getLatestDailySummary(userId, event).catch((err) => {
        console.error('Failed to get latest daily summary:', err);
        return null;
      }),
      getUserSummary(userId, event).catch((err) => {
        console.error('Failed to get user summary:', err);
        return null;
      }),
    ]);

    console.log(
      `Summary fetch results - daily: ${!!dailySummary}, user: ${!!userSummary}`
    );

    if (!dailySummary && !userSummary) {
      console.log('No summaries found for user');
      return '';
    }

    const context = formatSummaryContext(dailySummary, userSummary);
    console.log(`Summary context built, length: ${context.length}`);
    return context;
  } catch (error) {
    console.error('Failed to build summary context:', error);
    return '';
  }
}

/**
 * Format summary context as XML for system prompt injection
 * @param dailySummary Latest daily summary (optional)
 * @param userSummary User's aggregated summary (optional)
 * @returns Formatted XML context string
 */
export function formatSummaryContext(
  dailySummary: DailySummary | null,
  userSummary: UserSummary | null
): string {
  if (!dailySummary && !userSummary) {
    return '';
  }

  let context = '<user_conversation_context>\n';

  if (dailySummary) {
    context += '  <recent_session_summary>\n';
    context += `  ${dailySummary.summary}\n`;
    context += '  </recent_session_summary>\n';
  }

  if (userSummary) {
    context += '  <user_coaching_profile>\n';
    context += `  ${userSummary.summary}\n`;
    context += '  </user_coaching_profile>\n';
  }

  context += '</user_conversation_context>';

  return context;
}

/**
 * Build complete system message with summary context injected
 * @param baseInstruction The base assistant/system instruction
 * @param summaryContext Summary context XML (from buildSummaryContext)
 * @param ragContext RAG context (optional)
 * @param customInstructions User's custom instructions (optional)
 * @returns Complete system message with all context
 */
export function buildSystemMessageWithSummary(
  baseInstruction: string,
  summaryContext: string,
  ragContext?: string | null,
  customInstructions?: string | null
): string {
  let message = `<instructions>\n${baseInstruction}\n</instructions>`;

  if (summaryContext) {
    message += `\n\n${summaryContext}`;
  }

  if (ragContext) {
    message += `\n\nRelevant context from documents:\n${ragContext}`;
  }

  if (customInstructions?.trim()) {
    message += `\n<user_custom_instructions>\n${customInstructions}\n</user_custom_instructions>`;
  }

  return message;
}

/**
 * Extract user ID from different formats
 * @param userId User ID potentially with 'user#' prefix
 * @returns Clean user ID without prefix
 */
export function extractUserId(userId: string): string {
  return userId.startsWith('user#') ? userId.substring(5) : userId;
}

/**
 * Build user ID with prefix
 * @param userId Clean user ID
 * @returns User ID with 'user#' prefix
 */
export function buildUserIdWithPrefix(userId: string): string {
  return userId.startsWith('user#') ? userId : `user#${userId}`;
}
