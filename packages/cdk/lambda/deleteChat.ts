import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const chatId = event.pathParameters!.chatId!;
  await repo.deleteChat(userId, chatId);

  const shareId = await repo.findShareId(userId, chatId);

  if (shareId) {
    await repo.deleteShareId(shareId.shareId.split('#')[1]);
  }

  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
});
