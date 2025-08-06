import { UpdateFeedbackRequest } from 'generative-ai-use-cases';
import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const chatId = event.pathParameters!.chatId!;
  const req: UpdateFeedbackRequest = JSON.parse(event.body!);

  // Authorization check: verify that this message belongs to the user's chat
  const messages = await repo.listMessages(chatId);

  // Find a message that matches the createdDate (message ID) in the request
  const targetMessage = messages.find(
    (m) => m.createdDate === req.createdDate
  );

  // Return 403 if the message doesn't exist or doesn't belong to the user
  if (!targetMessage || targetMessage.userId !== `user#${userId}`) {
    console.warn(
      `Authorization error: User ${userId} attempted to provide feedback on message ${req.createdDate} in chat ${chatId} belonging to another user`
    );
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message:
          'You do not have permission to provide feedback on this message.',
      }),
    };
  }

  const message = await repo.updateFeedback(chatId, req);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ message }),
  };
});
