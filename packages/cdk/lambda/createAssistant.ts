import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createAssistant } from './repository/assistant';
import { CreateAssistantRequest } from 'generative-ai-use-cases';
import { loadDocumentsFromS3, chunkDocuments, addMetadata } from './utils/documentLoader';
import { indexDocuments } from './repository/assistantSearch';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    const body: CreateAssistantRequest = JSON.parse(event.body || '{}');

    // Basic validation
    if (!body.name || !body.instruction || !body.modelId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Missing required fields: name, instruction, modelId',
        }),
      };
    }

    const assistant = await createAssistant(userId, body, event);

    // If RAG is enabled and S3 URLs are provided, ingest documents
    if (body.ragEnabled && body.s3Urls && body.s3Urls.length > 0) {
      try {
        console.log(`Starting document ingestion for assistant ${assistant.assistantId}`);

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

        console.log(`Successfully ingested documents for assistant ${assistant.assistantId}`);
      } catch (error) {
        console.error('Error ingesting documents:', error);
        // Don't fail the assistant creation if document ingestion fails
        // The assistant will still be created but RAG won't work until documents are indexed
      }
    }

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(assistant),
    };
  } catch (error) {
    console.error('Error creating assistant:', error);
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
