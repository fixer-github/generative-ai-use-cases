import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/listAssistantMessages';
import { listMessages } from '../../lambda/repository/assistantMessage';
import { getAssistant } from '../../lambda/repository/assistant';
import { Assistant, AssistantMessage, ListAssistantMessagesResponse } from 'generative-ai-use-cases';

// Mock the repositories
jest.mock('../../lambda/repository/assistantMessage');
jest.mock('../../lambda/repository/assistant');

const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedGetAssistant = getAssistant as jest.MockedFunction<typeof getAssistant>;

// Helper function to create APIGatewayProxyEvent
function createAPIGatewayProxyEvent(
  assistantId?: string,
  userId?: string,
  queryParams?: { exclusiveStartKey?: string; limit?: string }
): APIGatewayProxyEvent {
  return {
    pathParameters: assistantId ? { assistantId } : {},
    queryStringParameters: queryParams || undefined,
    requestContext: {
      authorizer: userId
        ? {
            claims: {
              'cognito:username': userId,
            },
          }
        : undefined,
    },
  } as APIGatewayProxyEvent;
}

describe('listAssistantMessages Lambda handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns correct response for valid request', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const mockAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: 'Test Assistant',
      description: 'Test',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567890',
    };

    const mockMessages: AssistantMessage[] = [
      {
        id: `assistant#${assistantId}`,
        createdDate: '1234567891',
        messageId: '1234567891#msg-2',
        assistantId: `assistant#${assistantId}`,
        userId,
        role: 'assistant',
        content: 'Response',
      },
      {
        id: `assistant#${assistantId}`,
        createdDate: '1234567890',
        messageId: '1234567890#msg-1',
        assistantId: `assistant#${assistantId}`,
        userId,
        role: 'user',
        content: 'Question',
      },
    ];

    const expectedResponse: ListAssistantMessagesResponse = {
      messages: mockMessages,
      lastEvaluatedKey: undefined,
    };

    mockedGetAssistant.mockResolvedValue(mockAssistant);
    mockedListMessages.mockResolvedValue(expectedResponse);

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(mockedGetAssistant).toHaveBeenCalledWith(assistantId, expect.any(Object));
    expect(mockedListMessages).toHaveBeenCalledWith(
      assistantId,
      expect.any(Object),
      undefined,
      undefined
    );
    expect(JSON.parse(result.body)).toEqual(expectedResponse);
  });

  test('returns 400 error when assistantId is missing', async () => {
    const userId = 'testUser';

    const result = await handler(createAPIGatewayProxyEvent(undefined, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: 'Missing assistantId' });
    expect(mockedGetAssistant).not.toHaveBeenCalled();
  });

  test('returns 404 error when assistant not found', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    mockedGetAssistant.mockResolvedValue(null);

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ message: 'Assistant not found' });
    expect(mockedListMessages).not.toHaveBeenCalled();
  });

  test('returns 403 error when user does not own the assistant', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const mockAssistant: Assistant = {
      id: 'user#otherUser',
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: 'user#otherUser',
      name: 'Test Assistant',
      description: 'Test',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567890',
    };

    mockedGetAssistant.mockResolvedValue(mockAssistant);

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ message: 'Forbidden' });
    expect(mockedListMessages).not.toHaveBeenCalled();
  });

  test('handles pagination with exclusiveStartKey', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const exclusiveStartKey = 'some-encoded-key';

    const mockAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: 'Test Assistant',
      description: 'Test',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567890',
    };

    const expectedResponse: ListAssistantMessagesResponse = {
      messages: [],
      lastEvaluatedKey: 'next-page-key',
    };

    mockedGetAssistant.mockResolvedValue(mockAssistant);
    mockedListMessages.mockResolvedValue(expectedResponse);

    const result = await handler(
      createAPIGatewayProxyEvent(assistantId, userId, { exclusiveStartKey })
    );

    expect(result.statusCode).toBe(200);
    expect(mockedListMessages).toHaveBeenCalledWith(
      assistantId,
      expect.any(Object),
      exclusiveStartKey,
      undefined
    );
    expect(JSON.parse(result.body)).toEqual(expectedResponse);
  });

  test('respects custom limit parameter', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const limit = '50';

    const mockAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: 'Test Assistant',
      description: 'Test',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567890',
    };

    const expectedResponse: ListAssistantMessagesResponse = {
      messages: [],
      lastEvaluatedKey: undefined,
    };

    mockedGetAssistant.mockResolvedValue(mockAssistant);
    mockedListMessages.mockResolvedValue(expectedResponse);

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId, { limit }));

    expect(result.statusCode).toBe(200);
    expect(mockedListMessages).toHaveBeenCalledWith(
      assistantId,
      expect.any(Object),
      undefined,
      50
    );
  });

  test('returns empty list when no messages exist', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const mockAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: 'Test Assistant',
      description: 'Test',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567890',
    };

    const expectedResponse: ListAssistantMessagesResponse = {
      messages: [],
      lastEvaluatedKey: undefined,
    };

    mockedGetAssistant.mockResolvedValue(mockAssistant);
    mockedListMessages.mockResolvedValue(expectedResponse);

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expectedResponse);
  });

  test('returns 500 error when an exception occurs', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedGetAssistant.mockRejectedValue(new Error('Test error'));

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
