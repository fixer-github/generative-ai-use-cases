import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateAssistantRequest } from 'generative-ai-use-cases';
import {
  updateAssistant,
  updateKnowledgeSourceStatus,
  updateAssistantSyncStatus,
} from '../repository/assistant';
import {
  deleteAssistantDocuments,
  indexDocuments,
} from '../repository/assistantSearch';
import {
  ok200Response,
  notFound404Response,
  forbidden403Response,
} from '../utils/apiResponse';
import {
  loadDocuments,
  chunkDocuments,
  addMetadata,
} from '../utils/documentLoader';
import { stripAssistantPrefix } from './util';
import * as console from 'node:console';
import * as crypto from 'node:crypto';

/**
 * Handle PUT /{assistantId} - Update assistant
 */
export async function handleUpdate(
  userId: string,
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const body: UpdateAssistantRequest = JSON.parse(event.body || '{}');

  try {
    const assistant = await updateAssistant(assistantId, userId, body, event);

    // If knowledge sources were updated and RAG is enabled, re-index documents
    if (body.knowledgeSources !== undefined && assistant.ragEnabled) {
      console.log(`Re-indexing documents for assistant ${assistantId}`);

      // KNOWN LIMITATION: We delete old documents before indexing new ones.
      // If ALL sources fail to index, the assistant will have no documents.
      // Proper solutions would require:
      // 1. Adding sync timestamps to documents and deleting only older versions
      // 2. Implementing async job queue with rollback capability
      // 3. Using temporary index with atomic swap
      await deleteAssistantDocuments(assistantId, event);

      // If new knowledge sources are provided, index them
      if (body.knowledgeSources && body.knowledgeSources.length > 0) {
        let hasAnySuccess = false;
        let lastError: Error | undefined;

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
              `Processing knowledge source ${source.id} for assistant ${assistantId}`
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
            const docsWithMetadata = addMetadata(chunks, assistantId, userId);

            // Index to OpenSearch
            await indexDocuments(assistantId, docsWithMetadata, event);

            // Update status to SUCCEEDED
            await updateKnowledgeSourceStatus(
              assistant,
              source.id,
              'SUCCEEDED',
              undefined,
              event
            );

            hasAnySuccess = true;
            console.log(
              `Successfully re-indexed knowledge source ${source.id} for assistant ${assistantId}`
            );
          } catch (error) {
            console.error(
              `Error re-indexing knowledge source ${source.id}:`,
              error
            );

            // Update status to FAILED with error message
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            // source.id is guaranteed to exist at this point (generated above if not provided)
            await updateKnowledgeSourceStatus(
              assistant,
              source.id!,
              'FAILED',
              errorMessage,
              event
            ).catch((statusError) => {
              // Don't fail if status update fails
              console.error('Failed to update source status:', statusError);
            });

            lastError =
              error instanceof Error ? error : new Error('Unknown error');
          }
        }

        // After all sources are processed, update overall assistant status
        await updateAssistantSyncStatus(assistant, event);

        // If all sources failed, throw error to surface to user
        if (!hasAnySuccess && lastError) {
          throw new Error(
            `Failed to re-index all knowledge sources. Last error: ${lastError.message}`
          );
        }
      } else {
        console.log(
          `Cleared all documents for assistant ${assistantId} (no new sources)`
        );

        // Update status even when clearing all documents
        await updateAssistantSyncStatus(assistant, event);
      }
    }

    return ok200Response(stripAssistantPrefix(assistant));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
