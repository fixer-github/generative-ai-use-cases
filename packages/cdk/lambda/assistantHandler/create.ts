import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CreateAssistantRequest } from 'generative-ai-use-cases';
import {
  badRequest400Response,
  created201Response,
} from '../utils/apiResponse';
import {
  createAssistant,
  updateKnowledgeSourceStatus,
  updateAssistantSyncStatus,
} from '../repository/assistant';
import { indexDocuments } from '../repository/assistantSearch';
import {
  loadDocuments,
  chunkDocuments,
  addMetadata,
} from '../utils/documentLoader';
import { stripAssistantPrefix } from './util';
import * as console from 'node:console';
import * as crypto from 'node:crypto';

/**
 * Handle POST / - Create assistant
 */
export async function handleCreate(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const body: CreateAssistantRequest = JSON.parse(event.body || '{}');

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

  // If RAG is enabled, process knowledge sources and update status
  if (body.ragEnabled) {
    console.log(`RAG is enabled, checking knowledge sources...`);
    // If knowledge sources are provided, ingest documents
    if (body.knowledgeSources && body.knowledgeSources.length > 0) {
      const cleanAssistantId = assistant.assistantId.replace('assistant#', '');

      // Process each knowledge source individually to track status per-source
      for (const source of body.knowledgeSources) {
        try {
          // Generate ID server-side if not provided (for backward compatibility and URL sources)
          if (!source.id) {
            source.id = crypto.randomUUID();
            console.log(
              `Generated ID ${source.id} for knowledge source without ID`
            );
          }

          console.log(
            `Processing knowledge source ${source.id} (type=${source.type}, storageKey=${source.storageKey}) for assistant ${cleanAssistantId}`
          );

          // Update status to SYNCING
          await updateKnowledgeSourceStatus(
            assistant,
            source.id,
            'SYNCING',
            undefined,
            event
          );

          // Load document for this source
          const documents = await loadDocuments([source], userId, event);

          // Chunk documents
          const chunks = await chunkDocuments(documents, 1000, 200);

          // Add metadata
          const docsWithMetadata = addMetadata(
            chunks,
            cleanAssistantId,
            userId
          );

          // Index to OpenSearch
          await indexDocuments(cleanAssistantId, docsWithMetadata, event);

          // Update status to SUCCEEDED
          await updateKnowledgeSourceStatus(
            assistant,
            source.id,
            'SUCCEEDED',
            undefined,
            event
          );

          console.log(
            `Successfully ingested knowledge source ${source.id} for assistant ${cleanAssistantId}`
          );
        } catch (error) {
          console.error(
            `Error ingesting knowledge source ${source.id}:`,
            error
          );

          // Update status to FAILED with detailed error message
          let errorMessage = 'Unknown error';
          if (error instanceof Error) {
            errorMessage = error.message;

            // Extract additional details from OpenSearch ResponseError
            if ('meta' in error && error.meta) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const meta = error.meta as any;
              if (meta.statusCode) {
                errorMessage = `${error.message} (HTTP ${meta.statusCode})`;
              }
              if (meta.body && meta.body.Message) {
                // AWS IAM error message format
                errorMessage += `: ${meta.body.Message}`;
              } else if (meta.body && meta.body.error) {
                // OpenSearch error format
                if (typeof meta.body.error === 'string') {
                  errorMessage += `: ${meta.body.error}`;
                } else if (meta.body.error.reason) {
                  errorMessage += `: ${meta.body.error.reason}`;
                }
              }
            }
          }

          if (source.id) {
            await updateKnowledgeSourceStatus(
              assistant,
              source.id,
              'FAILED',
              errorMessage,
              event
            ).catch((statusError) => {
              // Don't fail if status update fails
              console.error('Failed to update source status:', statusError);
            });
          }

          // Don't fail the assistant creation if one source fails
          // Continue processing other sources
        }
      }
    } else {
      console.log(
        `No knowledge sources provided (knowledgeSources=${body.knowledgeSources?.length || 0})`
      );
    }

    // After all sources are processed (or if no sources), update overall assistant status
    await updateAssistantSyncStatus(assistant, event);
  } else {
    console.log(`RAG is not enabled`);
  }

  // Note: updateAssistantSyncStatus updates assistant.syncStatus in memory
  return created201Response(stripAssistantPrefix(assistant));
}
