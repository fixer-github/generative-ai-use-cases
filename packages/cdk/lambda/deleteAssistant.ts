import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { deleteAssistant } from './repository/assistant';
import { deleteMessagesForAssistant } from './repository/assistantMessage';
import { deleteAssistantDocuments } from './repository/assistantSearch';

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

    try {
      // Delete assistant first (verifies ownership)
      await deleteAssistant(assistantId, userId, event);

      // Delete all messages after ownership verification
      await deleteMessagesForAssistant(assistantId, event);

      // Delete all indexed documents from OpenSearch
      try {
        await deleteAssistantDocuments(assistantId);
        console.log(`Deleted OpenSearch documents for assistant ${assistantId}`);
      } catch (error) {
        console.error('Error deleting OpenSearch documents:', error);
        // Don't fail the deletion if OpenSearch cleanup fails
      }

      return {
        statusCode: 204,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: '',
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
    console.error('Error deleting assistant:', error);
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
