import { UpdateSystemContextTitleRequest } from 'generative-ai-use-cases';
import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const systemContextId = event.pathParameters!.systemContextId!;
  const req: UpdateSystemContextTitleRequest = JSON.parse(event.body!);
  const systemContext = await repo.updateSystemContextTitle(
    userId,
    systemContextId,
    req.title
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ systemContext }),
  };
});
