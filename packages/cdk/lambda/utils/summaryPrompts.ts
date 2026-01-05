/**
 * Prompt templates for daily and user summary generation
 */

/**
 * Build the system prompt for daily summary generation
 * @param maxChars Maximum characters for the summary (default: 200)
 * @param externalContext Optional external context to influence the summary
 */
export function buildDailySummarySystemPrompt(
  maxChars: number = 200,
  externalContext?: string
): string {
  let prompt = `You are a concise summarizer. Your task is to summarize a day's worth of conversations into a brief, informative summary.

CRITICAL REQUIREMENTS:
1. Output MUST be under ${maxChars} characters (this is a hard limit)
2. Focus on key topics, decisions, or insights discussed
3. Use clear, direct language
4. Capture the essence of what the user was working on or discussing
5. Output in the same language as the conversations`;

  if (externalContext) {
    prompt += `
6. Consider this context when summarizing: ${externalContext}`;
  }

  prompt += `

Output format: A single paragraph summary with no bullet points or formatting. Just plain text.`;

  return prompt;
}

/**
 * Build the user prompt for daily summary generation
 * @param messages Formatted conversation messages from the day
 * @param date The date being summarized (YYYY-MM-DD)
 */
export function buildDailySummaryUserPrompt(
  messages: string,
  date: string
): string {
  return `Date: ${date}

CONVERSATION HISTORY:
${messages}

Please summarize the above conversations concisely.`;
}

/**
 * Build the system prompt for user summary generation
 * @param maxChars Maximum characters for the summary (default: 500)
 */
export function buildUserSummarySystemPrompt(maxChars: number = 500): string {
  return `You are a summarization assistant that aggregates daily summaries into a comprehensive user profile summary.

CRITICAL REQUIREMENTS:
1. Output MUST be under ${maxChars} characters (this is a hard limit)
2. Identify patterns, recurring themes, and key focus areas
3. Highlight important decisions, accomplishments, or insights
4. Provide a holistic view of the user's activities and interests
5. Output in the same language as the daily summaries

Output format: A coherent narrative summary with no bullet points or formatting. Just plain text.`;
}

/**
 * Build the user prompt for user summary generation
 * @param dailySummaries Array of daily summary texts
 * @param termStart Start date of the term (YYYY-MM-DD)
 * @param termEnd End date of the term (YYYY-MM-DD)
 */
export function buildUserSummaryUserPrompt(
  dailySummaries: Array<{ date: string; summary: string }>,
  termStart: string,
  termEnd: string
): string {
  const formattedSummaries = dailySummaries
    .map((s) => `[${s.date}] ${s.summary}`)
    .join('\n');

  return `PERIOD: ${termStart} to ${termEnd}

DAILY SUMMARIES:
${formattedSummaries}

Please create a comprehensive summary of this user's activities during this period.`;
}

/**
 * Format conversation messages for summarization
 * @param messages Array of message objects with role and content
 * @param maxTotalLength Maximum total length of formatted messages
 */
export function formatMessagesForSummary(
  messages: Array<{ role: string; content: string }>,
  maxTotalLength: number = 32000
): string {
  const formatted: string[] = [];
  let totalLength = 0;

  for (const msg of messages) {
    // Skip system messages
    if (msg.role === 'system') continue;

    // Truncate long messages
    const truncatedContent =
      msg.content.length > 1000
        ? msg.content.substring(0, 1000) + '...'
        : msg.content;

    const line = `[${msg.role}]: ${truncatedContent}`;

    if (totalLength + line.length > maxTotalLength) {
      formatted.push('[...conversation truncated due to length...]');
      break;
    }

    formatted.push(line);
    totalLength += line.length;
  }

  return formatted.join('\n');
}

/**
 * Truncate summary to ensure it meets character limit
 * @param text The generated summary text
 * @param maxChars Maximum allowed characters
 */
export function truncateSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  // Find the last sentence boundary before the limit
  const truncated = text.substring(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastQuestion = truncated.lastIndexOf('?');
  const lastExclamation = truncated.lastIndexOf('!');

  const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

  if (lastSentenceEnd > maxChars * 0.5) {
    // If we found a sentence end in the latter half, use it
    return truncated.substring(0, lastSentenceEnd + 1);
  }

  // Otherwise, truncate at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}
