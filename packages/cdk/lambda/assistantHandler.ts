import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createAssistant,
  listAssistants,
  getAssistant,
  updateAssistant,
  deleteAssistant,
} from './repository/assistant';
import { deleteMessagesForAssistant } from './repository/assistantMessage';
import {
  loadDocumentsFromS3,
  chunkDocuments,
  addMetadata,
} from './utils/documentLoader';
import {
  indexDocuments,
  deleteAssistantDocuments,
} from './repository/assistantSearch';
import {
  CreateAssistantRequest,
  UpdateAssistantRequest,
} from 'generative-ai-use-cases';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Consolidated handler for all assistant CRUD operations
 * Routes based on HTTP method and path:
 * - POST / → create assistant
 * - GET / → list assistants
 * - GET /{assistantId} → get assistant
 * - PUT /{assistantId} → update assistant
 * - DELETE /{assistantId} → delete assistant
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const method = event.httpMethod;
    const assistantId = event.pathParameters?.assistantId;

    // Route based on HTTP method and path
    switch (method) {
      case 'POST':
        return await handleCreate(userId, event);

      case 'GET':
        if (assistantId) {
          return await handleGet(userId, assistantId, event);
        } else {
          return await handleList(userId, event);
        }

      case 'PUT':
        if (!assistantId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: 'Missing assistantId' }),
          };
        }
        return await handleUpdate(userId, assistantId, event);

      case 'DELETE':
        if (!assistantId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: 'Missing assistantId' }),
          };
        }
        return await handleDelete(userId, assistantId, event);

      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ message: 'Method not allowed' }),
        };
    }
  } catch (error) {
    console.error('Error in assistant handler:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};

/**
 * Handle POST / - Create assistant
 */
async function handleCreate(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const body: CreateAssistantRequest = JSON.parse(event.body || '{}');

  // Basic validation
  if (!body.name || !body.instruction || !body.modelId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message: 'Missing required fields: name, instruction, modelId',
      }),
    };
  }

  const assistant = await createAssistant(userId, body, event);

  // If RAG is enabled and S3 URLs are provided, ingest documents
  if (body.ragEnabled && body.s3Urls && body.s3Urls.length > 0) {
    try {
      console.log(
        `Starting document ingestion for assistant ${assistant.assistantId}`
      );

      // Load documents from S3
      const documents = await loadDocumentsFromS3(body.s3Urls);

      // Chunk documents
      const chunks = await chunkDocuments(documents, 1000, 200);

      // Add metadata
      const docsWithMetadata = addMetadata(
        chunks,
        assistant.assistantId.replace('assistant#', ''),
        userId
      );

      // Index to OpenSearch
      await indexDocuments(
        assistant.assistantId.replace('assistant#', ''),
        docsWithMetadata
      );

      console.log(
        `Successfully ingested documents for assistant ${assistant.assistantId}`
      );
    } catch (error) {
      console.error('Error ingesting documents:', error);
      // Don't fail the assistant creation if document ingestion fails
      // The assistant will still be created but RAG won't work until documents are indexed
    }
  }

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify(assistant),
  };
}

/**
 * Handle GET / - List assistants
 */
async function handleList(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const exclusiveStartKey = event.queryStringParameters?.exclusiveStartKey;

  const result = await listAssistants(userId, event, exclusiveStartKey);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(result),
  };
}

/**
 * Handle GET /{assistantId} - Get assistant
 */
async function handleGet(
  userId: string,
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const assistant = await getAssistant(assistantId, event);

  if (!assistant) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ message: 'Assistant not found' }),
    };
  }

  // Verify ownership (userId is stored with 'user#' prefix)
  if (assistant.userId !== `user#${userId}`) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ message: 'Forbidden' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(assistant),
  };
}

/**
 * Handle PUT /{assistantId} - Update assistant
 */
async function handleUpdate(
  userId: string,
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const body: UpdateAssistantRequest = JSON.parse(event.body || '{}');

  try {
    const assistant = await updateAssistant(assistantId, userId, body, event);

    // If S3 URLs were updated and RAG is enabled, re-index documents
    if (body.s3Urls !== undefined && assistant.ragEnabled) {
      try {
        console.log(`Re-indexing documents for assistant ${assistantId}`);

        // Delete old documents first
        await deleteAssistantDocuments(assistantId);

        // If new S3 URLs are provided, index them
        if (body.s3Urls && body.s3Urls.length > 0) {
          // Load documents from S3
          const documents = await loadDocumentsFromS3(body.s3Urls);

          // Chunk documents
          const chunks = await chunkDocuments(documents, 1000, 200);

          // Add metadata
          const docsWithMetadata = addMetadata(chunks, assistantId, userId);

          // Index to OpenSearch
          await indexDocuments(assistantId, docsWithMetadata);

          console.log(
            `Successfully re-indexed documents for assistant ${assistantId}`
          );
        }
      } catch (error) {
        console.error('Error re-indexing documents:', error);
        // Don't fail the assistant update if document indexing fails
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(assistant),
    };
  } catch (error: any) {
    if (error.message === 'Assistant not found') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Assistant not found' }),
      };
    }
    if (error.message === 'Unauthorized') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: 'Forbidden' }),
      };
    }
    throw error;
  }
}

/**
 * Handle DELETE /{assistantId} - Delete assistant
 */
async function handleDelete(
  userId: string,
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    // Delete assistant first (verifies ownership)
    await deleteAssistant(assistantId, userId, event);

    // Delete all messages after ownership verification
    await deleteMessagesForAssistant(assistantId, event);

    // Delete all indexed documents from OpenSearch
    try {
      await deleteAssistantDocuments(assistantId);
      console.log(
        `Deleted OpenSearch documents for assistant ${assistantId}`
      );
    } catch (error) {
      console.error('Error deleting OpenSearch documents:', error);
      // Don't fail the deletion if OpenSearch cleanup fails
    }

    return {
      statusCode: 204,
      headers,
      body: '',
    };
  } catch (error: any) {
    if (error.message === 'Assistant not found') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Assistant not found' }),
      };
    }
    if (error.message === 'Unauthorized') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: 'Forbidden' }),
      };
    }
    throw error;
  }
}
