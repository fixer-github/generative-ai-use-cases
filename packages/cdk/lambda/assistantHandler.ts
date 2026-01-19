import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createAssistant,
  listAssistants,
  getAssistant,
  updateAssistant,
  deleteAssistant,
  updateAssistantSyncStatus,
} from './repository/assistant';
import { deleteAllMessagesForAssistant } from './repository/chat';
import { deleteAssistantDocuments } from './repository/assistantSearch';
import {
  Assistant,
  CreateAssistantRequest,
  UpdateAssistantRequest,
  ListAssistantsResponse,
  KnowledgeSource,
} from 'generative-ai-use-cases';
import { getTenantId } from './utils/tenantUtils';
import { canAccessAssistant } from './utils/assistantAccessControl';
import {
  badRequest400Response,
  created201Response,
  forbidden403Response,
  internalServerError500Response,
  methodNotAllowed405Response,
  noContent204Response,
  notFound404Response,
  ok200Response,
} from './utils/apiResponse';
import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({});
const KNOWLEDGE_SYNC_FUNCTION_NAME =
  process.env.ASSISTANT_KNOWLEDGE_SYNC_FUNCTION_NAME;

type KnowledgeSyncPayload = {
  assistantId: string;
  userId: string;
  tenantId: string;
  authorization?: string;
  clearExistingIndex?: boolean;
};

function ensureKnowledgeSourceIds(
  sources?: KnowledgeSource[]
): KnowledgeSource[] | undefined {
  if (!sources) {
    return sources;
  }

  return sources.map((source) => {
    if (source.id) {
      return source;
    }
    return { ...source, id: crypto.randomUUID() };
  });
}

function getAuthorizationHeader(
  event: APIGatewayProxyEvent
): string | undefined {
  return event.headers?.Authorization || event.headers?.authorization;
}

async function enqueueKnowledgeSync(
  payload: KnowledgeSyncPayload
): Promise<void> {
  if (!KNOWLEDGE_SYNC_FUNCTION_NAME) {
    throw new Error('ASSISTANT_KNOWLEDGE_SYNC_FUNCTION_NAME is not set');
  }

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: KNOWLEDGE_SYNC_FUNCTION_NAME,
      InvocationType: InvocationType.Event,
      Payload: JSON.stringify(payload),
    })
  );
}

/**
 * Helper function to normalize assistant data for API responses
 * - Strips "assistant#" prefix from assistantId
 * - Strips "user#" prefix from userId and id for anonymity and frontend compatibility
 * Internal storage uses prefixed format, but API returns clean values
 */
function stripAssistantPrefix(assistant: Assistant): Assistant {
  return {
    ...assistant,
    assistantId: assistant.assistantId.replace(/^(assistant#)+/, ''),
    userId: assistant.userId.replace(/^user#/, ''),
    id: assistant.id.replace(/^user#/, ''), // Normalize partition key duplicate
  };
}

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
          return badRequest400Response({ message: 'Missing assistantId' });
        }
        return await handleUpdate(userId, assistantId, event);

      case 'DELETE':
        if (!assistantId) {
          return badRequest400Response({ message: 'Missing assistantId' });
        }
        return await handleDelete(userId, assistantId, event);

      default:
        return methodNotAllowed405Response({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in assistant handler:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};

// TODO: Update after implementing AuthZ - Currently only tenantAdmin users can create assistants (workaround)
// Read assistant creation restriction setting from environment
// When true (default), only tenantAdmin users can create assistants
// When false, any authenticated user can create assistants
const ASSISTANT_CREATION_REQUIRES_ADMIN =
  process.env.ASSISTANT_CREATION_REQUIRES_ADMIN !== 'false';

/**
 * Handle POST / - Create assistant
 * TODO: Update after implementing AuthZ - Currently only tenantAdmin users can create assistants (workaround)
 * Authorization is configurable via assistantCreationRequiresAdmin in cdk.json
 */
async function handleCreate(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // TODO: Update after implementing AuthZ - Currently only tenantAdmin users can create assistants (workaround)
  // Check if admin restriction is enabled (configurable via cdk.json)
  if (ASSISTANT_CREATION_REQUIRES_ADMIN) {
    const isTenantAdmin =
      event.requestContext.authorizer?.claims?.['custom:tenantAdmin'] ===
      'true';
    if (!isTenantAdmin) {
      return forbidden403Response({
        message: 'Only tenant administrators can create assistants',
        code: 'TENANT_ADMIN_REQUIRED',
      });
    }
  }

  const body: CreateAssistantRequest = JSON.parse(event.body || '{}');
  body.knowledgeSources = ensureKnowledgeSourceIds(body.knowledgeSources);

  console.log(
    `Creating assistant: ragEnabled=${body.ragEnabled}, knowledgeSources=${body.knowledgeSources?.length || 0}`
  );

  // Basic validation
  if (!body.name || !body.instruction || !body.modelId) {
    return badRequest400Response({
      message: 'Missing required fields: name, instruction, modelId',
    });
  }

  const assistant = await createAssistant(userId, body, event);

  // If RAG is enabled, queue knowledge sync and update status
  if (body.ragEnabled) {
    console.log(`RAG is enabled, queuing knowledge sync...`);
    await updateAssistantSyncStatus(assistant, event);
    if (body.knowledgeSources && body.knowledgeSources.length > 0) {
      await enqueueKnowledgeSync({
        assistantId: assistant.assistantId.replace(/^assistant#/, ''),
        userId,
        tenantId: getTenantId(event),
        authorization: getAuthorizationHeader(event),
      });
    } else {
      console.log(
        `No knowledge sources provided (knowledgeSources=${body.knowledgeSources?.length || 0})`
      );
    }
  } else {
    console.log(`RAG is not enabled`);
  }

  // Note: updateAssistantSyncStatus updates assistant.syncStatus in memory
  return created201Response(stripAssistantPrefix(assistant));
}

/**
 * Handle GET / - List assistants
 */
async function handleList(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // Read nextToken parameter (aligned with frontend API contract)
  const nextToken = event.queryStringParameters?.nextToken;

  // Parse and validate limit parameter
  let limit = 100; // default
  if (event.queryStringParameters?.limit) {
    const parsedLimit = parseInt(event.queryStringParameters.limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return badRequest400Response({
        message: 'Invalid limit parameter. Must be between 1 and 100.',
      });
    }
    limit = parsedLimit;
  }

  try {
    const result = await listAssistants(userId, event, nextToken, limit);

    // Strip prefix from all assistants
    // Provide both lastEvaluatedKey (backward compatibility) and nextToken (new standard)
    const sanitizedResult: ListAssistantsResponse = {
      assistants: result.assistants.map(stripAssistantPrefix),
      lastEvaluatedKey: result.lastEvaluatedKey,
      nextToken: result.lastEvaluatedKey,
    };

    return ok200Response(sanitizedResult);
  } catch (error: any) {
    if (error.message === 'Invalid pagination token') {
      return badRequest400Response({
        message: 'Invalid pagination token. Please start from the beginning.',
      });
    }
    throw error;
  }
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
    return notFound404Response({ message: 'Assistant not found' });
  }

  // Check access: owner OR (public AND same tenant)
  if (!canAccessAssistant(assistant, userId, event)) {
    return forbidden403Response({
      message: 'Access denied to this assistant',
      code: 'ASSISTANT_ACCESS_DENIED',
    });
  }

  return ok200Response(stripAssistantPrefix(assistant));
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
  body.knowledgeSources = ensureKnowledgeSourceIds(body.knowledgeSources);

  try {
    const assistant = await updateAssistant(assistantId, userId, body, event);

    // If knowledge sources were updated and RAG is enabled, queue re-indexing
    if (body.knowledgeSources !== undefined && assistant.ragEnabled) {
      console.log(`Queueing document re-index for assistant ${assistantId}`);
      await updateAssistantSyncStatus(assistant, event);
      await enqueueKnowledgeSync({
        assistantId,
        userId,
        tenantId: getTenantId(event),
        authorization: getAuthorizationHeader(event),
        clearExistingIndex: true,
      });
    }

    return ok200Response(stripAssistantPrefix(assistant));
  } catch (error: any) {
    if (error.message === 'Assistant not found') {
      return notFound404Response({ message: 'Assistant not found' });
    }
    if (error.message === 'Unauthorized') {
      return forbidden403Response({
        message: 'Access denied to this assistant',
        code: 'ASSISTANT_ACCESS_DENIED',
      });
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
    await deleteAllMessagesForAssistant(assistantId, event);

    // Delete all indexed documents from OpenSearch
    try {
      await deleteAssistantDocuments(assistantId, event);
      console.log(`Deleted OpenSearch documents for assistant ${assistantId}`);
    } catch (error) {
      console.error('Error deleting OpenSearch documents:', error);
      // Don't fail the deletion if OpenSearch cleanup fails
    }

    return noContent204Response();
  } catch (error: any) {
    if (error.message === 'Assistant not found') {
      return notFound404Response({ message: 'Assistant not found' });
    }
    if (error.message === 'Unauthorized') {
      return forbidden403Response({
        message: 'Access denied to this assistant',
        code: 'ASSISTANT_ACCESS_DENIED',
      });
    }
    throw error;
  }
}
