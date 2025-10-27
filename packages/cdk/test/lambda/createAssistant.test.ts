import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/createAssistant';
import { createAssistant } from '../../lambda/repository/assistant';
import { Assistant } from 'generative-ai-use-cases';
import { loadDocumentsFromS3, chunkDocuments, addMetadata } from '../../lambda/utils/documentLoader';
import { indexDocuments } from '../../lambda/repository/assistantSearch';

// Mock the repository
jest.mock('../../lambda/repository/assistant');
const mockedCreateAssistant = createAssistant as jest.MockedFunction<typeof createAssistant>;

// Mock the document loader and search utilities
jest.mock('../../lambda/utils/documentLoader');
jest.mock('../../lambda/repository/assistantSearch');

const mockedLoadDocumentsFromS3 = loadDocumentsFromS3 as jest.MockedFunction<typeof loadDocumentsFromS3>;
const mockedChunkDocuments = chunkDocuments as jest.MockedFunction<typeof chunkDocuments>;
const mockedAddMetadata = addMetadata as jest.MockedFunction<typeof addMetadata>;
const mockedIndexDocuments = indexDocuments as jest.MockedFunction<typeof indexDocuments>;

// Helper function to create APIGatewayProxyEvent
function createAPIGatewayProxyEvent(
  body: unknown | null,
  userId?: string
): APIGatewayProxyEvent {
  return {
    body: body ? JSON.stringify(body) : null,
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

describe('createAssistant Lambda handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns correct response for valid request', async () => {
    const userId = 'testUser';
    const requestBody = {
      name: 'Test Assistant',
      description: 'A test assistant',
      instruction: 'You are a helpful assistant',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
    };

    const expectedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: 'assistant#123',
      userId: `user#${userId}`,
      name: requestBody.name,
      description: requestBody.description,
      instruction: requestBody.instruction,
      modelId: requestBody.modelId,
      ragEnabled: requestBody.ragEnabled,
      syncStatus: 'QUEUED',
      syncStatusReason: '',
      s3Urls: [],
      updatedDate: '1234567890',
    };

    mockedCreateAssistant.mockResolvedValue(expectedAssistant);

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    expect(result.statusCode).toBe(201);
    expect(mockedCreateAssistant).toHaveBeenCalledWith(userId, requestBody, expect.any(Object));
    expect(JSON.parse(result.body)).toEqual(expectedAssistant);
  });

  test('returns 400 error when missing required field: name', async () => {
    const userId = 'testUser';
    const requestBody = {
      description: 'A test assistant',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
    };

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Missing required fields: name, instruction, modelId',
    });
    expect(mockedCreateAssistant).not.toHaveBeenCalled();
  });

  test('returns 400 error when missing required field: instruction', async () => {
    const userId = 'testUser';
    const requestBody = {
      name: 'Test Assistant',
      description: 'A test assistant',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
    };

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Missing required fields: name, instruction, modelId',
    });
    expect(mockedCreateAssistant).not.toHaveBeenCalled();
  });

  test('returns 400 error when missing required field: modelId', async () => {
    const userId = 'testUser';
    const requestBody = {
      name: 'Test Assistant',
      description: 'A test assistant',
      instruction: 'You are helpful',
      ragEnabled: false,
    };

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Missing required fields: name, instruction, modelId',
    });
    expect(mockedCreateAssistant).not.toHaveBeenCalled();
  });

  test('creates assistant with RAG enabled and s3Urls', async () => {
    const userId = 'testUser';
    const requestBody = {
      name: 'RAG Assistant',
      description: 'An assistant with RAG',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: true,
      s3Urls: ['s3://bucket/file.pdf'],
    };

    const expectedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: 'assistant#123',
      userId: `user#${userId}`,
      name: requestBody.name,
      description: requestBody.description,
      instruction: requestBody.instruction,
      modelId: requestBody.modelId,
      ragEnabled: requestBody.ragEnabled,
      syncStatus: 'QUEUED',
      syncStatusReason: '',
      s3Urls: requestBody.s3Urls,
      updatedDate: '1234567890',
    };

    const mockDocuments = [{ pageContent: 'test content', metadata: {} }];
    const mockChunks = [{ pageContent: 'test chunk', metadata: {} }];
    const mockDocsWithMetadata = [
      { pageContent: 'test chunk', metadata: { assistantId: '123', userId } },
    ];

    mockedCreateAssistant.mockResolvedValue(expectedAssistant);
    mockedLoadDocumentsFromS3.mockResolvedValue(mockDocuments);
    mockedChunkDocuments.mockResolvedValue(mockChunks);
    mockedAddMetadata.mockReturnValue(mockDocsWithMetadata);
    mockedIndexDocuments.mockResolvedValue(undefined);

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual(expectedAssistant);

    // Verify RAG ingestion functions were called
    expect(mockedLoadDocumentsFromS3).toHaveBeenCalledWith(requestBody.s3Urls);
    expect(mockedChunkDocuments).toHaveBeenCalledWith(mockDocuments, 1000, 200);
    expect(mockedAddMetadata).toHaveBeenCalledWith(mockChunks, '123', userId);
    expect(mockedIndexDocuments).toHaveBeenCalledWith('123', mockDocsWithMetadata);
  });

  test('handles RAG ingestion errors gracefully', async () => {
    const userId = 'testUser';
    const requestBody = {
      name: 'RAG Assistant',
      description: 'An assistant with RAG',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: true,
      s3Urls: ['s3://bucket/file.pdf'],
    };

    const expectedAssistant: Assistant = {
      id: `user#${userId}`,
      createdDate: '1234567890',
      assistantId: 'assistant#123',
      userId: `user#${userId}`,
      name: requestBody.name,
      description: requestBody.description,
      instruction: requestBody.instruction,
      modelId: requestBody.modelId,
      ragEnabled: requestBody.ragEnabled,
      syncStatus: 'QUEUED',
      syncStatusReason: '',
      s3Urls: requestBody.s3Urls,
      updatedDate: '1234567890',
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedCreateAssistant.mockResolvedValue(expectedAssistant);
    mockedLoadDocumentsFromS3.mockRejectedValue(new Error('S3 load failed'));

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    // Should still return success even if ingestion fails
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual(expectedAssistant);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error ingesting documents:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  test('returns 500 error when an exception occurs', async () => {
    const userId = 'testUser';
    const requestBody = {
      name: 'Test Assistant',
      description: 'A test assistant',
      instruction: 'You are helpful',
      modelId: 'anthropic.claude-v2',
      ragEnabled: false,
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockedCreateAssistant.mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await handler(createAPIGatewayProxyEvent(requestBody, userId));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  test('handles empty request body', async () => {
    const userId = 'testUser';

    const result = await handler(createAPIGatewayProxyEvent({}, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Missing required fields: name, instruction, modelId',
    });
  });

  test('handles null request body', async () => {
    const userId = 'testUser';

    const result = await handler(createAPIGatewayProxyEvent(null, userId));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Missing required fields: name, instruction, modelId',
    });
  });
});
