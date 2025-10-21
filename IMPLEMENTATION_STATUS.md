# Hybrid ToC/ToB Authorization Implementation Status

## Completed ✅

### 1. Authorization Schema Design
- ✅ Complete OpenFGA schema with entitlement-based model (`authorization-schema.fga`)
- ✅ Support for ToC (individual user subscriptions)
- ✅ Support for ToB (tenant subscriptions + admin grants)
- ✅ Additive union permission resolution with explicit deny
- ✅ Multi-level entitlements (usecase, model, resource)
- ✅ Quota management with conditions
- ✅ Plan inheritance support

### 2. Documentation
- ✅ Comprehensive README with ToC/ToB scenarios (`packages/cdk/lib/construct/openfga/README.md`)
- ✅ Complete migration guide (`packages/cdk/lib/construct/openfga/MIGRATION_GUIDE.md`)
- ✅ Schema with extensive inline documentation and usage examples

### 3. OpenFGA Client Utility
- ✅ Created `packages/cdk/lambda/utils/openfgaClient.ts` with:
  - Permission check functions (usecase, model, resource)
  - Entitlement management (grant/revoke/block)
  - Quota grant management
  - Tenant membership management
  - Resource ownership and sharing
  - Batch operations support

### 4. Lambda Authorizer (Partial)
- ✅ Updated imports to use new utility module
- ✅ Added user quota lookup functions
- ✅ Added tenant quota lookup functions
- ✅ Created API path parser for capability-based routing
- ⚠️  Handler function needs completion

## In Progress 🚧

### Lambda Authorizer Handler
The main handler function in `packages/cdk/lambda/openfga-authorizer/openfga-authorizer.ts` needs to be updated to:

**Current state:**
- Old logic uses direct OpenFGA client
- Checks resources directly without capability abstraction

**Required changes:**
1. Remove old permission check logic (lines ~280-382)
2. Implement new logic using utility functions:
   ```typescript
   // Parse request
   const parsedPath = parseApiPath(event.path, event.httpMethod);

   // Route based on category
   if (parsedPath.category === 'usecase') {
     result = await checkUsecasePermission(userId, parsedPath.resourceId);
   } else if (parsedPath.category === 'model') {
     // Get quota context
     const quotaContext = await buildQuotaContext(userId, tenantId, parsedPath.resourceId);
     result = await checkModelPermission(userId, parsedPath.resourceId, quotaContext);
   } else {
     result = await checkResourcePermission(
       userId,
       parsedPath.resourceType,
       parsedPath.resourceId,
       parsedPath.permission
     );
   }
   ```

## Pending 📋

### 1. Admin APIs for Entitlement Management
**Location:** `packages/cdk/lambda/admin/`

**Files to create:**
- `grantEntitlement.ts` - Grant entitlement to user by tenant admin
- `revokeEntitlement.ts` - Revoke entitlement from user
- `blockCapability.ts` - Explicitly block user from capability
- `unblockCapability.ts` - Remove block
- `listUserEntitlements.ts` - List user's effective entitlements

**Functionality:**
- Verify requester is tenant admin
- Call appropriate `openfgaClient` utility functions
- Return success/error responses
- Log operations for audit

### 2. Admin APIs for Quota Management
**Location:** `packages/cdk/lambda/admin/`

**Files to create:**
- `setUserQuota.ts` - Set individual quota limit for user
- `removeUserQuota.ts` - Remove individual quota limit
- `getQuotaUsage.ts` - View tenant and user quota usage

**Functionality:**
- Store quota limits in DynamoDB
- Create quota_grant tuples in OpenFGA
- Validate limits (user limit ≤ tenant pool)

### 3. Plan Subscription Service
**Location:** `packages/cdk/lambda/subscriptions/`

**Files to create:**
- `subscribeUserToPlan.ts` - ToC: User subscribes to plan
- `unsubscribeUserFromPlan.ts` - ToC: User cancels plan
- `subscribeTenantToPlan.ts` - ToB: Tenant subscribes to plan
- `changeTenantPlan.ts` - ToB: Change tenant plan (with entitlement migration)

**Functionality:**
- Create/update plan subscription tuples
- Link plan entitlements
- Handle plan changes (migrate entitlements)
- Update DynamoDB plan records

### 4. DynamoDB Table Schemas
**Location:** `packages/cdk/lib/constructs/`

**Tables to create/update:**

**UserPlanSubscriptions:**
```
PK: user_id
SK: plan_id
Attributes: subscription_status, start_date, end_date, payment_method
```

**TenantPlanSubscriptions:**
```
PK: tenant_id
SK: plan_id
Attributes: subscription_status, start_date, max_users, billing_contact
```

**UserQuotaLimits:**
```
PK: user_id
SK: tenant_model (e.g., "acme#claude-sonnet")
Attributes: daily_limit, monthly_limit, set_by_admin
```

**UsageTracking:**
```
PK: user_id_resource (e.g., "user123#model")
SK: date_model (e.g., "2025-10-21#claude-sonnet")
Attributes: count, last_updated
```

**PlanDefinitions:**
```
PK: plan_id
Attributes: plan_name, tier, monthly_price, entitlements[], quotas{}
```

### 5. Migration Scripts
**Location:** `packages/cdk/lambda/migrations/`

**Scripts to create:**
- `01-create-entitlements.ts` - Create entitlement objects for all capabilities
- `02-link-plan-entitlements.ts` - Link plans to entitlements
- `03-migrate-tenant-memberships.ts` - Migrate existing tenant memberships
- `04-migrate-tenant-plans.ts` - Convert tenant plans to new schema
- `05-link-capabilities.ts` - Link entitlements to capabilities
- `06-validate-migration.ts` - Verify migration success

### 6. Integration Tests
**Location:** `packages/cdk/lambda/__tests__/authorization/`

**Test suites to create:**
- `toc-standalone-user.test.ts` - ToC scenarios without tenant
- `toc-hybrid-user.test.ts` - ToC user with tenant membership
- `tob-tenant-plan.test.ts` - ToB tenant plan scenarios
- `tob-admin-grants.test.ts` - ToB admin entitlement grants
- `explicit-deny.test.ts` - Tenant admin blocks
- `quota-enforcement.test.ts` - Quota checks (user + tenant pool)
- `plan-inheritance.test.ts` - Plan hierarchy tests
- `resource-permissions.test.ts` - Conversation/document access

### 7. CDK Stack Updates
**Location:** `packages/cdk/lib/`

**Updates required:**
- Add new DynamoDB tables to stack
- Deploy admin API Lambda functions
- Update API Gateway routes
- Configure environment variables for new tables
- Add IAM permissions for OpenFGA and DynamoDB
- Deploy migration Lambda functions (one-time execution)

### 8. CloudWatch Metrics & Logging
**Location:** Throughout Lambda functions

**Metrics to add:**
- `Authorization/ToC/PermissionChecks` - ToC-specific checks
- `Authorization/ToB/PermissionChecks` - ToB-specific checks
- `Authorization/EntitlementGrants` - Admin grant operations
- `Authorization/QuotaExceeded` - Quota violations (user vs tenant)
- `Authorization/ExplicitDeny` - Blocked user attempts

## Next Steps (Priority Order)

1. ✅ **Complete Lambda Authorizer Handler** (High Priority)
   - Finish updating handler function
   - Test with different API paths
   - Add comprehensive logging

2. **Create Admin APIs** (High Priority)
   - Essential for ToB model
   - Needed before migration
   - Implementation order: Grant → Revoke → Block → Quota

3. **Create DynamoDB Tables** (High Priority)
   - Required by all other components
   - Start with PlanDefinitions and UserQuotaLimits

4. **Implement Plan Subscription Service** (Medium Priority)
   - Enables ToC and ToB plan management
   - Foundation for entitlement provisioning

5. **Create Migration Scripts** (Medium Priority)
   - Test on development environment first
   - Validate each step before proceeding

6. **Write Integration Tests** (Medium Priority)
   - Critical for validation
   - Prevents regressions

7. **Update CDK Stack** (Low Priority - Infrastructure)
   - Deploy all components together
   - Test in staging environment first

8. **Add CloudWatch Metrics** (Low Priority - Observability)
   - Implement alongside features
   - Essential for production monitoring

## Deployment Strategy

1. **Phase 1: Infrastructure** (Week 1)
   - Deploy new DynamoDB tables
   - Deploy updated OpenFGA service
   - Deploy updated Lambda authorizer (with feature flag OFF)

2. **Phase 2: Admin APIs** (Week 2)
   - Deploy admin entitlement APIs
   - Deploy admin quota APIs
   - Enable for admin users only (testing)

3. **Phase 3: Migration** (Week 3)
   - Run migration scripts on test tenants
   - Validate permission checks
   - Gradual rollout with feature flags

4. **Phase 4: Full Rollout** (Week 4)
   - Enable for all tenants
   - Monitor metrics closely
   - Ready rollback procedure

## Known Dependencies

- OpenFGA service must be deployed and accessible
- DynamoDB tables must exist before Lambda deployment
- Migration must complete before enabling new schema
- Admin APIs required for ToB entitlement management

## Risks & Mitigation

1. **Risk:** Migration failure
   - **Mitigation:** Dual-write during transition, rollback plan documented

2. **Risk:** Permission check performance degradation
   - **Mitigation:** Caching, pre-checks, batch operations

3. **Risk:** Quota enforcement gaps
   - **Mitigation:** Both app-level and OpenFGA-level checks

4. **Risk:** Admin permission escalation
   - **Mitigation:** Strict tenant isolation, admin checks in every API

## Success Criteria

- ✅ All tests passing
- ✅ Authorization latency p95 < 50ms
- ✅ Zero permission bypass vulnerabilities
- ✅ ToC and ToB models fully functional
- ✅ Migration successful with zero data loss
- ✅ Admin APIs deployed and functional
- ✅ Metrics and monitoring operational
