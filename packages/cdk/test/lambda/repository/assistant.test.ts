import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  createAssistant,
  listAssistants,
  getAssistant,
  updateAssistant,
  deleteAssistant,
} from '../../../lambda/repository/assistant';
import {
  getTenantDynamoDBDocument,
  getAssistantTableName,
} from '../../../lambda/repository/common';
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Assistant, CreateAssistantRequest, UpdateAssistantRequest } from 'generative-ai-use-cases';

// Mock the common module
jest.mock('../../../lambda/repository/common');
const mockedGetTenantDynamoDBDocument = getTenantDynamoDBDocument as jest.MockedFunction<
  typeof getTenantDynamoDBDocument
>;
const mockedGetAssistantTableName = getAssistantTableName as jest.MockedFunction<
  typeof getAssistantTableName
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

describe('assistant repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedGetTenantDynamoDBDocument.mockResolvedValue(mockDynamoDBClient);
    mockedGetAssistantTableName.mockReturnValue('test-assistant-table');
  });

  describe('createAssistant', () => {
    test('creates assistant with all required fields', async () => {
      const userId = 'testUser';
      const data: CreateAssistantRequest = {
        name: 'Test Assistant',
        description: 'A test assistant',
        instruction: 'You are a helpful assistant',
        modelId: 'anthropic.claude-v2',
        ragEnabled: true,
        s3Urls: ['s3://bucket/file.pdf'],
      };
      const event = createMockEvent();

      mockSend.mockResolvedValue({});

      const result = await createAssistant(userId, data, event);

      expect(result).toMatchObject({
        id: 'user#testUser',
        userId: 'user#testUser',
        name: data.name,
        description: data.description,
        instruction: data.instruction,
        modelId: data.modelId,
        ragEnabled: data.ragEnabled,
        s3Urls: data.s3Urls,
        syncStatus: 'QUEUED',
        syncStatusReason: '',
      });
      expect(result.assistantId).toMatch(/^assistant#/);
      expect(result.createdDate).toBeDefined();
      expect(result.updatedDate).toBeDefined();

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-table',
            Item: expect.objectContaining({
              name: data.name,
              userId: 'user#testUser',
            }),
          }),
        })
      );
    });

    test('creates assistant without optional s3Urls', async () => {
      const userId = 'testUser';
      const data: CreateAssistantRequest = {
        name: 'Test Assistant',
        description: 'A test assistant',
        instruction: 'You are a helpful assistant',
        modelId: 'anthropic.claude-v2',
        ragEnabled: false,
      };
      const event = createMockEvent();

      mockSend.mockResolvedValue({});

      const result = await createAssistant(userId, data, event);

      expect(result.s3Urls).toEqual([]);
    });

    test('propagates DynamoDB errors', async () => {
      const userId = 'testUser';
      const data: CreateAssistantRequest = {
        name: 'Test Assistant',
        description: 'A test assistant',
        instruction: 'You are a helpful assistant',
        modelId: 'anthropic.claude-v2',
        ragEnabled: false,
      };
      const event = createMockEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(createAssistant(userId, data, event)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('listAssistants', () => {
    test('lists assistants for user', async () => {
      const userId = 'testUser';
      const event = createMockEvent();

      const mockAssistants: Assistant[] = [
        {
          id: 'user#testUser',
          createdDate: '1234567890',
          assistantId: 'assistant#123',
          userId: 'user#testUser',
          name: 'Assistant 1',
          description: 'First assistant',
          instruction: 'Help with tasks',
          modelId: 'anthropic.claude-v2',
          ragEnabled: false,
          syncStatus: 'SUCCEEDED',
          syncStatusReason: '',
          knowledgeSources: [],
          s3Urls: [],
          updatedDate: '1234567890',
        },
        {
          id: 'user#testUser',
          createdDate: '1234567891',
          assistantId: 'assistant#456',
          userId: 'user#testUser',
          name: 'Assistant 2',
          description: 'Second assistant',
          instruction: 'Help with more tasks',
          modelId: 'anthropic.claude-v2',
          ragEnabled: true,
          syncStatus: 'QUEUED',
          syncStatusReason: '',
          knowledgeSources: [],
          s3Urls: ['s3://bucket/file.pdf'],
          updatedDate: '1234567891',
        },
      ];

      mockSend.mockResolvedValue({
        Items: mockAssistants,
        LastEvaluatedKey: undefined,
      });

      const result = await listAssistants(userId, event);

      expect(result.assistants).toEqual(mockAssistants);
      expect(result.lastEvaluatedKey).toBeUndefined();

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-table',
            KeyConditionExpression: '#userId = :userId',
            ExpressionAttributeValues: {
              ':userId': 'user#testUser',
            },
            ScanIndexForward: false,
            Limit: 100,
          }),
        })
      );
    });

    test('handles pagination with exclusiveStartKey', async () => {
      const userId = 'testUser';
      const event = createMockEvent();
      const exclusiveStartKey = Buffer.from(
        JSON.stringify({ userId: 'user#testUser', createdDate: '1234567890' })
      ).toString('base64');

      mockSend.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: { userId: 'user#testUser', createdDate: '1234567900' },
      });

      const result = await listAssistants(userId, event, exclusiveStartKey);

      expect(result.lastEvaluatedKey).toBeDefined();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ExclusiveStartKey: { userId: 'user#testUser', createdDate: '1234567890' },
          }),
        })
      );
    });

    test('propagates DynamoDB errors', async () => {
      const userId = 'testUser';
      const event = createMockEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(listAssistants(userId, event)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('getAssistant', () => {
    test('retrieves assistant by ID', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      const mockAssistant: Assistant = {
        id: 'user#testUser',
        createdDate: '1234567890',
        assistantId: 'assistant#123',
        userId: 'user#testUser',
        name: 'Test Assistant',
        description: 'A test assistant',
        instruction: 'You are helpful',
        modelId: 'anthropic.claude-v2',
        ragEnabled: false,
        syncStatus: 'SUCCEEDED',
        syncStatusReason: '',
        knowledgeSources: [],
        s3Urls: [],
        updatedDate: '1234567890',
      };

      mockSend.mockResolvedValue({
        Items: [mockAssistant],
      });

      const result = await getAssistant(assistantId, event);

      expect(result).toEqual(mockAssistant);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-table',
            IndexName: 'AssistantIdIndex',
            KeyConditionExpression: '#assistantId = :assistantId',
            ExpressionAttributeValues: {
              ':assistantId': 'assistant#123',
            },
          }),
        })
      );
    });

    test('returns null when assistant not found', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      mockSend.mockResolvedValue({
        Items: [],
      });

      const result = await getAssistant(assistantId, event);

      expect(result).toBeNull();
    });

    test('propagates DynamoDB errors', async () => {
      const assistantId = '123';
      const event = createMockEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(getAssistant(assistantId, event)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('updateAssistant', () => {
    const existingAssistant: Assistant = {
      id: 'user#testUser',
      createdDate: '1234567890',
      assistantId: 'assistant#123',
      userId: 'user#testUser',
      name: 'Original Name',
      description: 'Original description',
      instruction: 'Original instruction',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      knowledgeSources: [],
      s3Urls: [],
      updatedDate: '1234567890',
    };

    test('updates assistant fields', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const updates: UpdateAssistantRequest = {
        name: 'Updated Name',
        description: 'Updated description',
      };
      const event = createMockEvent();

      // Mock getAssistant call
      mockSend
        .mockResolvedValueOnce({
          Items: [existingAssistant],
        })
        // Mock updateCommand call
        .mockResolvedValueOnce({
          Attributes: {
            ...existingAssistant,
            ...updates,
            updatedDate: '1234567900',
          },
        });

      const result = await updateAssistant(assistantId, userId, updates, event);

      expect(result.name).toBe(updates.name);
      expect(result.description).toBe(updates.description);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('throws error when assistant not found', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const updates: UpdateAssistantRequest = { name: 'Updated Name' };
      const event = createMockEvent();

      mockSend.mockResolvedValue({
        Items: [],
      });

      await expect(updateAssistant(assistantId, userId, updates, event)).rejects.toThrow(
        'Assistant not found'
      );
    });

    test('throws error when user is not owner', async () => {
      const assistantId = '123';
      const userId = 'otherUser';
      const updates: UpdateAssistantRequest = { name: 'Updated Name' };
      const event = createMockEvent();

      mockSend.mockResolvedValue({
        Items: [existingAssistant],
      });

      await expect(updateAssistant(assistantId, userId, updates, event)).rejects.toThrow(
        'Unauthorized'
      );
    });

    test('updates multiple fields including ragEnabled and s3Urls', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const updates: UpdateAssistantRequest = {
        ragEnabled: true,
        s3Urls: ['s3://bucket/newfile.pdf'],
        instruction: 'New instruction',
      };
      const event = createMockEvent();

      mockSend
        .mockResolvedValueOnce({
          Items: [existingAssistant],
        })
        .mockResolvedValueOnce({
          Attributes: {
            ...existingAssistant,
            ...updates,
            updatedDate: '1234567900',
          },
        });

      const result = await updateAssistant(assistantId, userId, updates, event);

      expect(result.ragEnabled).toBe(true);
      expect(result.s3Urls).toEqual(updates.s3Urls);
      expect(result.instruction).toBe(updates.instruction);
    });

    test('propagates DynamoDB errors', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const updates: UpdateAssistantRequest = { name: 'Updated Name' };
      const event = createMockEvent();

      mockSend
        .mockResolvedValueOnce({
          Items: [existingAssistant],
        })
        .mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(updateAssistant(assistantId, userId, updates, event)).rejects.toThrow(
        'DynamoDB error'
      );
    });
  });

  describe('deleteAssistant', () => {
    const existingAssistant: Assistant = {
      id: 'user#testUser',
      createdDate: '1234567890',
      assistantId: 'assistant#123',
      userId: 'user#testUser',
      name: 'Test Assistant',
      description: 'Test description',
      instruction: 'Test instruction',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      knowledgeSources: [],
      s3Urls: [],
      updatedDate: '1234567890',
    };

    test('deletes assistant successfully', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const event = createMockEvent();

      // Mock getAssistant call
      mockSend
        .mockResolvedValueOnce({
          Items: [existingAssistant],
        })
        // Mock deleteCommand call
        .mockResolvedValueOnce({});

      await deleteAssistant(assistantId, userId, event);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-assistant-table',
            Key: {
              userId: existingAssistant.id,
              createdDate: existingAssistant.createdDate,
            },
          }),
        })
      );
    });

    test('throws error when assistant not found', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const event = createMockEvent();

      mockSend.mockResolvedValue({
        Items: [],
      });

      await expect(deleteAssistant(assistantId, userId, event)).rejects.toThrow(
        'Assistant not found'
      );
    });

    test('throws error when user is not owner', async () => {
      const assistantId = '123';
      const userId = 'otherUser';
      const event = createMockEvent();

      mockSend.mockResolvedValue({
        Items: [existingAssistant],
      });

      await expect(deleteAssistant(assistantId, userId, event)).rejects.toThrow('Unauthorized');
    });

    test('propagates DynamoDB errors', async () => {
      const assistantId = '123';
      const userId = 'testUser';
      const event = createMockEvent();

      mockSend
        .mockResolvedValueOnce({
          Items: [existingAssistant],
        })
        .mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(deleteAssistant(assistantId, userId, event)).rejects.toThrow('DynamoDB error');
    });
  });
});
