# Authorization System

Self-hosted authorization system using OpenFGA for fine-grained access control and quota management.

## Overview

The Authorization System provides:
- **Self-hosted OpenFGA** (ECS Fargate + PostgreSQL RDS)
- **Lambda Authorizer** for API Gateway integration
- **Quota Management** with DynamoDB
- **CloudWatch Metrics** for monitoring

## Architecture

```
┌─────────────────┐
│  API Gateway    │
└────────┬────────┘
         │
         │ Authorization Header
         v
┌─────────────────────────┐
│ Lambda Authorizer       │
│ - Verify Cognito JWT    │
│ - Check OpenFGA perms   │
│ - Check quotas (DDB)    │
└───────┬─────────────────┘
        │
        v
┌──────────────────────────┐
│ OpenFGA (ECS Fargate)    │
│ - Relationship-based     │
│ - Fine-grained access    │
│ - Quota enforcement      │
└──────────────────────────┘
```

## Components

### 1. Authorization System Construct (`authorization-system.ts`)

Main CDK construct that creates:
- Self-hosted OpenFGA (ECS Fargate + RDS PostgreSQL)
- Lambda Authorizer for API Gateway
- DynamoDB tables for plans and usage

### 2. Plan & Quota Store (`plan-quota-store.ts`)

Creates three DynamoDB tables:
- **PlansTable**: Stores plan definitions (Free/Pro/Enterprise)
- **TenantPlansTable**: Maps tenants to subscribed plans
- **UsageTable**: Tracks daily usage with TTL cleanup

### 3. Lambda Authorizer (`../../lambda/authorizer/`)

API Gateway authorizer that:
- Verifies Cognito JWT tokens
- Checks permissions via OpenFGA
- Enforces usage quotas from DynamoDB
- Caches authorization decisions
- Records CloudWatch metrics

### 4. OpenFGA Client (`../../lambda/utils/openfgaClient.ts`)

Provides helper functions for:
- Permission checks (usecase, model, resource)
- Entitlement management
- Plan subscription management
- Quota enforcement

## Usage

### Basic Setup

```typescript
import { AuthorizationSystem } from './construct/authorization';

const authzSystem = new AuthorizationSystem(this, 'Authorization', {
  userPool,           // Cognito User Pool for JWT verification
  vpc,                // VPC for OpenFGA and Lambda
  environment: 'dev', // Environment name for resource naming
});

// Create API Gateway Request Authorizer
const authorizer = new RequestAuthorizer(this, 'Authorizer', {
  handler: authzSystem.authorizerFunction,
  identitySources: [IdentitySource.header('Authorization')],
  resultsCacheTtl: Duration.minutes(5),
});

// Use with API Gateway
api.root.addMethod('POST', integration, {
  authorizer,
  authorizationType: AuthorizationType.CUSTOM,
});
```

### Configuration Options

```typescript
const authzSystem = new AuthorizationSystem(this, 'Authorization', {
  // Required
  userPool: cognito.UserPool,
  vpc: ec2.IVpc,
  environment: string,

  // Optional
  userPoolClientId: string,        // For ID token verification
  enableCache: boolean,             // Default: true
  cacheTTLSeconds: number,          // Default: 300
  enablePlayground: boolean,        // Default: false (dev only)
  openFgaImageTag: string,          // Default: 'latest'
  multiAz: boolean,                 // Default: false
  deletionProtection: boolean,      // Default: false
});
```

### Accessing OpenFGA Resources

```typescript
// OpenFGA endpoint (internal ALB)
const endpoint = authzSystem.openFgaEndpoint;

// OpenFGA pre-shared key secret
const secret = authzSystem.openFgaSecret;

// OpenFGA service (for advanced configuration)
const service = authzSystem.openFgaService;

// PostgreSQL database
const database = authzSystem.openFgaDatabase;
```

## OpenFGA Setup

### 1. Create Store and Upload Schema

After deploying the infrastructure, create an OpenFGA store and upload the authorization model:

```bash
# Install OpenFGA CLI
brew install openfga/tap/fga

# Configure OpenFGA endpoint (from CDK output)
export OPENFGA_API_URL="http://your-openfga-endpoint"

# Create store
fga store create --name "authorization"

# Upload authorization model
fga model write --file docs/specs/authorization/authorization-schema.fga
```

### 2. Update Lambda Environment

Update the `OPENFGA_STORE_ID` environment variable with the created store ID:

```typescript
// In authorization-system.ts, update line 190:
OPENFGA_STORE_ID: 'your-store-id-here',
```

Or use CDK context/parameter for dynamic configuration.

## Authorization Schema

See `docs/specs/authorization/authorization-schema.fga` for the complete OpenFGA authorization model.

Key capabilities:
- **Usecase Permissions**: chat, rag, agent, etc.
- **Model Permissions**: claude-3-sonnet, gpt-4, etc. (with quota support)
- **Resource Permissions**: conversations, documents (view, edit, delete)
- **Plan Subscriptions**: Free, Pro, Enterprise
- **Tenant Management**: Admin roles, entitlement grants

## Permission Checks

The Lambda authorizer automatically maps API paths to permission checks:

| Path | Permission Check |
|------|------------------|
| `/chat` | `usecase:chat` |
| `/rag` | `usecase:rag` |
| `/models/{id}` | `model:{id}` (with quota) |
| `/conversations/{id}` | `resource:conversation:{id}` |
| `/documents/{id}` | `resource:document:{id}` |

## DynamoDB Tables

### Plans Table
Stores plan definitions (quotas, features):
```json
{
  "planId": "pro",
  "name": "Pro Plan",
  "quotas": {
    "claude-3-sonnet": 1000000,
    "gpt-4": 500000
  }
}
```

### Tenant Plans Table
Maps tenants to plans:
```json
{
  "tenantId": "tenant-123",
  "planId": "pro",
  "quotas": { ... }
}
```

### Usage Table
Tracks daily usage:
```json
{
  "userId": "user-456",
  "date": "2025-10-21",
  "usage": {
    "claude-3-sonnet": 15000,
    "gpt-4": 5000
  }
}
```

## Monitoring

### CloudWatch Metrics

Namespace: `Authorization`

Metrics:
- `AuthorizationAllow`: Successful authorizations
- `AuthorizationDeny`: Denied authorizations
- `AuthorizationError`: Authorization errors
- `CacheHit`: Cache hits
- `CacheMiss`: Cache misses

### Logs

- Lambda Authorizer: `/aws/lambda/AuthorizerFunction`
- OpenFGA Service: `/ecs/openfga-{environment}`
- OpenFGA Database: `/aws/rds/instance/openfga-{environment}`

## Security Considerations

1. **VPC Isolation**: OpenFGA runs in private subnets with ALB
2. **Secrets Management**: Pre-shared keys stored in Secrets Manager
3. **Database Encryption**: RDS encryption at rest enabled
4. **TLS**: All connections use TLS
5. **IAM Permissions**: Least privilege for Lambda functions

## Troubleshooting

### Authorization Always Denied

1. Check OpenFGA store ID is correct
2. Verify authorization model is uploaded
3. Check user has proper relationships in OpenFGA
4. Review CloudWatch logs for detailed errors

### Quota Not Enforced

1. Verify plan is assigned to tenant in DynamoDB
2. Check quota values in tenant plan table
3. Review usage table for current usage

### Lambda Timeout

1. Check VPC NAT Gateway connectivity
2. Verify security groups allow OpenFGA access
3. Increase Lambda timeout if needed
4. Enable caching to reduce OpenFGA calls

## Files

```
authorization/
├── README.md                    # This file
├── index.ts                     # Exports
├── authorization-system.ts      # Main construct
├── plan-quota-store.ts          # DynamoDB tables
└── ../../lambda/
    ├── authorizer/
    │   └── authorization-authorizer.ts    # Lambda Authorizer
    └── utils/
        └── openfgaClient.ts               # OpenFGA helper functions
```

## References

- [OpenFGA Documentation](https://openfga.dev)
- [Authorization Schema](../../../docs/specs/authorization/authorization-schema.fga)
- [OpenFGA Migration Guide](../../../docs/specs/authorization/openfga-migration-guide.md)
- [Implementation Summary](../../../docs/specs/authorization/implementation-summary.md)
- [OpenFGA Implementation](../../../docs/specs/authorization/openfga-implementation.md)
