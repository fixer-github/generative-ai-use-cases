import {
  DynamoDBClient,
  BatchWriteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Assistant, Chat } from 'generative-ai-use-cases';
import { ChatMessage } from '../transformers/chat';

export type DynamoDBWriterOptions = {
  region: string;
  assistantTableName: string;
  chatHistoryTableName: string;
  batchSize?: number;
  dryRun?: boolean;
  checkpointInterval?: number;
};

export type WriteProgress = {
  totalAssistants: number;
  writtenAssistants: number;
  totalChats: number;
  writtenChats: number;
  totalMessages: number;
  writtenMessages: number;
  errors: string[];
};

export type Checkpoint = {
  timestamp: string;
  progress: WriteProgress;
  lastProcessedAssistantId?: string;
  lastProcessedChatId?: string;
};

export class DynamoDBWriter {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private progress: WriteProgress;

  constructor(private options: DynamoDBWriterOptions) {
    this.client = new DynamoDBClient({ region: options.region });
    this.docClient = DynamoDBDocumentClient.from(this.client);
    this.progress = {
      totalAssistants: 0,
      writtenAssistants: 0,
      totalChats: 0,
      writtenChats: 0,
      totalMessages: 0,
      writtenMessages: 0,
      errors: [],
    };
  }

  /**
   * Check if an assistant already exists
   */
  private async assistantExists(
    userId: string,
    assistantId: string
  ): Promise<boolean> {
    const command = new QueryCommand({
      TableName: this.options.assistantTableName,
      KeyConditionExpression: 'id = :userId',
      FilterExpression: 'assistantId = :assistantId',
      ExpressionAttributeValues: {
        ':userId': { S: userId },
        ':assistantId': { S: assistantId },
      },
      Limit: 1,
    });

    const result = await this.client.send(command);
    return (result.Items?.length ?? 0) > 0;
  }

  /**
   * Check if a chat already exists
   */
  private async chatExists(userId: string, chatId: string): Promise<boolean> {
    const command = new QueryCommand({
      TableName: this.options.chatHistoryTableName,
      KeyConditionExpression: 'id = :userId',
      FilterExpression: 'chatId = :chatId',
      ExpressionAttributeValues: {
        ':userId': { S: userId },
        ':chatId': { S: chatId },
      },
      Limit: 1,
    });

    const result = await this.client.send(command);
    return (result.Items?.length ?? 0) > 0;
  }

  /**
   * Write a single assistant with idempotency check
   */
  async writeAssistant(assistant: Assistant): Promise<boolean> {
    try {
      // Check if already exists
      const exists = await this.assistantExists(assistant.id, assistant.assistantId);
      if (exists) {
        console.log(`Assistant ${assistant.assistantId} already exists, skipping`);
        return false;
      }

      if (this.options.dryRun) {
        console.log(`[DRY RUN] Would write assistant: ${assistant.assistantId}`);
        return true;
      }

      const command = new PutCommand({
        TableName: this.options.assistantTableName,
        Item: assistant,
      });

      await this.docClient.send(command);
      this.progress.writtenAssistants++;
      return true;
    } catch (error) {
      const errorMsg = `Failed to write assistant ${assistant.assistantId}: ${error instanceof Error ? error.message : String(error)}`;
      this.progress.errors.push(errorMsg);
      console.error(errorMsg);
      return false;
    }
  }

  /**
   * Write assistants in batches
   */
  async writeAssistants(assistants: Assistant[]): Promise<void> {
    this.progress.totalAssistants = assistants.length;
    console.log(`Writing ${assistants.length} assistants...`);

    for (const assistant of assistants) {
      await this.writeAssistant(assistant);

      // Progress reporting
      if (this.progress.writtenAssistants % 10 === 0) {
        console.log(
          `Progress: ${this.progress.writtenAssistants}/${this.progress.totalAssistants} assistants written`
        );
      }
    }

    console.log(
      `Completed: ${this.progress.writtenAssistants}/${this.progress.totalAssistants} assistants written`
    );
  }

  /**
   * Write a chat and its messages as a transaction
   */
  async writeChatWithMessages(
    chat: Chat & { tenantId: string; assistantId?: string },
    messages: ChatMessage[]
  ): Promise<boolean> {
    try {
      // Check if chat already exists
      const exists = await this.chatExists(chat.id, chat.chatId);
      if (exists) {
        console.log(`Chat ${chat.chatId} already exists, skipping`);
        return false;
      }

      if (this.options.dryRun) {
        console.log(
          `[DRY RUN] Would write chat: ${chat.chatId} with ${messages.length} messages`
        );
        return true;
      }

      // Write chat record
      const chatCommand = new PutCommand({
        TableName: this.options.chatHistoryTableName,
        Item: chat,
      });

      await this.docClient.send(chatCommand);
      this.progress.writtenChats++;

      // Write messages
      for (const message of messages) {
        const messageCommand = new PutCommand({
          TableName: this.options.chatHistoryTableName,
          Item: message,
        });

        await this.docClient.send(messageCommand);
        this.progress.writtenMessages++;
      }

      return true;
    } catch (error) {
      const errorMsg = `Failed to write chat ${chat.chatId}: ${error instanceof Error ? error.message : String(error)}`;
      this.progress.errors.push(errorMsg);
      console.error(errorMsg);
      return false;
    }
  }

  /**
   * Write chats and messages in batches
   */
  async writeChatsWithMessages(
    chatsWithMessages: Array<{
      chat: Chat & { tenantId: string; assistantId?: string };
      messages: ChatMessage[];
    }>
  ): Promise<void> {
    this.progress.totalChats = chatsWithMessages.length;
    this.progress.totalMessages = chatsWithMessages.reduce(
      (sum, item) => sum + item.messages.length,
      0
    );

    console.log(
      `Writing ${this.progress.totalChats} chats with ${this.progress.totalMessages} messages...`
    );

    for (const { chat, messages } of chatsWithMessages) {
      await this.writeChatWithMessages(chat, messages);

      // Progress reporting
      if (this.progress.writtenChats % 10 === 0) {
        console.log(
          `Progress: ${this.progress.writtenChats}/${this.progress.totalChats} chats, ${this.progress.writtenMessages}/${this.progress.totalMessages} messages written`
        );
      }
    }

    console.log(
      `Completed: ${this.progress.writtenChats}/${this.progress.totalChats} chats, ${this.progress.writtenMessages}/${this.progress.totalMessages} messages written`
    );
  }

  /**
   * Get current progress
   */
  getProgress(): WriteProgress {
    return { ...this.progress };
  }

  /**
   * Create a checkpoint
   */
  createCheckpoint(
    lastProcessedAssistantId?: string,
    lastProcessedChatId?: string
  ): Checkpoint {
    return {
      timestamp: new Date().toISOString(),
      progress: this.getProgress(),
      lastProcessedAssistantId,
      lastProcessedChatId,
    };
  }

  /**
   * Print progress summary
   */
  printProgress(): void {
    console.log('\n=== Migration Write Progress ===\n');
    console.log(
      `Assistants: ${this.progress.writtenAssistants}/${this.progress.totalAssistants}`
    );
    console.log(
      `Chats: ${this.progress.writtenChats}/${this.progress.totalChats}`
    );
    console.log(
      `Messages: ${this.progress.writtenMessages}/${this.progress.totalMessages}`
    );
    console.log(`Errors: ${this.progress.errors.length}`);

    if (this.progress.errors.length > 0) {
      console.log('\nRecent Errors:');
      this.progress.errors.slice(-10).forEach((error) => {
        console.log(`  - ${error}`);
      });
    }

    console.log('\n================================\n');
  }
}
