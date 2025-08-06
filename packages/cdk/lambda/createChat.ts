import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId) => {
  const chat = await repo.createChat(userId);

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
