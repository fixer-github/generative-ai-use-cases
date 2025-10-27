import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/deleteAssistant';
import { deleteAssistant } from '../../lambda/repository/assistant';
import { deleteMessagesForAssistant } from '../../lambda/repository/assistantMessage';
import { deleteAssistantDocuments } from '../../lambda/repository/assistantSearch';

// Mock the repositories
jest.mock('../../lambda/repository/assistant');
jest.mock('../../lambda/repository/assistantMessage');
jest.mock('../../lambda/repository/assistantSearch');

const mockedDeleteAssistant = deleteAssistant as jest.MockedFunction<typeof deleteAssistant>;
const mockedDeleteMessagesForAssistant = deleteMessagesForAssistant as jest.MockedFunction<
  typeof deleteMessagesForAssistant
>;
const mockedDeleteAssistantDocuments = deleteAssistantDocuments as jest.MockedFunction<
  typeof deleteAssistantDocuments
>;

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

describe('deleteAssistant Lambda handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns correct response for valid request', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    mockedDeleteAssistant.mockResolvedValue(undefined);
    mockedDeleteMessagesForAssistant.mockResolvedValue(undefined);
    mockedDeleteAssistantDocuments.mockResolvedValue(undefined);

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(mockedDeleteAssistant).toHaveBeenCalledWith(assistantId, userId, expect.any(Object));
    expect(mockedDeleteMessagesForAssistant).toHaveBeenCalledWith(assistantId, expect.any(Object));
    expect(mockedDeleteAssistantDocuments).toHaveBeenCalledWith(assistantId);
  });

  test('returns 400 error when assistantId is missing', async () => {
    const userId = 'testUser';

    const result = await handler(createAPIGatewayProxyEvent(undefined, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: 'Missing assistantId' });
    expect(mockedDeleteAssistant).not.toHaveBeenCalled();
  });

  test('returns 404 error when assistant not found', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    mockedDeleteAssistant.mockRejectedValue(new Error('Assistant not found'));

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ message: 'Assistant not found' });
    expect(mockedDeleteMessagesForAssistant).not.toHaveBeenCalled();
  });

  test('returns 403 error when user is not owner', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    mockedDeleteAssistant.mockRejectedValue(new Error('Unauthorized'));

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ message: 'Forbidden' });
    expect(mockedDeleteMessagesForAssistant).not.toHaveBeenCalled();
  });

  test('continues deletion even if OpenSearch cleanup fails', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedDeleteAssistant.mockResolvedValue(undefined);
    mockedDeleteMessagesForAssistant.mockResolvedValue(undefined);
    mockedDeleteAssistantDocuments.mockRejectedValue(new Error('OpenSearch error'));

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error deleting OpenSearch documents:',
      expect.any(Error)
    );

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('returns 500 error when an unexpected exception occurs', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedDeleteAssistant.mockRejectedValue(new Error('Unexpected error'));

    const result = await handler(createAPIGatewayProxyEvent(assistantId, userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
