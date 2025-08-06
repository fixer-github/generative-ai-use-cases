import { SystemContext } from 'generative-ai-use-cases';
import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const req: SystemContext = JSON.parse(event.body!);
  const messages = await repo.createSystemContext(
    userId,
    req.systemContextTitle,
    req.systemContext
  );

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
