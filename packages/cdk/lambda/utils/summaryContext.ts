import { APIGatewayProxyEvent } from 'aws-lambda';
import { DailySummary, UserSummary } from 'generative-ai-use-cases';
import {
  getYesterdayDailySummary,
  getUserSummary,
} from '../repository/userSummary';

/**
 * Build summary context XML to inject into system prompts
 * @param userId User ID (without 'user#' prefix)
 * @param event API Gateway event for tenant context
 * @returns XML-formatted summary context string, or empty string if no summaries
 */
export async function buildSummaryContext(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<string> {
  try {
    // Fetch both summaries in parallel
    const [dailySummary, userSummary] = await Promise.all([
      getYesterdayDailySummary(userId, event).catch(() => null),
      getUserSummary(userId, event).catch(() => null),
    ]);

    if (!dailySummary && !userSummary) {
      return '';
    }

    return formatSummaryContext(dailySummary, userSummary);
  } catch (error) {
    console.error('Failed to build summary context:', error);
    return '';
  }
}

/**
 * Format summary context as XML for system prompt injection
 * @param dailySummary Yesterday's daily summary (optional)
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

  let context = '<context_summaries>\n';

  if (dailySummary) {
    context += `<daily_summary date="${dailySummary.date}">\n`;
    context += dailySummary.summary;
    context += '\n</daily_summary>\n';
  }

  if (userSummary) {
    context += `<user_profile term="${userSummary.termValue} ${userSummary.termUnit}(s)">\n`;
    context += userSummary.summary;
    context += '\n</user_profile>\n';
  }

  context += '</context_summaries>';

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
