import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { deleteAllMessagesForAssistant } from '../repository';
import { deleteAssistant } from '../repository/assistant';
import { deleteAssistantDocuments } from '../repository/assistantSearch';
import {
  noContent204Response,
  notFound404Response,
  forbidden403Response,
} from '../utils/apiResponse';
import * as console from 'node:console';

/**
 * Handle DELETE /{assistantId} - Delete assistant
 */
export async function handleDelete(
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
