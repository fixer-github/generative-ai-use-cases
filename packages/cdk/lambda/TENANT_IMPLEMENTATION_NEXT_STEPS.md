# Multi-Tenant Implementation - Remaining Steps

## 1. Update CDK Infrastructure

### 1.1 Modify Lambda Environment Variables

Update `packages/cdk/lib/construct/api.ts` to use table prefixes:

```typescript
// Instead of:
environment: {
  TABLE_NAME: table.tableName,  // e.g., "GenerativeAIUseCasesStack-DatabaseXXXXXXXX"
}

// Use:
environment: {
  TABLE_NAME: 'ChatHistory',  // Base name only
  STATS_TABLE_NAME: 'TokenUsageStats',
  DEFAULT_TENANT_ID: 'default',
}
```

### 1.2 Update IAM Permissions

Add permissions for tenant-specific tables in the Lambda execution roles:

```typescript
// In api.ts, add a policy for tenant tables
const tenantTablePolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    'dynamodb:PutItem',
    'dynamodb:GetItem',
    'dynamodb:Query',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:BatchGetItem'
  ],
  resources: [
    `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/*-tenant-*`,
    `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/*-tenant-*/index/*`
  ]
});

// Add to each Lambda function that needs DynamoDB access
createChatFunction.addToRolePolicy(tenantTablePolicy);
```

## 2. Migrate All Lambda Handlers

### 2.1 Handlers to Migrate

#### Chat Management
- [ ] `createChat.ts` → Use `repositoryV2.ts`
- [ ] `deleteChat.ts` → Use `repositoryV2.ts`
- [ ] `listChats.ts` → Use `repositoryV2.ts`
- [ ] `findChatById.ts` → Use `repositoryV2.ts`
- [ ] `updateTitle.ts` → Use `repositoryV2.ts`

#### Message Management
- [ ] `createMessages.ts` → Use `repositoryV2.ts`
- [ ] `listMessages.ts` → Use `repositoryV2.ts`
- [ ] `updateFeedback.ts` → Use `repositoryV2.ts`

#### System Context
- [ ] `createSystemContext.ts` → Use `repositoryV2.ts`
- [ ] `listSystemContexts.ts` → Use `repositoryV2.ts`
- [ ] `updateSystemContextTitle.ts` → Use `repositoryV2.ts`
- [ ] `deleteSystemContext.ts` → Use `repositoryV2.ts`

#### Sharing
- [ ] `createShareId.ts` → Use `repositoryV2.ts`
- [ ] `findShareId.ts` → Use `repositoryV2.ts`
- [ ] `deleteShareId.ts` → Use `repositoryV2.ts`
- [ ] `getSharedChat.ts` → Use `repositoryV2.ts`

#### Video Jobs
- [ ] `generateVideo.ts` → Update `repositoryVideoJob.ts`
- [ ] `listVideoJobs.ts` → Update `repositoryVideoJob.ts`
- [ ] `deleteVideoJob.ts` → Update `repositoryVideoJob.ts`

#### Use Case Builder
- [ ] Update all handlers in `useCaseBuilder/` folder

### 2.2 Migration Template

For each handler, follow this pattern:

```typescript
// Old pattern
import { someFunction } from './repository';

export const handler = async (event: APIGatewayProxyEvent) => {
  const result = await someFunction(param1, param2);
  // ...
};

// New pattern
import { createTenantRepository } from './repositoryV2';

export const handler = async (event: APIGatewayProxyEvent) => {
  const repository = createTenantRepository(event);
  const result = await repository.someFunction(param1, param2);
  // ...
};
```

## 3. Create Tenant Table Management

### 3.1 Create Table Creation Script

Create `packages/cdk/scripts/create-tenant-tables.ts`:

```typescript
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';

const createTenantTables = async (tenantId: string) => {
  const client = new DynamoDBClient({});
  
  // Chat History Table
  await client.send(new CreateTableCommand({
    TableName: `ChatHistory-tenant-${tenantId}`,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'createdDate', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'createdDate', AttributeType: 'S' }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  }));
  
  // Token Usage Stats Table
  await client.send(new CreateTableCommand({
    TableName: `TokenUsageStats-tenant-${tenantId}`,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'model', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'model', AttributeType: 'S' },
      { AttributeName: 'month', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'MonthIndex',
      KeySchema: [
        { AttributeName: 'month', KeyType: 'HASH' },
        { AttributeName: 'model', KeyType: 'RANGE' }
      ],
      Projection: { ProjectionType: 'ALL' }
    }],
    BillingMode: 'PAY_PER_REQUEST'
  }));
  
  // Use Case Table (if using use case builder)
  await client.send(new CreateTableCommand({
    TableName: `UseCase-tenant-${tenantId}`,
    // ... table schema
  }));
};
```

### 3.2 Create Tenant Onboarding Lambda

Create a Lambda function to handle tenant onboarding:

```typescript
export const handler = async (event: { tenantId: string }) => {
  // Create tables
  await createTenantTables(event.tenantId);
  
  // Initialize with default data if needed
  // ...
  
  return { success: true };
};
```

## 4. Testing Strategy

### 4.1 Unit Tests

Create tests for tenant utilities:

```typescript
// test/tenantUtils.test.ts
describe('getTenantId', () => {
  it('should extract tenant ID from JWT claims', () => {
    const event = {
      requestContext: {
        authorizer: {
          claims: { 'custom:tenant_id': 'tenant123' }
        }
      }
    };
    expect(getTenantId(event)).toBe('tenant123');
  });
  
  it('should return default for missing tenant ID', () => {
    const event = { requestContext: {} };
    expect(getTenantId(event)).toBe('default');
  });
});
```

### 4.2 Integration Tests

1. **Create test tenants** with different IDs
2. **Create test data** in each tenant's tables
3. **Verify isolation** - ensure tenant A cannot access tenant B's data
4. **Test edge cases**:
   - Missing tenant ID
   - Invalid tenant ID
   - Expired tokens

### 4.3 Manual Testing Checklist

- [ ] Login as user with tenant ID in JWT
- [ ] Create a chat - verify it goes to correct tenant table
- [ ] List chats - verify only tenant's chats are returned
- [ ] Try to access another tenant's data (should fail)
- [ ] Test with user without tenant ID (should use default)

## 5. Deployment Strategy

### 5.1 Phase 1: Parallel Deployment
1. Deploy new code with V2 handlers
2. Keep existing handlers unchanged
3. Create new API routes for testing

### 5.2 Phase 2: Gradual Migration
1. Update API Gateway routes one by one
2. Monitor CloudWatch logs for errors
3. Keep rollback plan ready

### 5.3 Phase 3: Cleanup
1. Remove old repository code
2. Remove old handlers
3. Update all documentation

## 6. Monitoring and Alerts

### 6.1 CloudWatch Alarms

Create alarms for:
- Lambda errors by tenant
- DynamoDB throttling by table
- Unauthorized access attempts

### 6.2 Dashboards

Create dashboards showing:
- Requests per tenant
- Table usage per tenant
- Error rates by tenant

## 7. Documentation Updates

### 7.1 Update API Documentation
- Document tenant ID requirement in JWT
- Update example requests

### 7.2 Update Developer Guide
- How to test with different tenants
- How to create new tenant tables
- Troubleshooting guide

## 8. Future Enhancements

### 8.1 Automated Tenant Provisioning
- API endpoint to create new tenant
- Automatic table creation
- Tenant configuration management

### 8.2 Tenant Metrics
- Usage tracking per tenant
- Billing integration
- Rate limiting per tenant

### 8.3 Cross-Tenant Features
- Shared resources between tenants
- Tenant switching for admin users
- Data migration between tenants

## Timeline Estimate

- **Week 1**: Infrastructure updates and core utilities
- **Week 2**: Migrate 50% of handlers
- **Week 3**: Migrate remaining handlers and testing
- **Week 4**: Deployment and monitoring setup

## Risk Mitigation

1. **Data Loss**: Take backups before migration
2. **Performance**: Test with production-like load
3. **Rollback Plan**: Keep old code ready for quick rollback
4. **Communication**: Notify users about maintenance window