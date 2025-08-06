import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  console.log('Getting token usage statistics', { event });

  const { startDate, endDate } = event.queryStringParameters || {};

  if (!startDate || !endDate) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'startDate and endDate parameters are required',
      }),
    };
  }

  // Get aggregated data for the specified period
  const stats = await repo.aggregateTokenUsage(startDate, endDate, [userId]);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(stats),
  };
});
