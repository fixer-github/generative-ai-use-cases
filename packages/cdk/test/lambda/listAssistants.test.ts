import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/listAssistants';
import { listAssistants } from '../../lambda/repository/assistant';
import { Assistant, ListAssistantsResponse } from 'generative-ai-use-cases';

// Mock the repository
jest.mock('../../lambda/repository/assistant');
const mockedListAssistants = listAssistants as jest.MockedFunction<typeof listAssistants>;

// Helper function to create APIGatewayProxyEvent
function createAPIGatewayProxyEvent(
  userId?: string,
  exclusiveStartKey?: string
): APIGatewayProxyEvent {
  return {
    body: null,
    queryStringParameters: exclusiveStartKey ? { exclusiveStartKey } : undefined,
    pathParameters: null,
    requestContext: {
      authorizer: userId
        ? {
            claims: {
              'cognito:username': userId,
            },
          }
        : undefined,
    },
  } as unknown as APIGatewayProxyEvent;
}

describe('listAssistants Lambda handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns correct response for valid request', async () => {
    const userId = 'testUser';
    const mockAssistants: Assistant[] = [
      {
        id: `user#${userId}`,
        createdDate: '1234567890',
        assistantId: 'assistant#123',
        userId: `user#${userId}`,
        name: 'Assistant 1',
        description: 'First assistant',
        instruction: 'You are helpful',
        modelId: 'anthropic.claude-v2',
        ragEnabled: false,
        syncStatus: 'SUCCEEDED',
        syncStatusReason: '',
        s3Urls: [],
        updatedDate: '1234567890',
      },
      {
        id: `user#${userId}`,
        createdDate: '1234567891',
        assistantId: 'assistant#456',
        userId: `user#${userId}`,
        name: 'Assistant 2',
        description: 'Second assistant',
        instruction: 'You are very helpful',
        modelId: 'anthropic.claude-v2',
        ragEnabled: true,
        syncStatus: 'QUEUED',
        syncStatusReason: '',
        s3Urls: ['s3://bucket/file.pdf'],
        updatedDate: '1234567891',
      },
    ];

    const expectedResponse: ListAssistantsResponse = {
      assistants: mockAssistants,
      lastEvaluatedKey: undefined,
    };

    mockedListAssistants.mockResolvedValue(expectedResponse);

    const result = await handler(createAPIGatewayProxyEvent(userId));

    expect(result.statusCode).toBe(200);
    expect(mockedListAssistants).toHaveBeenCalledWith(userId, expect.any(Object), undefined);
    expect(JSON.parse(result.body)).toEqual(expectedResponse);
  });

  test('handles pagination with exclusiveStartKey', async () => {
    const userId = 'testUser';
    const exclusiveStartKey = 'some-encoded-key';

    const expectedResponse: ListAssistantsResponse = {
      assistants: [],
      lastEvaluatedKey: 'next-page-key',
    };

    mockedListAssistants.mockResolvedValue(expectedResponse);

    const result = await handler(createAPIGatewayProxyEvent(userId, exclusiveStartKey));

    expect(result.statusCode).toBe(200);
    expect(mockedListAssistants).toHaveBeenCalledWith(userId, expect.any(Object), exclusiveStartKey);
    expect(JSON.parse(result.body)).toEqual(expectedResponse);
  });

  test('returns empty list when user has no assistants', async () => {
    const userId = 'testUser';

    const expectedResponse: ListAssistantsResponse = {
      assistants: [],
      lastEvaluatedKey: undefined,
    };

    mockedListAssistants.mockResolvedValue(expectedResponse);

    const result = await handler(createAPIGatewayProxyEvent(userId));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expectedResponse);
  });

  test('returns 500 error when an exception occurs', async () => {
    const userId = 'testUser';

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedListAssistants.mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await handler(createAPIGatewayProxyEvent(userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
