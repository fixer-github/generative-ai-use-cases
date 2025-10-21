# Migration Guide: ToC/ToB Hybrid Authorization Schema

This guide provides step-by-step instructions for migrating from the previous tenant-only authorization schema to the new hybrid ToC (To Consumer) and ToB (To Business) entitlement-based schema.

## Table of Contents

1. [Overview](#overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Migration Phases](#migration-phases)
4. [Rollback Procedures](#rollback-procedures)
5. [Validation & Testing](#validation--testing)
6. [Troubleshooting](#troubleshooting)

## Overview

### What's Changing

**Old Schema:**
- Single permission model: tenant membership only
- Users get permissions through tenant plan
- No support for individual user subscriptions
- No direct entitlement assignment

**New Schema:**
- Hybrid ToC/ToB support
- Entitlements as first-class objects
- Additive union permission resolution
- Support for:
  - Individual user plan subscriptions (ToC)
  - Tenant plan subscriptions (ToB)
  - Admin-assigned entitlements (ToB targeted grants)
  - Explicit deny capability
  - Multi-level quota management

### Migration Strategy

- **Zero downtime migration** using dual-write approach
- **Gradual rollout** with feature flags
- **Backward compatible** during transition period
- **Automatic fallback** if issues detected

## Pre-Migration Checklist

### 1. Backup Current State

```bash
# Export current authorization model
fga model get \
  --store-id $STORE_ID \
  --api-url $OPENFGA_API_URL \
  > backup/old-model-$(date +%Y%m%d).json

# Export all tuples
fga tuple list \
  --store-id $STORE_ID \
  --api-url $OPENFGA_API_URL \
  --max-pages 1000 \
  > backup/old-tuples-$(date +%Y%m%d).jsonl
```

### 2. Inventory Existing Data

```bash
# Count tenants
aws dynamodb scan \
  --table-name Tenants \
  --select COUNT

# Count users per tenant
aws dynamodb query \
  --table-name Users \
  --index-name TenantIndex \
  --select COUNT

# List current plans
aws dynamodb scan \
  --table-name PlanPermissions \
  --projection-expression "plan_id"
```

### 3. Test Environment Setup

```bash
# Create test OpenFGA store
fga store create \
  --name "test-migration-$(date +%Y%m%d)" \
  --api-url $OPENFGA_API_URL

export TEST_STORE_ID="<new-store-id>"

# Deploy new schema to test store
fga model write \
  --store-id $TEST_STORE_ID \
  --file authorization-schema.fga \
  --api-url $OPENFGA_API_URL
```

### 4. Performance Baseline

```bash
# Measure current authorization check latency
aws cloudwatch get-metric-statistics \
  --namespace Authorization/OpenFGA \
  --metric-name AuthorizationLatency \
  --statistics Average,Maximum \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600

# Current tuple count
fga tuple list --store-id $STORE_ID --max-pages 1 | jq '.tuples | length'
```

## Migration Phases

### Phase 1: Schema Deployment (Week 1)

#### Step 1.1: Deploy New Schema to Production Store

```bash
# Create new authorization model (keeps old model active)
fga model write \
  --store-id $STORE_ID \
  --file authorization-schema.fga \
  --api-url $OPENFGA_API_URL

# Verify new model ID
export NEW_MODEL_ID=$(fga model list --store-id $STORE_ID --max-pages 1 | jq -r '.authorization_models[0].id')
echo "New model ID: $NEW_MODEL_ID"
```

#### Step 1.2: Create Entitlement Objects

Create entitlement objects for all existing capabilities:

```typescript
// migration-scripts/create-entitlements.ts
import { OpenFGAClient } from '@openfga/sdk';

const client = new OpenFGAClient({
  apiUrl: process.env.OPENFGA_API_URL,
  storeId: process.env.STORE_ID,
});

// Define entitlements
const entitlements = [
  // Usecase entitlements
  'entitlement:usecase_chat',
  'entitlement:usecase_rag',
  'entitlement:usecase_translation',
  'entitlement:usecase_text_generation',
  'entitlement:usecase_image_generation',

  // Model entitlements
  'entitlement:model_claude_haiku',
  'entitlement:model_claude_sonnet',
  'entitlement:model_claude_opus',
  'entitlement:model_gpt4',

  // Feature entitlements
  'entitlement:api_access',
  'entitlement:bulk_operations',
  'entitlement:advanced_settings',
];

// Link plans to entitlements
const planEntitlements = {
  'plan:free': [
    'entitlement:usecase_chat',
    'entitlement:model_claude_haiku',
  ],
  'plan:pro': [
    'entitlement:usecase_chat',
    'entitlement:usecase_rag',
    'entitlement:usecase_translation',
    'entitlement:model_claude_haiku',
    'entitlement:model_claude_sonnet',
    'entitlement:model_gpt4',
  ],
  'plan:enterprise': [
    ...entitlements, // All entitlements
  ],
};

// Write tuples
for (const [plan, ents] of Object.entries(planEntitlements)) {
  for (const entitlement of ents) {
    await client.write({
      writes: [
        {
          user: entitlement,
          relation: 'entitles',
          object: plan,
        },
      ],
    });
  }
}
```

Run the script:

```bash
npm run migration:create-entitlements
```

#### Step 1.3: Migrate Existing Tenant Memberships

Convert existing tenant memberships to new schema:

```typescript
// migration-scripts/migrate-memberships.ts
import { OpenFGAClient } from '@openfga/sdk';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const fgaClient = new OpenFGAClient({
  apiUrl: process.env.OPENFGA_API_URL,
  storeId: process.env.STORE_ID,
});

const dynamoClient = new DynamoDBClient({});

// Get all tenants
const tenants = await dynamoClient.send(
  new ScanCommand({ TableName: 'Tenants' })
);

for (const tenant of tenants.Items) {
  const tenantId = tenant.tenant_id.S;
  const planId = tenant.plan_id.S;

  // 1. Link tenant to plan
  await fgaClient.write({
    writes: [
      {
        user: `tenant:${tenantId}`,
        relation: 'tenant_subscriber',
        object: `plan:${planId}`,
      },
      {
        user: `plan:${planId}`,
        relation: 'plan_subscription',
        object: `tenant:${tenantId}`,
      },
    ],
  });

  // 2. Get plan entitlements
  const planEntitlements = await fgaClient.read({
    user: `plan:${planId}`,
    relation: 'entitles',
  });

  // 3. Link entitlements to tenant plan
  for (const tuple of planEntitlements.tuples) {
    const entitlementId = tuple.key.object;
    await fgaClient.write({
      writes: [
        {
          user: `plan:${planId}`,
          relation: 'via_tenant_plan',
          object: entitlementId,
        },
      ],
    });
  }

  console.log(`Migrated tenant: ${tenantId} with plan: ${planId}`);
}
```

Run the script:

```bash
npm run migration:migrate-memberships
```

#### Step 1.4: Link Entitlements to Capabilities

```typescript
// migration-scripts/link-capabilities.ts
const capabilityMappings = {
  // Usecase capabilities
  'usecase_capability:chat': 'entitlement:usecase_chat',
  'usecase_capability:rag': 'entitlement:usecase_rag',
  'usecase_capability:translation': 'entitlement:usecase_translation',

  // Model capabilities
  'model_capability:claude-haiku': 'entitlement:model_claude_haiku',
  'model_capability:claude-sonnet': 'entitlement:model_claude_sonnet',
  'model_capability:claude-opus': 'entitlement:model_claude_opus',
  'model_capability:gpt-4': 'entitlement:model_gpt4',
};

for (const [capability, entitlement] of Object.entries(capabilityMappings)) {
  await fgaClient.write({
    writes: [
      {
        user: entitlement,
        relation: 'entitlement',
        object: capability,
      },
    ],
  });
}
```

Run the script:

```bash
npm run migration:link-capabilities
```

### Phase 2: Dual-Write Implementation (Week 2)

#### Step 2.1: Update Lambda Authorizer

Update authorizer to check permissions using new schema:

```typescript
// lambda/authorizer/index.ts
import { OpenFGAClient } from '@openfga/sdk';

const USE_NEW_SCHEMA = process.env.USE_NEW_SCHEMA === 'true';

async function checkPermission(
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  if (USE_NEW_SCHEMA) {
    // New schema: check capability-based permissions
    const capabilityId = mapResourceToCapability(resource, action);

    const result = await fgaClient.check({
      user: `user:${userId}`,
      relation: 'can_execute',
      object: capabilityId,
    });

    return result.allowed;
  } else {
    // Old schema: check tenant membership
    return await checkLegacyPermission(userId, resource, action);
  }
}

function mapResourceToCapability(resource: string, action: string): string {
  // Map old resource format to new capability format
  if (resource.startsWith('usecase:')) {
    return `usecase_capability:${resource.split(':')[1]}`;
  }
  if (resource.startsWith('model:')) {
    return `model_capability:${resource.split(':')[1]}`;
  }
  // ... other mappings
  return resource;
}
```

#### Step 2.2: Deploy with Feature Flag

```typescript
// cdk/lib/lambda-authorizer-stack.ts
const authorizerFunction = new Function(this, 'Authorizer', {
  // ... other config
  environment: {
    USE_NEW_SCHEMA: process.env.USE_NEW_SCHEMA || 'false',
    OPENFGA_STORE_ID: process.env.OPENFGA_STORE_ID,
    // ... other env vars
  },
});
```

Deploy with flag disabled:

```bash
cdk deploy --context useNewSchema=false
```

#### Step 2.3: Validation Testing

Run comprehensive tests in production with new schema:

```bash
# Enable new schema for specific test tenant
export TEST_TENANT_ID="test-tenant-001"

# Temporarily enable new schema
aws lambda update-function-configuration \
  --function-name AuthorizerFunction \
  --environment "Variables={USE_NEW_SCHEMA=true,...}"

# Run test suite
npm run test:authorization:integration

# Check metrics
aws cloudwatch get-metric-statistics \
  --namespace Authorization/OpenFGA \
  --metric-name AuthorizationDecision \
  --dimensions Name=Decision,Value=Allow \
  --statistics Sum \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60

# Disable if any issues
aws lambda update-function-configuration \
  --function-name AuthorizerFunction \
  --environment "Variables={USE_NEW_SCHEMA=false,...}"
```

### Phase 3: Gradual Rollout (Week 3)

#### Step 3.1: Enable for Beta Tenants

```typescript
// Tenant-specific feature flag
const BETA_TENANTS = new Set([
  'tenant-beta-001',
  'tenant-beta-002',
  'tenant-beta-003',
]);

function useNewSchema(tenantId: string): boolean {
  return (
    process.env.USE_NEW_SCHEMA_GLOBAL === 'true' ||
    BETA_TENANTS.has(tenantId)
  );
}
```

#### Step 3.2: Monitor & Iterate

```bash
# Monitor authorization latency
aws cloudwatch get-metric-statistics \
  --namespace Authorization/OpenFGA \
  --metric-name AuthorizationLatency \
  --statistics Average,p95,p99 \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300

# Monitor error rates
aws logs filter-log-events \
  --log-group-name /aws/lambda/AuthorizerFunction \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) - 3600))000

# Check tuple growth
fga tuple list --store-id $STORE_ID --max-pages 1 | jq '.tuples | length'
```

#### Step 3.3: Expand Rollout

Gradually increase percentage of tenants:

```typescript
function useNewSchema(tenantId: string): boolean {
  if (process.env.USE_NEW_SCHEMA_GLOBAL === 'true') {
    return true;
  }

  // Hash-based rollout (10% -> 25% -> 50% -> 100%)
  const rolloutPercentage = parseInt(process.env.ROLLOUT_PERCENTAGE || '0');
  const hash = hashCode(tenantId);
  return (hash % 100) < rolloutPercentage;
}
```

Rollout schedule:
- **Week 3 Day 1-2**: 10% of tenants
- **Week 3 Day 3-4**: 25% of tenants
- **Week 3 Day 5-6**: 50% of tenants
- **Week 3 Day 7**: 100% of tenants

### Phase 4: Full Migration (Week 4)

#### Step 4.1: Enable New Schema Globally

```bash
# Update Lambda configuration
aws lambda update-function-configuration \
  --function-name AuthorizerFunction \
  --environment "Variables={USE_NEW_SCHEMA=true,ROLLOUT_PERCENTAGE=100,...}"

# Verify deployment
aws lambda get-function-configuration \
  --function-name AuthorizerFunction \
  --query 'Environment.Variables.USE_NEW_SCHEMA'
```

#### Step 4.2: Remove Legacy Code

After 1 week of stable operation:

```typescript
// Remove feature flags and legacy code paths
async function checkPermission(
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  // Only new schema logic remains
  const capabilityId = mapResourceToCapability(resource, action);

  const result = await fgaClient.check({
    user: `user:${userId}`,
    relation: 'can_execute',
    object: capabilityId,
  });

  return result.allowed;
}
```

#### Step 4.3: Cleanup Old Tuples

```bash
# Remove old tuple format (if different from new)
# Only if old tuples are no longer used

# Example: Remove old tenant membership tuples
fga tuple delete \
  --store-id $STORE_ID \
  user:* tenant:*#member
```

## Rollback Procedures

### Emergency Rollback (< 5 minutes)

If critical issues detected:

```bash
# Step 1: Disable new schema via feature flag
aws lambda update-function-configuration \
  --function-name AuthorizerFunction \
  --environment "Variables={USE_NEW_SCHEMA=false,...}"

# Step 2: Verify rollback
aws lambda get-function-configuration \
  --function-name AuthorizerFunction

# Step 3: Monitor recovery
aws cloudwatch get-metric-statistics \
  --namespace Authorization/OpenFGA \
  --metric-name AuthorizationLatency \
  --statistics Average \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60
```

### Full Rollback (Complete Reversion)

If new schema proves unsuitable:

```bash
# Step 1: Restore old model
fga model write \
  --store-id $STORE_ID \
  --file backup/old-model-YYYYMMDD.json \
  --api-url $OPENFGA_API_URL

# Step 2: Restore old tuples
cat backup/old-tuples-YYYYMMDD.jsonl | while read line; do
  echo "$line" | fga tuple write --store-id $STORE_ID
done

# Step 3: Deploy old Lambda code
git revert <migration-commit-hash>
cdk deploy

# Step 4: Verify restoration
npm run test:authorization:integration
```

## Validation & Testing

### Automated Test Suite

```bash
# Run full authorization test suite
npm run test:authorization

# Tests should cover:
# - ToC standalone users
# - ToC users with tenant membership
# - ToB tenant users with plan
# - ToB admin-assigned entitlements
# - Explicit deny scenarios
# - Quota enforcement
# - Plan inheritance
```

### Manual Test Scenarios

#### Test 1: ToC Standalone User

```bash
# Create test user without tenant
USER_ID="test-toc-user-001"

# Subscribe user to free plan
fga tuple write user:$USER_ID plan:free#user_subscriber

# Check permission
fga query check user:$USER_ID can_execute usecase_capability:chat
# Expected: ✓ Allowed
```

#### Test 2: ToC User with Tenant

```bash
# Create user with personal plan AND tenant membership
USER_ID="test-hybrid-user-001"
TENANT_ID="test-tenant-001"

# Personal subscription
fga tuple write user:$USER_ID plan:pro#user_subscriber

# Tenant membership
fga tuple write user:$USER_ID tenant:$TENANT_ID#member

# Check permissions
fga query check user:$USER_ID can_execute usecase_capability:rag
# Expected: ✓ Allowed (from pro plan)

fga query check user:$USER_ID can_execute model_capability:claude-opus
# Expected: ✓ Allowed (from tenant enterprise plan)
```

#### Test 3: Admin Assignment

```bash
# Admin grants specific entitlement
ADMIN_ID="test-admin-001"
USER_ID="test-user-002"
TENANT_ID="test-tenant-001"

# Create tenant entitlement
ENTITLEMENT_ID="tenant_entitlement:$TENANT_ID/$USER_ID/chat"
fga tuple write $ENTITLEMENT_ID tenant:$TENANT_ID#tenant
fga tuple write $ENTITLEMENT_ID user:$USER_ID#grantee
fga tuple write entitlement:usecase_chat $ENTITLEMENT_ID#via_tenant_assignment

# Check permission
fga query check user:$USER_ID can_execute usecase_capability:chat
# Expected: ✓ Allowed (from admin assignment)
```

#### Test 4: Explicit Deny

```bash
# Admin blocks user from capability
USER_ID="test-user-003"
TENANT_ID="test-tenant-001"

# Create block
BLOCK_ID="tenant_entitlement:$TENANT_ID/$USER_ID/image_block"
fga tuple write $BLOCK_ID tenant:$TENANT_ID#tenant
fga tuple write $BLOCK_ID user:$USER_ID#blocked
fga tuple write usecase_capability:image_generation $BLOCK_ID#blocked_by_tenant

# Check permission
fga query check user:$USER_ID can_execute usecase_capability:image_generation
# Expected: ✗ Denied (explicit block)
```

### Performance Validation

```bash
# Benchmark authorization checks
npm run benchmark:authorization

# Targets:
# - p50 latency: < 20ms
# - p95 latency: < 50ms
# - p99 latency: < 100ms
# - Error rate: < 0.1%
```

## Troubleshooting

### Issue: High Authorization Latency

**Symptoms**: p95 latency > 100ms

**Solutions**:
1. Check tuple count growth
```bash
fga tuple list --store-id $STORE_ID --max-pages 1 | jq '.tuples | length'
```

2. Enable query caching
```bash
# Update OpenFGA service configuration
CHECK_QUERY_CACHE_ENABLED=true
CHECK_QUERY_CACHE_TTL=5m
```

3. Scale up ECS tasks
```bash
aws ecs update-service \
  --cluster openfga-production \
  --service openfga \
  --desired-count 5
```

### Issue: Permission Check Failures

**Symptoms**: Users denied access incorrectly

**Solutions**:
1. Verify entitlement chains
```bash
# Check user's effective entitlements
fga query list-objects \
  user:$USER_ID \
  can_execute \
  usecase_capability:*
```

2. Check tuple writes succeeded
```bash
# List user's relationships
fga tuple list \
  --store-id $STORE_ID \
  --user user:$USER_ID
```

3. Validate plan-entitlement links
```bash
# Check plan provides expected entitlements
fga tuple list \
  --store-id $STORE_ID \
  --user plan:$PLAN_ID \
  --relation entitles
```

### Issue: Quota Not Enforced

**Symptoms**: Users exceed quota limits

**Solutions**:
1. Verify quota_grant tuples
```bash
fga tuple list \
  --store-id $STORE_ID \
  --object quota_grant:*
```

2. Check context passed to check call
```typescript
// Ensure context includes quota data
await fgaClient.check({
  user: `user:${userId}`,
  relation: 'can_execute',
  object: `model_capability:${modelId}`,
  context: {
    user_current_usage: userUsage,
    user_quota_limit: userLimit,
    tenant_current_usage: tenantUsage,
    tenant_quota_limit: tenantLimit,
  },
});
```

3. Update DynamoDB quota counters
```bash
# Verify quota tracking
aws dynamodb get-item \
  --table-name TenantUsage \
  --key "{\"pk\":{\"S\":\"${TENANT_ID}#model\"},\"sk\":{\"S\":\"${DATE}#${MODEL_ID}\"}}"
```

## Post-Migration Validation

### Week 1 Post-Migration

- [ ] Zero authorization errors in CloudWatch
- [ ] Authorization latency within SLA (p95 < 50ms)
- [ ] All test scenarios passing
- [ ] No customer escalations related to permissions

### Week 2 Post-Migration

- [ ] Successful admin entitlement grants
- [ ] Quota enforcement working correctly
- [ ] Plan inheritance functioning
- [ ] Explicit deny working as expected

### Week 4 Post-Migration

- [ ] Legacy code removed
- [ ] Documentation updated
- [ ] Team training completed
- [ ] Monitoring dashboards updated

## Support & Escalation

For issues during migration:
1. Check [Troubleshooting](#troubleshooting) section
2. Review CloudWatch logs and metrics
3. Consult `authorization-schema.fga` for schema details
4. Escalate to platform team if unresolved

## Success Criteria

Migration is considered successful when:
- ✅ All tenants migrated to new schema
- ✅ ToC and ToB models fully functional
- ✅ Authorization latency meets SLA
- ✅ Zero permission-related incidents
- ✅ Admin APIs deployed and functional
- ✅ Documentation complete and accurate
