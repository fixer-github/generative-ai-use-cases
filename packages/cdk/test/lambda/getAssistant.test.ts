import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/getAssistant';
import { getAssistant } from '../../lambda/repository/assistant';
import { Assistant } from 'generative-ai-use-cases';

// Mock the repository
jest.mock('../../lambda/repository/assistant');
const mockedGetAssistant = getAssistant as jest.MockedFunction<typeof getAssistant>;

// Helper function to create APIGatewayProxyEvent
function createAPIGatewayProxyEvent(
  assistantId?: string,
  userId?: string
): APIGatewayProxyEvent {
  return {
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

describe('getAssistant Lambda handler', () => {
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
      description: 'A test assistant',
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

    expect(result.statusCode).toBe(200);
    expect(mockedGetAssistant).toHaveBeenCalledWith(assistantId, expect.any(Object));
    expect(JSON.parse(result.body)).toEqual(mockAssistant);
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
      description: 'A test assistant',
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
  });

  test('returns 500 error when an exception occurs', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedGetAssistant.mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
