/**
 * Prompt templates for daily and user summary generation
 */

/**
 * Build the system prompt for daily summary generation
 * @param maxChars Maximum characters for the summary (default: 200)
 */
export function buildDailySummarySystemPrompt(maxChars: number = 200): string {
  return `You are a coaching journal assistant. Your task is to summarize a day's conversations to track the user's learning journey and growth.

EXTRACTION FOCUS:
1. Problem genres - What types of problems/issues did the user face today?
2. Confusion points - What caused the user difficulty or confusion?
3. AI coaching - How did the AI assist, guide, or coach the user?
4. User growth - What did the user learn, improve, or change today?

CRITICAL REQUIREMENTS:
1. Output MUST be under ${maxChars} characters (this is a hard limit)
2. Prioritize insights about user's learning and growth over topic listing
3. Note specific struggles and breakthroughs
4. Output in the same language as the conversations

Output format: A single paragraph focusing on the user's learning journey. No bullet points.`;
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

Analyze the conversations and extract: what problems the user faced, where they struggled, how AI helped them, and what growth or learning occurred.`;
}

/**
 * Build the system prompt for user summary generation
 * @param maxChars Maximum characters for the summary (default: 500)
 */
export function buildUserSummarySystemPrompt(maxChars: number = 500): string {
  return `You are a growth tracking assistant. Your task is to analyze daily coaching summaries and create a comprehensive view of the user's growth trajectory.

EXTRACTION FOCUS:
1. Growth trajectory - How has the user grown over this period?
2. Breakthroughs - What problems can the user now solve that they couldn't before?
3. Persistent challenges - What areas still cause difficulty?
4. Growth potential - Where are the opportunities for further development?
5. Learning patterns - How does the user learn best? What approaches worked?

CRITICAL REQUIREMENTS:
1. Output MUST be under ${maxChars} characters (this is a hard limit)
2. Focus on concrete examples of growth (e.g., "user now handles X independently")
3. Note both achievements and areas needing support
4. Output in the same language as the daily summaries

Output format: A narrative focusing on user's growth journey and potential. No bullet points.`;
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

DAILY COACHING SUMMARIES:
${formattedSummaries}

Analyze the user's growth trajectory: What breakthroughs occurred? What can they do now that they couldn't before? What challenges persist? Where is their growth potential?`;
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
