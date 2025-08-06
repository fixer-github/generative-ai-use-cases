import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const chatId = event.pathParameters!.chatId!;
  const chat = await repo.findChatById(userId, chatId);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      chat,
    }),
  };
});
