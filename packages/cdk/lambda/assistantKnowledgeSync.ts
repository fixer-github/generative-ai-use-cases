import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  getAssistant,
  updateKnowledgeSourceStatus,
  updateAssistantSyncStatus,
} from './repository/assistant';
import {
  deleteAssistantDocuments,
  indexDocuments,
} from './repository/assistantSearch';
import {
  loadDocuments,
  chunkDocuments,
  addMetadata,
} from './utils/documentLoader';

type KnowledgeSyncRequest = {
  assistantId: string;
  userId: string;
  tenantId: string;
  authorization?: string;
  clearExistingIndex?: boolean;
};

function buildRequestEvent(
  payload: KnowledgeSyncRequest
): APIGatewayProxyEvent {
  return {
    headers: {
      Authorization: payload.authorization || '',
    },
    requestContext: {
      authorizer: {
        claims: {
          'custom:tenant_id': payload.tenantId,
          'cognito:username': payload.userId,
        },
        'custom:tenant_id': payload.tenantId,
        'cognito:username': payload.userId,
      },
    },
  } as APIGatewayProxyEvent;
}

function normalizeAssistantId(assistantId: string): string {
  return assistantId.replace(/^assistant#/, '');
}

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error';
  }

  let message = error.message;
  if ('meta' in error && error.meta) {
    const meta = error.meta as {
      statusCode?: number;
      body?: { Message?: string; error?: string | { reason?: string } };
    };
    if (meta.statusCode) {
      message = `${error.message} (HTTP ${meta.statusCode})`;
    }
    if (meta.body && meta.body.Message) {
      message += `: ${meta.body.Message}`;
    } else if (meta.body && meta.body.error) {
      if (typeof meta.body.error === 'string') {
        message += `: ${meta.body.error}`;
      } else if (meta.body.error.reason) {
        message += `: ${meta.body.error.reason}`;
      }
    }
  }

  return message;
}

export const handler = async (event: KnowledgeSyncRequest): Promise<void> => {
  if (!event?.assistantId || !event?.userId || !event?.tenantId) {
    console.error('Missing knowledge sync payload fields:', event);
    return;
  }

  const requestEvent = buildRequestEvent(event);
  const assistant = await getAssistant(event.assistantId, requestEvent);

  if (!assistant) {
    console.error(`Assistant not found: ${event.assistantId}`);
    return;
  }

  if (!assistant.ragEnabled) {
    console.log(
      `RAG is disabled for assistant ${assistant.assistantId}; skipping sync`
    );
    return;
  }

  const cleanAssistantId = normalizeAssistantId(assistant.assistantId);

  if (event.clearExistingIndex) {
    console.log(`Clearing documents for assistant ${cleanAssistantId}`);
    await deleteAssistantDocuments(cleanAssistantId, requestEvent);
  }

  const sources = assistant.knowledgeSources || [];
  if (sources.length === 0) {
    console.log(`No knowledge sources to sync for ${cleanAssistantId}`);
    await updateAssistantSyncStatus(assistant, requestEvent);
    return;
  }

  let hasAnySuccess = false;
  let lastError: Error | undefined;

  for (const source of sources) {
    try {
      if (!source.id) {
        source.id = crypto.randomUUID();
        console.log(
          `Generated ID ${source.id} for knowledge source without ID`
        );
      }

      console.log(
        `Processing knowledge source ${source.id} for assistant ${cleanAssistantId}`
      );

      await updateKnowledgeSourceStatus(
        assistant,
        source.id,
        'SYNCING',
        undefined,
        requestEvent
      );

      const documents = await loadDocuments([source], event.userId, requestEvent);
      const chunks = await chunkDocuments(documents, 1000, 200);
      const docsWithMetadata = addMetadata(
        chunks,
        cleanAssistantId,
        event.userId
      );

      await indexDocuments(cleanAssistantId, docsWithMetadata, requestEvent);

      await updateKnowledgeSourceStatus(
        assistant,
        source.id,
        'SUCCEEDED',
        undefined,
        requestEvent
      );

      hasAnySuccess = true;
      console.log(
        `Successfully indexed knowledge source ${source.id} for assistant ${cleanAssistantId}`
      );
    } catch (error) {
      console.error(
        `Error indexing knowledge source ${source.id}:`,
        error
      );

      const errorMessage = getErrorMessage(error);
      await updateKnowledgeSourceStatus(
        assistant,
        source.id!,
        'FAILED',
        errorMessage,
        requestEvent
      ).catch((statusError) => {
        console.error('Failed to update source status:', statusError);
      });

      lastError = error instanceof Error ? error : new Error('Unknown error');
    }
  }

  await updateAssistantSyncStatus(assistant, requestEvent);

  if (!hasAnySuccess && lastError) {
    throw new Error(
      `Failed to index all knowledge sources. Last error: ${lastError.message}`
    );
  }
};
