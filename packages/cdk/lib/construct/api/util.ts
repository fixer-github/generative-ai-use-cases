// Helper function to generate consistent environment variables for Lambda functions
export const getBaseEnvironment = (
  additionalEnvVars: Record<string, string> = {}
) => ({
  // TABLE_NAME: TABLE_PREFIX,
  // DEFAULT_TABLE_NAME: props.table.tableName,
  // DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
  // ENVIRONMENT: props.environment || 'dev',
  // IDENTITY_POOL_ID: props.idPool.identityPoolId,
  // USER_POOL_ID: props.userPool.userPoolId,
  // AWS_ACCOUNT_ID: Stack.of(this).account!,
  // ...(props.tenantManager
  //   ? {
  //       TENANTS_TABLE_NAME: props.tenantManager.tenantsTable.tableName,
  //     }
  //   : {}),
  ...additionalEnvVars,
});
