import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const systemContextId = event.pathParameters!.systemContextId!;
  await repo.deleteSystemContext(userId, systemContextId);

  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
});
