import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
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
        message: 'You do not have permission to share this chat.',
      }),
    };
  }

  const response = await repo.createShareId(userId, chatId);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(response),
  };
});
