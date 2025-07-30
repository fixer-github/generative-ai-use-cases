import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantId, getTenantTableName } from './tenantUtils';

export interface RepositoryContext {
  tenantId: string;
  getTableName(baseTableName: string): string;
}

/**
 * Create a repository context from an API Gateway event
 */
export const createRepositoryContext = (event: APIGatewayProxyEvent): RepositoryContext => {
  const tenantId = getTenantId(event);
  
  return {
    tenantId,
    getTableName: (baseTableName: string) => getTenantTableName(baseTableName, tenantId),
  };
};

/**
 * Create a default repository context for backwards compatibility
 */
export const createDefaultRepositoryContext = (): RepositoryContext => {
  const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
  
  return {
    tenantId,
    getTableName: (baseTableName: string) => baseTableName,
  };
};