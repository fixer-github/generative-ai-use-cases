import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  createMessage,
  listMessages,
  deleteMessagesForAssistant,
} from '../../../lambda/repository/assistantMessage';
import {
  getTenantDynamoDBDocument,
  getAssistantMessagesTableName,
} from '../../../lambda/repository/common';
import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { AssistantMessage, AssistantMessageSource } from 'generative-ai-use-cases';

// Mock the common module
jest.mock('../../../lambda/repository/common');
const mockedGetTenantDynamoDBDocument = getTenantDynamoDBDocument as jest.MockedFunction<
  typeof getTenantDynamoDBDocument
>;
const mockedGetAssistantMessagesTableName = getAssistantMessagesTableName as jest.MockedFunction<
  typeof getAssistantMessagesTableName
>;

// Create mock DynamoDB client
const mockSend = jest.fn();
const mockDynamoDBClient = {
  send: mockSend,
} as any;

// Helper to create a mock event
function createMockEvent(): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: {
        claims: {
          'cognito:username': 'testUser',
        },
      },
    },
  } as any;
}

describe('assistantMessage repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedGetTenantDynamoDBDocument.mockResolvedValue(mockDynamoDBClient);
    mockedGetAssistantMessagesTableName.mockReturnValue('test-assistant-messages-table');
  });

  describe('createMessage', () => {
    test('creates user message without sources', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const role = 'user';
      const content = 'Hello, assistant!';
      const event = createMockEvent();

      mockSend.mockResolvedValue({});

      const result = await createMessage(assistantId, userId, role, content, undefined, undefined, event);

      expect(result).toMatchObject({
        id: 'assistant#123',
        assistantId: 'assistant#123',
        userId,
        role,
        content,
      });
      expect(result.messageId).toMatch(/^\d+#/);
      expect(result.createdDate).toBeDefined();
      expect(result.sources).toBeUndefined();
      expect(result.metadata).toBeUndefined();

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-messages-table',
            Item: expect.objectContaining({
              assistantId: 'assistant#123',
              userId,
              role,
              content,
            }),
          }),
        })
      );
    });

    test('creates assistant message with sources and metadata', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const role = 'assistant';
      const content = 'Here is the answer';
      const sources: AssistantMessageSource[] = [
        {
          content: 'Source content',
          contentType: 'text/plain',
          excerpt: 'Excerpt',
          s3Url: 's3://bucket/file.pdf',
          sourceId: 'test-source-id',
          sourceType: 'web',
        },
      ];
      const metadata = {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      };
      const event = createMockEvent();

      mockSend.mockResolvedValue({});

      const result = await createMessage(assistantId, userId, role, content, sources, metadata, event);

      expect(result).toMatchObject({
        id: 'assistant#123',
        assistantId: 'assistant#123',
        userId,
        role,
        content,
        sources,
        metadata,
      });
    });

    test('propagates DynamoDB errors', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const role = 'user';
      const content = 'Hello';
      const event = createMockEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(
        createMessage(assistantId, userId, role, content, undefined, undefined, event)
      ).rejects.toThrow('DynamoDB error');
    });
  });

  describe('listMessages', () => {
    test('lists messages for assistant', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      const mockMessages: AssistantMessage[] = [
        {
          id: 'assistant#123',
          createdDate: '1234567891',
          messageId: '1234567891#msg-456',
          assistantId: 'assistant#123',
          userId: 'testUser',
          role: 'assistant',
          content: 'Response',
        },
        {
          id: 'assistant#123',
          createdDate: '1234567890',
          messageId: '1234567890#msg-123',
          assistantId: 'assistant#123',
          userId: 'testUser',
          role: 'user',
          content: 'Question',
        },
      ];

      mockSend.mockResolvedValue({
        Items: mockMessages,
        LastEvaluatedKey: undefined,
      });

      const result = await listMessages(assistantId, event);

      expect(result.messages).toEqual(mockMessages);
      expect(result.lastEvaluatedKey).toBeUndefined();

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-messages-table',
            KeyConditionExpression: '#assistantId = :assistantId',
            ExpressionAttributeValues: {
              ':assistantId': 'assistant#123',
            },
            ScanIndexForward: false,
            Limit: 100,
          }),
        })
      );
    });

    test('handles pagination with exclusiveStartKey', async () => {
      const assistantId = '123';
      const event = createMockEvent();
      const exclusiveStartKey = Buffer.from(
        JSON.stringify({ assistantId: 'assistant#123', messageId: '1234567890#msg-123' })
      ).toString('base64');

      mockSend.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: { assistantId: 'assistant#123', messageId: '1234567900#msg-999' },
      });

      const result = await listMessages(assistantId, event, exclusiveStartKey);

      expect(result.lastEvaluatedKey).toBeDefined();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ExclusiveStartKey: { assistantId: 'assistant#123', messageId: '1234567890#msg-123' },
          }),
        })
      );
    });

    test('respects custom limit parameter', async () => {
      const assistantId = '123';
      const event = createMockEvent();
      const limit = 50;

      mockSend.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      await listMessages(assistantId, event, undefined, limit);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Limit: 50,
          }),
        })
      );
    });

    test('propagates DynamoDB errors', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(listMessages(assistantId, event)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('deleteMessagesForAssistant', () => {
    test('deletes all messages for assistant', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      const mockMessages = [
        {
          assistantId: 'assistant#123',
          messageId: '1234567890#msg-1',
          content: 'Message 1',
        },
        {
          assistantId: 'assistant#123',
          messageId: '1234567891#msg-2',
          content: 'Message 2',
        },
      ];

      // First query returns messages, second query returns no more messages
      mockSend
        .mockResolvedValueOnce({
          Items: mockMessages,
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValue({}); // Delete commands

      await deleteMessagesForAssistant(assistantId, event);

      // Should query once + delete twice
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify query
      expect(mockSend).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-messages-table',
            KeyConditionExpression: '#assistantId = :assistantId',
          }),
        })
      );

      // Verify deletes
      expect(mockSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-messages-table',
            Key: {
              assistantId: 'assistant#123',
              messageId: '1234567890#msg-1',
            },
          }),
        })
      );

      expect(mockSend).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-messages-table',
            Key: {
              assistantId: 'assistant#123',
              messageId: '1234567891#msg-2',
            },
          }),
        })
      );
    });

    test('handles pagination when deleting messages', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      const firstBatch = [
        {
          assistantId: 'assistant#123',
          messageId: '1234567890#msg-1',
        },
      ];

      const secondBatch = [
        {
          assistantId: 'assistant#123',
          messageId: '1234567891#msg-2',
        },
      ];

      // First query returns messages with LastEvaluatedKey
      // Second query returns more messages without LastEvaluatedKey
      mockSend
        .mockResolvedValueOnce({
          Items: firstBatch,
          LastEvaluatedKey: { assistantId: 'assistant#123', messageId: '1234567890#msg-1' },
        })
        .mockResolvedValueOnce({}) // First delete
        .mockResolvedValueOnce({
          Items: secondBatch,
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({}); // Second delete

      await deleteMessagesForAssistant(assistantId, event);

      // Should query twice + delete twice
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    test('handles empty message list', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      mockSend.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      await deleteMessagesForAssistant(assistantId, event);

      // Should only query once, no deletes
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('propagates DynamoDB errors', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(deleteMessagesForAssistant(assistantId, event)).rejects.toThrow('DynamoDB error');
    });
  });
});
