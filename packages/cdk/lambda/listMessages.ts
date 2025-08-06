import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const chatId = event.pathParameters!.chatId!;
  const chat = await repo.findChatById(userId, chatId);

  if (chat === null) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Forbidden' }),
    };
  }

  const messages = await repo.listMessages(chatId);

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
