import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const exclusiveStartKey = event?.queryStringParameters?.exclusiveStartKey;
  const res = await repo.listChats(userId, exclusiveStartKey);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(res),
  };
});
