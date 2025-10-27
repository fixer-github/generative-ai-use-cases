import { APIGatewayProxyEvent } from 'aws-lambda';
import { Assistant, AssistantMessage } from 'generative-ai-use-cases';

// Mock Bedrock client BEFORE importing handler
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  ConverseCommand: jest.fn(),
}));

// Mock the repositories
jest.mock('../../lambda/repository/assistant');
jest.mock('../../lambda/repository/assistantMessage');
jest.mock('../../lambda/repository/assistantSearch');

// Import after mocks are set up
import { handler } from '../../lambda/createAssistantMessage';
import { getAssistant } from '../../lambda/repository/assistant';
import { createMessage } from '../../lambda/repository/assistantMessage';
import { similaritySearch } from '../../lambda/repository/assistantSearch';

const mockedGetAssistant = getAssistant as jest.MockedFunction<typeof getAssistant>;
const mockedCreateMessage = createMessage as jest.MockedFunction<typeof createMessage>;
const mockedSimilaritySearch = similaritySearch as jest.MockedFunction<typeof similaritySearch>;

// Helper function to create APIGatewayProxyEvent
function createAPIGatewayProxyEvent(
  body: unknown | null,
  assistantId?: string,
  userId?: string
): APIGatewayProxyEvent {
  return {
    body: body ? JSON.stringify(body) : null,
    pathParameters: assistantId ? { assistantId } : {},
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

describe('createAssistantMessage Lambda handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns correct response for valid request without RAG', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody = {
      content: 'Hello, assistant!',
    };

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

    const mockAssistantMessage: AssistantMessage = {
      id: `assistant#${assistantId}`,
      createdDate: '1234567891',
      messageId: '1234567891#msg-123',
      assistantId: `assistant#${assistantId}`,
      userId,
      role: 'assistant',
      content: 'Hello, user!',
      metadata: {
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    };

    mockedGetAssistant.mockResolvedValue(mockAssistant);
    mockedCreateMessage.mockResolvedValueOnce({
      id: `assistant#${assistantId}`,
      createdDate: '1234567890',
      messageId: '1234567890#msg-122',
      assistantId: `assistant#${assistantId}`,
      userId,
      role: 'user',
      content: requestBody.content,
    });
    mockedCreateMessage.mockResolvedValueOnce(mockAssistantMessage);

    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [{ text: 'Hello, user!' }],
        },
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(mockedGetAssistant).toHaveBeenCalledWith(assistantId, expect.any(Object));
    expect(mockedCreateMessage).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.body)).toEqual(mockAssistantMessage);
  });

  test('returns 400 error when assistantId is missing', async () => {
    const userId = 'testUser';
    const requestBody = {
      content: 'Hello',
    };

    const result = await handler(createAPIGatewayProxyEvent(requestBody, undefined, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: 'Missing assistantId' });
    expect(mockedGetAssistant).not.toHaveBeenCalled();
  });

  test('returns 400 error when content is missing', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody = {};

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: 'Missing content' });
  });

  test('returns 404 error when assistant not found', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody = {
      content: 'Hello',
    };

    mockedGetAssistant.mockResolvedValue(null);

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ message: 'Assistant not found' });
  });

  test('returns 403 error when user does not own the assistant', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody = {
      content: 'Hello',
    };

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

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ message: 'Forbidden' });
  });

  test('includes RAG context when ragEnabled is true', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody = {
      content: 'What is in the document?',
    };

    const mockAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: 'RAG Assistant',
      description: 'Test',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: true,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: ['s3://bucket/file.pdf'],
      updatedDate: '1234567890',
    };

    const mockDocs = [
      {
        pageContent: 'Document content here',
        metadata: {
          s3Url: 's3://bucket/file.pdf',
          contentType: 'application/pdf',
        },
      },
    ];

    mockedGetAssistant.mockResolvedValue(mockAssistant);
    mockedSimilaritySearch.mockResolvedValue(mockDocs);
    mockedCreateMessage.mockResolvedValue({
      id: `assistant#${assistantId}`,
      createdDate: '1234567891',
      messageId: '1234567891#msg-123',
      assistantId: `assistant#${assistantId}`,
      userId,
      role: 'assistant',
      content: 'Based on the document...',
      sources: [
        {
          content: 'Document content here',
          contentType: 'application/pdf',
          excerpt: 'Document content here',
          s3Url: 's3://bucket/file.pdf',
        },
      ],
      metadata: {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      },
    });

    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [{ text: 'Based on the document...' }],
        },
      },
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    });

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(mockedSimilaritySearch).toHaveBeenCalledWith(assistantId, requestBody.content, 5);
    const response = JSON.parse(result.body);
    expect(response.sources).toBeDefined();
    expect(response.sources).toHaveLength(1);
  });

  test('returns 500 error when an exception occurs', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody = {
      content: 'Hello',
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedGetAssistant.mockRejectedValue(new Error('Test error'));

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
