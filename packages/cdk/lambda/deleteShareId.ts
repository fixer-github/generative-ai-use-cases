import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const shareId = event.pathParameters!.shareId!;

  await repo.deleteShareId(shareId);

  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
});
