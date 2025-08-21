import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CreateMessagesRequest, ExtraData } from 'generative-ai-use-cases';
import { batchCreateMessages, findChatById } from './repository';

const FILE_UPLOAD_BUCKET_NAME = process.env.BUCKET_NAME!;

const isValidExtraData = (extra: ExtraData, bucketName: string): boolean => {
  return extra.source.data.startsWith(
    `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/`
  );
};

const validateMessages = (
  messages: CreateMessagesRequest['messages'],
  bucketName: string
): { isValid: boolean; error?: string } => {
  if (!messages) {
    return { isValid: true };
  }

  for (const message of messages) {
    if (!message.extraData || message.extraData.length === 0) {
      continue;
    }

    for (const extra of message.extraData) {
      if (!isValidExtraData(extra, bucketName)) {
        return { isValid: false, error: 'Invalid extraData' };
      }
    }
  }

  return { isValid: true };
};

const createResponse = (
  statusCode: number,
  body: object
): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: CreateMessagesRequest = JSON.parse(event.body!);
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const chatId = event.pathParameters!.chatId!;

    // Authorization check: Verify if the specified chat belongs to the user
    const chat = await findChatById(userId, chatId, event);
    if (chat === null) {
      return createResponse(403, {
        message: 'You do not have permission to post messages in the chat.',
      });
    }

    const validation = validateMessages(req.messages, FILE_UPLOAD_BUCKET_NAME);
    if (!validation.isValid) {
      return createResponse(400, {
        message: validation.error,
      });
    }

    const messages = await batchCreateMessages(
      req.messages,
      userId,
      chatId,
      event
    );

    return createResponse(200, { messages });
  } catch (error) {
    console.log(error);
    return createResponse(500, { message: 'Internal Server Error' });
  }
};
