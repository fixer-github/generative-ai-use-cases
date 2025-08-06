import { SystemContext } from 'generative-ai-use-cases';
import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId) => {
  const systemContextItems: SystemContext[] =
    await repo.listSystemContexts(userId);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(systemContextItems),
  };
});
