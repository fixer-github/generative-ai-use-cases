# OpenFGA CDK Constructs

AWS CDK constructs for deploying OpenFGA on ECS Fargate with PostgreSQL RDS backend.

## Overview

This module provides production-ready CDK constructs for:
- **OpenFGA Service** on ECS Fargate with auto-scaling
- **RDS PostgreSQL** database with encryption and backups
- **Application Load Balancer** for HTTP and gRPC endpoints
- **CloudWatch** logging and metrics integration

## Quick Start

```typescript
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { OpenFGADatabase, OpenFGAService } from './construct/openfga';

// Get or create VPC
const vpc = Vpc.fromLookup(this, 'VPC', { isDefault: true });

// Create PostgreSQL database
const database = new OpenFGADatabase(this, 'Database', {
  vpc,
  environment: 'production',
  multiAz: true,
  instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL),
});

// Create OpenFGA service
const openFGA = new OpenFGAService(this, 'Service', {
  vpc,
  database,
  environment: 'production',
  desiredCount: 3,
  minCapacity: 2,
  maxCapacity: 10,
});

// Output endpoints
new CfnOutput(this, 'Endpoint', {
  value: openFGA.endpoint,
});
```

## Architecture

```
┌─────────────────┐
│  Lambda/ECS     │
│  Applications   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│       ALB       │─────▶│ ECS Fargate      │
│  (HTTP + gRPC)  │      │ - OpenFGA Tasks  │
│                 │      │ - Auto-scaling   │
└─────────────────┘      └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │ RDS PostgreSQL   │
                         │ - Encrypted      │
                         │ - Multi-AZ (opt) │
                         └──────────────────┘
```

## Components

### OpenFGADatabase

Creates a managed RDS PostgreSQL instance optimized for OpenFGA.

**Features:**
- PostgreSQL 15.4 (OpenFGA compatible)
- Encryption at rest
- Automated backups (7 days retention)
- Performance Insights enabled
- CloudWatch Logs integration
- Multi-AZ deployment (optional)

**Configuration:**
```typescript
const database = new OpenFGADatabase(this, 'Database', {
  vpc,
  environment: 'production',

  // Instance sizing
  instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
  allocatedStorageGb: 20,

  // High availability
  multiAz: true,
  backupRetentionDays: 7,

  // Security
  deletionProtection: true,
});
```

### OpenFGAService

Deploys OpenFGA on ECS Fargate with Application Load Balancer.

**Features:**
- ECS Fargate serverless compute
- Application Load Balancer (HTTP:8080, gRPC:8081)
- Auto-scaling based on CPU/memory
- Health checks and monitoring
- Pre-shared key authentication
- Check query caching (5m TTL)

**Configuration:**
```typescript
const openFGA = new OpenFGAService(this, 'Service', {
  vpc,
  database,
  environment: 'production',

  // Task sizing
  cpu: 512,              // 0.5 vCPU
  memoryLimitMiB: 1024,  // 1 GB

  // Scaling
  desiredCount: 3,
  minCapacity: 2,
  maxCapacity: 10,

  // OpenFGA version
  imageTag: 'v1.5.0',

  // Security
  publicLoadBalancer: false,
  enablePlayground: false,
});
```

## Cost Estimation

### POC/Development Environment
- ECS Fargate (2 tasks × 0.25 vCPU): $18/month
- RDS db.t4g.micro: $15/month
- ALB: $16/month
- **Total: ~$49/month**

### Production Environment
- ECS Fargate (3-5 tasks × 0.5 vCPU): $54-90/month
- RDS db.t4g.small (Multi-AZ): $60/month
- ALB: $16/month
- **Total: ~$130-166/month**

**Savings vs SpiceDB+EKS: 70-75%**

## Usage with Lambda Authorizer

```typescript
import { AuthorizationSystem } from '../authorization/authorization-system';

const authSystem = new AuthorizationSystem(this, 'Auth', {
  userPool: cognito.userPool,
  openFGAEndpoint: openFGA.endpoint,
  openFGAStoreId: process.env.OPENFGA_STORE_ID!,
  openFGAKeySecretArn: openFGA.presharedKeysSecret.secretArn,
  vpc,
});

// Use with API Gateway
const api = new RestApi(this, 'Api', {
  defaultMethodOptions: {
    authorizer: new RequestAuthorizer(this, 'Authorizer', {
      handler: authSystem.authorizerFunction,
      identitySources: ['method.request.header.Authorization'],
    }),
  },
});
```

## Schema Management

### 1. Create Authorization Model

```bash
# Create store
fga store create --name "my-app" --api-url http://alb-endpoint:8080

# Write schema
fga model write \
  --store-id $STORE_ID \
  --file authorization-schema.fga \
  --api-url http://alb-endpoint:8080
```

### 2. Write Relationship Tuples

```bash
# Grant user membership
fga tuple write \
  --store-id $STORE_ID \
  user:alice tenant:acme#member

# Assign plan
fga tuple write \
  --store-id $STORE_ID \
  tenant:acme plan:pro#subscriber
```

### 3. Check Permissions

```bash
# Can user execute usecase?
fga query check \
  --store-id $STORE_ID \
  user:alice execute usecase:chat
```

## Authorization Model: Hybrid ToC/ToB Support

The authorization schema supports both **To-Consumer (ToC)** and **To-Business (ToB)** models with entitlement-based permissions.

### Business Models

#### ToC (To Consumer)
- Individual users subscribe to plans directly
- Users can exist without tenant membership (free tier)
- Users can optionally belong to tenants
- Permissions come from user's own plan subscription

#### ToB (To Business)
- Tenant subscribes to organization-wide plan
- Tenant admins assign entitlements to specific users
- Users don't subscribe to plans themselves
- Permissions come from tenant plan + admin assignments

#### Hybrid
- Users can have BOTH direct plan subscription AND tenant membership
- Permissions use additive union (most permissive)
- Tenant admins can explicitly deny specific capabilities

### Core Concepts

#### Entitlements
Entitlements are first-class objects representing specific capabilities. They can be granted through:
1. User's own plan subscription (ToC)
2. Tenant's plan subscription (ToB)
3. Direct admin assignment (ToB targeted grants)
4. Plan inheritance (bundling)

#### Permission Resolution
Permissions use **additive union** - a user has access if ANY source grants it:
- User plan subscription
- Tenant plan subscription
- Admin-assigned entitlement
- Plan inheritance

Tenant admins can override with **explicit deny** that blocks access regardless of other sources.

### Usage Scenarios

#### Scenario 1: ToC Standalone User (Free Tier)

```bash
# User alice subscribes to free plan
fga tuple write user:alice plan:free#user_subscriber

# Free plan provides chat entitlement
fga tuple write plan:free entitlement:usecase_chat#entitles
fga tuple write entitlement:usecase_chat plan:free#via_user_plan

# Link entitlement to capability
fga tuple write usecase_capability:chat entitlement:usecase_chat#entitlement

# Check permission
fga query check user:alice can_execute usecase_capability:chat
# ✓ Allowed via user's free plan
```

#### Scenario 2: ToC User with Tenant (Hybrid)

```bash
# User bob has personal pro plan
fga tuple write user:bob plan:pro#user_subscriber
fga tuple write plan:pro entitlement:usecase_rag#entitles
fga tuple write entitlement:usecase_rag plan:pro#via_user_plan

# Bob also belongs to tenant with enterprise plan
fga tuple write user:bob tenant:acme#member
fga tuple write tenant:acme plan:enterprise#plan_subscription
fga tuple write tenant:acme plan:enterprise#tenant_subscriber
fga tuple write plan:enterprise entitlement:model_opus#entitles
fga tuple write entitlement:model_opus plan:enterprise#via_tenant_plan

# Link to capabilities
fga tuple write usecase_capability:rag entitlement:usecase_rag#entitlement
fga tuple write model_capability:claude-opus entitlement:model_opus#entitlement

# Bob gets permissions from BOTH sources
fga query check user:bob can_execute usecase_capability:rag
# ✓ Allowed via personal pro plan

fga query check user:bob can_execute model_capability:claude-opus
# ✓ Allowed via tenant enterprise plan
```

#### Scenario 3: ToB Admin Grant

```bash
# Tenant has basic plan
fga tuple write tenant:acme plan:basic#plan_subscription

# Admin grants chat to specific user charlie
fga tuple write user:charlie tenant:acme#member
fga tuple write tenant_entitlement:acme/charlie/chat tenant:acme#tenant
fga tuple write tenant_entitlement:acme/charlie/chat user:charlie#grantee
fga tuple write entitlement:usecase_chat tenant_entitlement:acme/charlie/chat#via_tenant_assignment
fga tuple write usecase_capability:chat entitlement:usecase_chat#entitlement

# Check permission
fga query check user:charlie can_execute usecase_capability:chat
# ✓ Allowed via admin assignment
```

#### Scenario 4: Explicit Deny

```bash
# Tenant provides image generation
fga tuple write plan:enterprise entitlement:usecase_image_gen#entitles
fga tuple write entitlement:usecase_image_gen plan:enterprise#via_tenant_plan

# Admin explicitly blocks user dave
fga tuple write tenant_entitlement:acme/dave/block tenant:acme#tenant
fga tuple write tenant_entitlement:acme/dave/block user:dave#blocked
fga tuple write usecase_capability:image_generation tenant_entitlement:acme/dave/block#blocked_by_tenant

# Check permission
fga query check user:dave can_execute usecase_capability:image_generation
# ✗ Denied - explicit block overrides tenant plan
```

### Quota Management

The schema supports two-level quota enforcement:
- **Tenant Pool**: Organization-wide quota limit
- **Individual Limits**: Per-user quotas set by admin

Both conditions must be satisfied for access.

```bash
# Set individual quota for user eve
fga tuple write quota_grant:acme/eve/opus user:eve#user
fga tuple write quota_grant:acme/eve/opus tenant:acme#tenant
fga tuple write quota_grant:acme/eve/opus model_capability:claude-opus#model

# Check with quota context
fga query check \
  user:eve \
  can_execute \
  model_capability:claude-opus \
  --context '{"user_current_usage":8,"user_quota_limit":10,"tenant_current_usage":75,"tenant_quota_limit":100}'
# ✓ Allowed (8 < 10 AND 75 < 100)
```

### Plan Inheritance

Higher-tier plans can include all features from lower tiers:

```bash
# Enterprise includes Pro features
fga tuple write plan:enterprise plan:pro#includes
fga tuple write plan:pro entitlement:usecase_rag#entitles
fga tuple write plan:pro entitlement:model_sonnet#entitles
fga tuple write plan:enterprise entitlement:model_opus#entitles

# User with enterprise plan gets:
# - model_opus (direct)
# - usecase_rag (via pro inheritance)
# - model_sonnet (via pro inheritance)
```

### Entitlement Types

The schema supports multi-level entitlements:

1. **Usecase Level**: Access to entire use cases (chat, rag, translation)
2. **Model Level**: Access to specific AI models (claude-3-sonnet, gpt-4)
3. **Resource Level**: Operations on resources (view, edit, delete documents/conversations)

Example entitlements:
- `entitlement:usecase_chat` - Chat use case access
- `entitlement:model_claude_sonnet` - Claude Sonnet model access
- `entitlement:document_upload` - Document upload capability
- `entitlement:api_access` - API access feature

### Admin Operations

Tenant admins can manage entitlements through dedicated APIs:

```typescript
// Grant entitlement to user
POST /admin/entitlements/grant
{
  "tenantId": "acme",
  "userId": "charlie",
  "entitlementId": "usecase_chat"
}

// Revoke entitlement
POST /admin/entitlements/revoke
{
  "tenantId": "acme",
  "userId": "charlie",
  "entitlementId": "usecase_chat"
}

// Explicit deny (block)
POST /admin/entitlements/block
{
  "tenantId": "acme",
  "userId": "dave",
  "capabilityId": "image_generation"
}

// Set individual quota
POST /admin/quotas/set-user-limit
{
  "tenantId": "acme",
  "userId": "eve",
  "modelId": "claude-opus",
  "dailyLimit": 10
}
```

### Schema File

The complete authorization schema is defined in `authorization-schema.fga`. See the file for:
- Detailed type definitions
- Permission resolution logic
- Comprehensive usage examples
- Migration notes from previous schema

## Monitoring

### CloudWatch Metrics

The service automatically publishes metrics to CloudWatch:

- `Authorization/OpenFGA/AuthorizationLatency` - Check latency
- `Authorization/OpenFGA/AuthorizationDecision` - Allow/Deny counts
- `Authorization/OpenFGA/QuotaExceeded` - Quota violations
- `Authorization/OpenFGA/OpenFGACheckLatency` - OpenFGA API latency

### CloudWatch Logs

Logs are sent to `/ecs/openfga-{environment}`:

```bash
# Tail logs
aws logs tail /ecs/openfga-production --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /ecs/openfga-production \
  --filter-pattern "ERROR"
```

### ECS Exec for Debugging

```bash
# Connect to running task
aws ecs execute-command \
  --cluster openfga-production \
  --task <task-id> \
  --container openfga \
  --command "/bin/sh" \
  --interactive
```

## Security Best Practices

### 1. Network Security

- Deploy Fargate tasks in **private subnets**
- Use **internal ALB** (not internet-facing)
- Restrict security groups to known sources
- Enable VPC Flow Logs

### 2. Authentication

- Use **pre-shared keys** from Secrets Manager
- Rotate keys periodically
- Never embed keys in code

### 3. Database Security

- Enable **encryption at rest** (KMS)
- Use **SSL/TLS** for connections
- Store credentials in Secrets Manager
- Enable **deletion protection** in production

### 4. Application Security

- **Disable playground** in production
- Enable **CloudWatch logging**
- Set up **CloudWatch Alarms**
- Use **least privilege** IAM roles

## Performance Tuning

### 1. Fargate Task Sizing

For typical workloads:
- **POC**: 256 CPU (0.25 vCPU), 512 MB memory
- **Production**: 512 CPU (0.5 vCPU), 1024 MB memory

### 2. Auto-Scaling

Default configuration:
- **CPU utilization**: Scale at 70%
- **Memory utilization**: Scale at 80%
- **Min capacity**: 2 tasks
- **Max capacity**: 10 tasks

### 3. Database Optimization

RDS parameters optimized for OpenFGA:
```
max_connections: 100
shared_buffers: 256MB
effective_cache_size: 768MB
work_mem: 4MB
```

### 4. Caching

OpenFGA check query cache:
- **Enabled**: true
- **TTL**: 5 minutes

## Troubleshooting

### High Latency

**Symptoms**: P95 > 100ms

**Solutions:**
1. Enable check query caching
2. Scale up Fargate tasks
3. Upgrade RDS instance type
4. Use RDS Proxy for connection pooling

### Database Connection Errors

**Symptoms**: "connection refused"

**Solutions:**
1. Check security group rules
2. Verify RDS endpoint in environment variables
3. Ensure tasks are in correct subnets
4. Check VPC routing tables

### Out of Memory (OOM)

**Symptoms**: Tasks restarting frequently

**Solutions:**
1. Increase `memoryLimitMiB` in task definition
2. Review OpenFGA memory usage in CloudWatch
3. Reduce `max_connections` in RDS

## Testing

See `scripts/` directory:

- `test-openfga.sh` - Functional authorization tests (18 test cases)
- `perf-test-openfga.js` - k6 performance tests

```bash
# Run functional tests
export OPENFGA_API_URL="http://your-alb:8080"
export OPENFGA_STORE_ID="your-store-id"
./scripts/test-openfga.sh

# Run performance tests
k6 run --vus 10 --duration 30s scripts/perf-test-openfga.js
```

## Migration from SpiceDB

See [OPENFGA_MIGRATION_PLAN.md](../../../../docs/ja/OPENFGA_MIGRATION_PLAN.md) for complete migration guide.

**Key differences:**
- Schema syntax (`.zed` → `.fga`)
- Caveats → Conditions
- Per-tenant namespaces → Per-tenant stores
- Relation chaining syntax

## Resources

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA Production Guide](https://openfga.dev/docs/best-practices/running-in-production)
- [ECS Fargate Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [OpenFGA GitHub](https://github.com/openfga/openfga)

## License

This construct is part of the larger GenAI application and follows the same license.
