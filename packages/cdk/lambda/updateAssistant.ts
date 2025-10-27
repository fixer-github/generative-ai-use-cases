import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { updateAssistant } from './repository/assistant';
import { UpdateAssistantRequest } from 'generative-ai-use-cases';
import { loadDocumentsFromS3, chunkDocuments, addMetadata } from './utils/documentLoader';
import { indexDocuments, deleteAssistantDocuments } from './repository/assistantSearch';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const assistantId = event.pathParameters?.assistantId;

    if (!assistantId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Missing assistantId' }),
      };
    }

    const body: UpdateAssistantRequest = JSON.parse(event.body || '{}');

    try {
      const assistant = await updateAssistant(
        assistantId,
        userId,
        body,
        event
      );

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
            const docsWithMetadata = addMetadata(
              chunks,
              assistantId,
              userId
            );

            // Index to OpenSearch
            await indexDocuments(assistantId, docsWithMetadata);

            console.log(`Successfully re-indexed documents for assistant ${assistantId}`);
          }
        } catch (error) {
          console.error('Error re-indexing documents:', error);
          // Don't fail the assistant update if document indexing fails
        }
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(assistant),
      };
    } catch (error: any) {
      if (error.message === 'Assistant not found') {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Assistant not found' }),
        };
      }
      if (error.message === 'Unauthorized') {
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Forbidden' }),
        };
      }
      throw error;
    }
  } catch (error) {
    console.error('Error updating assistant:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
