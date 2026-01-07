import { ScheduledEvent } from 'aws-lambda';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { initBedrockRuntimeClient } from '../utils/bedrockClient';
import {
  buildDailySummarySystemPrompt,
  buildDailySummaryUserPrompt,
  formatMessagesForSummary,
  truncateSummary,
} from '../utils/summaryPrompts';
import { saveDailySummaryForBatch } from '../repository/userSummary';
import { listMessagesForBatch } from '../repository/message';
import {
  listChatsForBatch,
  discoverUsersWithConversationsOnDate,
} from '../repository/chat';
import { Chat } from 'generative-ai-use-cases';
import liteLlmApi from '../utils/liteLlmApi';

// Configuration from environment
const SUMMARY_MODEL_ID =
  process.env.SUMMARY_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
const MODEL_REGION = process.env.MODEL_REGION || 'us-east-1';
const LITELLM_ENDPOINT = process.env.LITELLM_ENDPOINT || '';
const DAILY_SUMMARY_MAX_CHARS = parseInt(
  process.env.DAILY_SUMMARY_MAX_CHARS || '200'
);

interface DailySummaryEvent {
  tenantId: string;
  userId: string;
  date: string; // YYYY-MM-DD
}

interface BatchEvent {
  tenantId?: string;
  date?: string;
  users?: Array<{ userId: string }>;
}

/**
 * Get yesterday's date in YYYY-MM-DD format (JST timezone)
 */
function getYesterdayDate(): string {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  jstNow.setDate(jstNow.getDate() - 1);
  return jstNow.toISOString().split('T')[0];
}

/**
 * Get start and end timestamps for a given date (in milliseconds)
 */
function getDateTimestampRange(date: string): { start: number; end: number } {
  const startOfDay = new Date(`${date}T00:00:00+09:00`); // JST
  const endOfDay = new Date(`${date}T23:59:59.999+09:00`); // JST
  return {
    start: startOfDay.getTime(),
    end: endOfDay.getTime(),
  };
}

/**
 * Generate daily summary for a single user
 * Uses batch mode functions (STS AssumeRole) - no JWT required
 */
export async function generateDailySummaryForUser(
  userId: string,
  tenantId: string,
  date: string
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    const { start, end } = getDateTimestampRange(date);

    // Get user's chats (using batch mode - no JWT required)
    const chatsResponse = await listChatsForBatch(userId, tenantId);
    const chats = chatsResponse.data || [];

    // Filter chats that were updated on the target date
    const relevantChats = chats.filter((chat: Chat) => {
      const updatedDate = parseInt(chat.updatedDate);
      return updatedDate >= start && updatedDate <= end;
    });

    if (relevantChats.length === 0) {
      return { success: true, summary: undefined };
    }

    // Collect messages from relevant chats
    const allMessages: Array<{ role: string; content: string }> = [];
    const chatIds: string[] = [];

    for (const chat of relevantChats) {
      const chatId = chat.chatId.replace('chat#', '');
      chatIds.push(chatId);

      // Use batch mode - no JWT required
      const messages = await listMessagesForBatch(chatId, tenantId);

      // Filter messages from the target date
      const dayMessages = messages.filter((msg) => {
        const msgTimestamp = parseInt(msg.createdDate.split('#')[0]);
        return msgTimestamp >= start && msgTimestamp <= end;
      });

      allMessages.push(
        ...dayMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }))
      );
    }

    if (allMessages.length === 0) {
      return { success: true, summary: undefined };
    }

    // Format messages for summarization
    const formattedMessages = formatMessagesForSummary(allMessages);

    const systemPrompt = buildDailySummarySystemPrompt(DAILY_SUMMARY_MAX_CHARS);
    const userPrompt = buildDailySummaryUserPrompt(formattedMessages, date);

    let rawSummary: string;
    let inputTokens = 0;
    let outputTokens = 0;

    // Use LiteLLM if configured, otherwise use Bedrock directly
    if (LITELLM_ENDPOINT) {
      // Use LiteLLM proxy
      const result = await liteLlmApi.invoke(
        { modelId: SUMMARY_MODEL_ID, type: 'liteLlm' },
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ''
      );
      rawSummary = result;
      // Note: LiteLLM doesn't return token usage in invoke response
    } else {
      // Use Bedrock directly
      const client = await initBedrockRuntimeClient({ region: MODEL_REGION });
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
            maxTokens: 256,
            temperature: 0.3,
          },
        })
      );
      rawSummary = response.output?.message?.content?.[0]?.text || '';
      inputTokens = response.usage?.inputTokens || 0;
      outputTokens = response.usage?.outputTokens || 0;
    }

    const summary = truncateSummary(rawSummary.trim(), DAILY_SUMMARY_MAX_CHARS);

    // Save the summary - uses batch mode
    await saveDailySummaryForBatch({
      userId,
      tenantId,
      date,
      summary,
      chatIds,
      messageCount: allMessages.length,
      generatedAt: new Date().toISOString(),
      tokenUsage: {
        inputTokens,
        outputTokens,
      },
    });

    return { success: true, summary };
  } catch (error) {
    console.error(`Failed to generate daily summary for user ${userId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Lambda handler for generating daily summaries
 * Can be invoked by:
 * 1. EventBridge scheduled rule (batch processing)
 * 2. Step Functions with specific user/tenant
 */
export const handler = async (
  event: ScheduledEvent | DailySummaryEvent | BatchEvent
): Promise<{
  statusCode: number;
  body: string;
}> => {
  console.log('Daily summary generation triggered:', JSON.stringify(event));

  try {
    // Check if this is a single user request
    if ('userId' in event && 'tenantId' in event) {
      const { userId, tenantId, date } = event as DailySummaryEvent;
      const targetDate = date || getYesterdayDate();

      const result = await generateDailySummaryForUser(
        userId,
        tenantId,
        targetDate
      );

      return {
        statusCode: result.success ? 200 : 500,
        body: JSON.stringify(result),
      };
    }

    // Batch processing for multiple users (from Step Functions or EventBridge)
    if ('users' in event || 'tenantId' in event) {
      const batchEvent = event as BatchEvent;
      const tenantId = batchEvent.tenantId || 'default';
      // Normalize date: EventBridge passes ISO 8601 (YYYY-MM-DDTHH:mm:ssZ), extract YYYY-MM-DD
      const targetDate = (batchEvent.date ?? getYesterdayDate()).slice(0, 10);

      // Discover users with conversations on the target date if not provided
      let users = batchEvent.users || [];
      if (users.length === 0) {
        console.log(
          `No users provided, discovering users with conversations on ${targetDate}`
        );
        const discoveredUserIds = await discoverUsersWithConversationsOnDate(
          targetDate,
          tenantId
        );
        users = discoveredUserIds.map((userId) => ({ userId }));
        console.log(`Discovered ${users.length} users with conversations`);
      }

      // Return early if no users found
      if (users.length === 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'No users with conversations on target date',
            date: targetDate,
            total: 0,
            successful: 0,
            failed: 0,
          }),
        };
      }

      const results = await Promise.allSettled(
        users.map((user) =>
          generateDailySummaryForUser(user.userId, tenantId, targetDate)
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

    // Default: scheduled invocation - should be handled by Step Functions
    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          'Scheduled invocation - should be orchestrated by Step Functions',
        date: getYesterdayDate(),
      }),
    };
  } catch (error) {
    console.error('Daily summary generation failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
