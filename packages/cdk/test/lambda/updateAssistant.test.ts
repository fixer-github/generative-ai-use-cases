import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/updateAssistant';
import { updateAssistant } from '../../lambda/repository/assistant';
import { Assistant, UpdateAssistantRequest } from 'generative-ai-use-cases';
import { loadDocumentsFromS3, chunkDocuments, addMetadata } from '../../lambda/utils/documentLoader';
import { indexDocuments, deleteAssistantDocuments } from '../../lambda/repository/assistantSearch';

// Mock the repository
jest.mock('../../lambda/repository/assistant');
const mockedUpdateAssistant = updateAssistant as jest.MockedFunction<typeof updateAssistant>;

// Mock the document loader and search utilities
jest.mock('../../lambda/utils/documentLoader');
jest.mock('../../lambda/repository/assistantSearch');

const mockedLoadDocumentsFromS3 = loadDocumentsFromS3 as jest.MockedFunction<typeof loadDocumentsFromS3>;
const mockedChunkDocuments = chunkDocuments as jest.MockedFunction<typeof chunkDocuments>;
const mockedAddMetadata = addMetadata as jest.MockedFunction<typeof addMetadata>;
const mockedIndexDocuments = indexDocuments as jest.MockedFunction<typeof indexDocuments>;
const mockedDeleteAssistantDocuments = deleteAssistantDocuments as jest.MockedFunction<typeof deleteAssistantDocuments>;

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

describe('updateAssistant Lambda handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns correct response for valid request', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
      description: 'Updated description',
    };

    const updatedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: requestBody.name!,
      description: requestBody.description!,
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567900',
    };

    mockedUpdateAssistant.mockResolvedValue(updatedAssistant);

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(mockedUpdateAssistant).toHaveBeenCalledWith(
      assistantId,
      userId,
      requestBody,
      expect.any(Object)
    );
    expect(JSON.parse(result.body)).toEqual(updatedAssistant);
  });

  test('returns 400 error when assistantId is missing', async () => {
    const userId = 'testUser';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
    };

    const result = await handler(createAPIGatewayProxyEvent(requestBody, undefined, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: 'Missing assistantId' });
    expect(mockedUpdateAssistant).not.toHaveBeenCalled();
  });

  test('returns 404 error when assistant not found', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
    };

    mockedUpdateAssistant.mockRejectedValue(new Error('Assistant not found'));

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ message: 'Assistant not found' });
  });

  test('returns 403 error when user is not owner', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
    };

    mockedUpdateAssistant.mockRejectedValue(new Error('Unauthorized'));

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ message: 'Forbidden' });
  });

  test('updates multiple fields successfully', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
      description: 'Updated description',
      instruction: 'Updated instruction',
      modelId: 'anthropic.claude-3',
      ragEnabled: true,
      s3Urls: ['s3://bucket/newfile.pdf'],
    };

    const updatedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: requestBody.name!,
      description: requestBody.description!,
      instruction: requestBody.instruction!,
      modelId: requestBody.modelId!,
      ragEnabled: requestBody.ragEnabled!,
      syncStatus: 'QUEUED',
      syncStatusReason: '',
      s3Urls: requestBody.s3Urls!,
      updatedDate: '1234567900',
    };

    const mockDocuments = [{ pageContent: 'updated content', metadata: {} }];
    const mockChunks = [{ pageContent: 'updated chunk', metadata: {} }];
    const mockDocsWithMetadata = [
      { pageContent: 'updated chunk', metadata: { assistantId, userId } },
    ];

    mockedUpdateAssistant.mockResolvedValue(updatedAssistant);
    mockedDeleteAssistantDocuments.mockResolvedValue(undefined);
    mockedLoadDocumentsFromS3.mockResolvedValue(mockDocuments);
    mockedChunkDocuments.mockResolvedValue(mockChunks);
    mockedAddMetadata.mockReturnValue(mockDocsWithMetadata);
    mockedIndexDocuments.mockResolvedValue(undefined);

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(updatedAssistant);

    // Verify RAG re-indexing functions were called
    expect(mockedDeleteAssistantDocuments).toHaveBeenCalledWith(assistantId);
    expect(mockedLoadDocumentsFromS3).toHaveBeenCalledWith(requestBody.s3Urls);
    expect(mockedChunkDocuments).toHaveBeenCalledWith(mockDocuments, 1000, 200);
    expect(mockedAddMetadata).toHaveBeenCalledWith(mockChunks, assistantId, userId);
    expect(mockedIndexDocuments).toHaveBeenCalledWith(assistantId, mockDocsWithMetadata);
  });

  test('handles RAG re-indexing errors gracefully', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
      ragEnabled: true,
      s3Urls: ['s3://bucket/newfile.pdf'],
    };

    const updatedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: requestBody.name!,
      description: 'Existing description',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: requestBody.ragEnabled!,
      syncStatus: 'QUEUED',
      syncStatusReason: '',
      s3Urls: requestBody.s3Urls!,
      updatedDate: '1234567900',
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedUpdateAssistant.mockResolvedValue(updatedAssistant);
    mockedDeleteAssistantDocuments.mockRejectedValue(new Error('Delete failed'));

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    // Should still return success even if re-indexing fails
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(updatedAssistant);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error re-indexing documents:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  test('handles empty request body', async () => {
    const userId = 'testUser';
    const assistantId = '123';

    const updatedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: `assistant#${assistantId}`,
      userId: `user#${userId}`,
      name: 'Existing Name',
      description: 'Existing description',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
      syncStatus: 'SUCCEEDED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567900',
    };

    mockedUpdateAssistant.mockResolvedValue(updatedAssistant);

    const result = await handler(createAPIGatewayProxyEvent({}, assistantId, userId));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(updatedAssistant);
  });

  test('returns 500 error when an unexpected exception occurs', async () => {
    const userId = 'testUser';
    const assistantId = '123';
    const requestBody: UpdateAssistantRequest = {
      name: 'Updated Name',
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedUpdateAssistant.mockRejectedValue(new Error('Unexpected error'));

    const result = await handler(createAPIGatewayProxyEvent(requestBody, assistantId, userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
