import { CreateMessagesRequest, ExtraData } from 'generative-ai-use-cases';
import { withTenantRepository } from './tenantRepository';

const FILE_UPLOAD_BUCKET_NAME = process.env.BUCKET_NAME!;

const isValidExtraData = (extra: ExtraData, bucketName: string): boolean => {
  return extra.source.data.startsWith(
    `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/`
  );
};

export const handler = withTenantRepository(async (repo, userId, event) => {
  const req: CreateMessagesRequest = JSON.parse(event.body!);
  const chatId = event.pathParameters!.chatId!;

  // Authorization check: Verify if the specified chat belongs to the user
  const chat = await repo.findChatById(userId, chatId);
  if (chat === null) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'You do not have permission to post messages in the chat.',
      }),
    };
  }

  if (req.messages) {
    for (const message of req.messages) {
      if (message.extraData && message.extraData.length > 0) {
        for (const extra of message.extraData) {
          if (!isValidExtraData(extra, FILE_UPLOAD_BUCKET_NAME)) {
            return {
              statusCode: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({
                message: 'Invalid extraData',
              }),
            };
          }
        }
      }
    }
  }

  const messages = await repo.batchCreateMessages(req.messages, userId, chatId);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      messages,
    }),
  };
});
