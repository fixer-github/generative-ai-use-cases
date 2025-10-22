# Authorization System Architecture Exploration Report

## Executive Summary

The codebase uses **OpenFGA** (not SpiceDB) as the authorization engine. The system is architected for deployment flexibility with the authorization system deployable as either:
- **Standalone stack** in a separate AWS account/region
- **Embedded in same account** as the main application and tenant stacks
- **Multiple authorization instances** for different environments (dev, staging, prod)

---

## 1. Authorization System Technology

### Current Implementation: OpenFGA (Production Ready)

**Technology Stack:**
- **Authorization Engine:** OpenFGA v1.5.0+ (Zanzibar-based)
- **Deployment Platform:** ECS Fargate (serverless containers)
- **Database:** PostgreSQL 15.4 via RDS
- **API Access:** HTTP (port 8080) + gRPC (port 8081) via Application Load Balancer
- **Authentication:** Pre-shared keys stored in AWS Secrets Manager

**Historical Context:**
- SpiceDB was originally proposed (documented in `/docs/specs/authorization/authorization-mvp.md`)
- **Completed migration to OpenFGA** achieving:
  - **70-75% cost reduction** (ECS Fargate + RDS vs EKS + RDS)
  - **Simplified operations** (no Kubernetes management)
  - **Enhanced features** (hybrid ToC/ToB support, entitlement-based permissions)

---

## 2. How Authorization System is Deployed

### Architecture Options

#### Option A: Standalone Authorization Stack (Separate AWS Account)

**File:** `packages/cdk/lib/stacks/standalone/authorization-stack.ts`

**What Gets Deployed:**
- **New VPC** (or use existing)
- **RDS PostgreSQL** database (OpenFGA store)
- **ECS Fargate cluster** with OpenFGA service
- **Application Load Balancer** (HTTP:8080, gRPC:8081)
- **Lambda Authorizer** function
- **Cognito User Pool** (optional - can use existing)
- **CloudWatch Logs & Metrics**

**Key Configuration:**
```typescript
export interface AuthorizationStackProps {
  environment: string;           // dev, staging, prod
  deploymentId?: string;         // For multiple instances in same account
  vpcConfig: {
    createNew: boolean;          // Create new VPC or use existing
    vpcId?: string;             // If not creating new
    vpcCidr?: string;           // Default: 10.1.0.0/16
    maxAzs?: number;            // Default: 2
    natGateways?: number;       // Default: 1
  };
  databaseConfig?: {
    multiAz?: boolean;          // Default: false
    deletionProtection?: boolean; // Default: false
  };
}
```

**Deployment Command:**
```bash
npx cdk deploy -c environment=prod \
  --config cdk.authorization.json
```

**CDK Entry Point:** `packages/cdk/bin/authorization-system.ts`

#### Option B: Embedded in Common Stack (Same Account)

**Integration Point:** `packages/cdk/lib/construct/authorization/authorization-system.ts`

The `AuthorizationSystem` construct can be instantiated within:
- Common stacks (`packages/cdk/lib/stacks/common/*`)
- Any existing CDK stack

**Usage Example:**
```typescript
import { AuthorizationSystem } from '../construct/authorization/authorization-system';

const authSystem = new AuthorizationSystem(this, 'Auth', {
  userPool: cognito.userPool,
  vpc: props.vpc,
  environment: 'production',
  enableCache: true,
  cacheTTLSeconds: 300,
  multiAz: true,
  deletionProtection: true,
});
```

---

## 3. Relationship to Tenant Stacks

### Tenant Stack Architecture

**File:** `packages/cdk/lib/create-tenant-stacks.ts`

**Tenant-Specific Stacks Deployed:**
1. **TenantIAMStack** - IAM roles for tenant resource access
2. **TenantDynamoDBStack** - Isolated DynamoDB tables (ChatHistory, TokenUsageStats, UseCaseBuilder)
3. **TenantS3Stack** - Isolated S3 buckets (Documents, Chat, Analytics)
4. **TenantVpcStack** - Tenant-specific VPC (for network isolation)
5. **TenantBedrockChatStack** - Tenant-specific chat application
6. **TenantPptxStack** - PPTX generation service
7. **TenantOpenSearchStack** - OpenSearch cluster for document indexing

**Key Point:** Tenant stacks create **isolated infrastructure per tenant** (DynamoDB, S3, VPC)

### Authorization System ↔ Tenant Stacks Relationship

```
┌─────────────────────────────────────────────────────────────────┐
│                     AWS Account (prod-account)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         AUTHORIZATION STACK (Separate/Common)            │  │
│  │                                                          │  │
│  │  ┌──────────────┐     ┌──────────────┐                 │  │
│  │  │ OpenFGA      │────▶│ PostgreSQL   │                 │  │
│  │  │ (ECS Fargate)│     │ (RDS)        │                 │  │
│  │  └──────┬───────┘     └──────────────┘                 │  │
│  │         │                                               │  │
│  │  ┌──────▼────────────────┐                             │  │
│  │  │ ALB (8080, 8081)      │                             │  │
│  │  │ Pre-shared keys (SM)  │                             │  │
│  │  └──────┬────────────────┘                             │  │
│  │         │                                               │  │
│  │  ┌──────▼────────────────┐                             │  │
│  │  │ Lambda Authorizer     │                             │  │
│  │  │ (Checks permissions)  │                             │  │
│  │  └──────┬────────────────┘                             │  │
│  │         │                                               │  │
│  └─────────┼───────────────────────────────────────────────┘  │
│            │                                                   │
│            │ Authorizes API requests                          │
│            │                                                   │
│  ┌─────────▼──────────────────────────────────────────────┐   │
│  │         COMMON APPLICATION STACK                       │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ API Gateway + Lambda functions                  │  │   │
│  │  │ (Chat, RAG, Image, Video, etc.)                 │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  └────────────┬─────────────────────────────────────────┘   │
│               │                                               │
│               │ Routes to tenant-specific resources          │
│               │                                               │
│  ┌────────────▼──────────────────────────────────────────┐   │
│  │    TENANT STACKS (1 per tenant)                       │   │
│  │                                                       │   │
│  │  Tenant A:                  Tenant B:                │   │
│  │  ├─ DynamoDB                ├─ DynamoDB             │   │
│  │  ├─ S3 Buckets (3)          ├─ S3 Buckets (3)       │   │
│  │  ├─ VPC (isolated)          ├─ VPC (isolated)       │   │
│  │  ├─ IAM Roles               ├─ IAM Roles            │   │
│  │  └─ OpenSearch              └─ OpenSearch           │   │
│  │                                                       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Authorization Flow:**
1. User authenticates via Cognito
2. Request hits API Gateway with JWT
3. Lambda Authorizer verifies JWT + checks OpenFGA permissions
4. OpenFGA knows which tenant user belongs to (via Cognito claims)
5. OpenFGA returns Allow/Deny based on:
   - User's entitlements
   - Tenant's entitlements
   - Quotas (DynamoDB storage)
6. API Gateway routes to tenant-specific Lambda
7. Lambda accesses tenant-isolated resources (DynamoDB, S3, etc.)

---

## 4. What Happens If Authorization System is Deployed in Same Account

### Scenario: Embedded Authorization Stack

When Authorization System is deployed in the **same AWS account** as the common/tenant stacks:

#### Benefits

1. **Simplified Network Architecture**
   - No cross-account access needed
   - VPC peering/endpoints not required
   - Direct Lambda-to-OpenFGA connectivity
   - Lower latency (same account, often same region)

2. **Simplified IAM**
   - No cross-account role assumptions
   - Single account permissions model
   - Shared VPC credentials possible

3. **Cost Efficiency**
   - No NAT Gateway costs for cross-account access
   - Potentially reuse VPC infrastructure
   - Consolidated billing

4. **Operational Simplicity**
   - Single CloudFormation stack structure
   - Unified deployment process
   - Shared security context

#### Risks & Considerations

1. **Blast Radius**
   - If authorization system fails → entire application fails
   - All tenants affected simultaneously
   - No fault isolation between authorization and application

2. **Security Boundaries**
   - Weaker isolation between authorization and application
   - Shared infrastructure increases surface area
   - Multi-tenant data in same security boundary

3. **Scaling Independence**
   - Cannot scale authorization independently
   - Application load directly impacts authorizer performance
   - Quota management harder to separate

4. **Data Isolation**
   - PostgreSQL database shared between all tenants + authorization
   - Potential for cross-tenant queries
   - Requires careful schema design

5. **Compliance Issues**
   - Some regulations require authorization systems be separate
   - Data residency requirements harder to enforce
   - Audit trail might be harder to isolate

#### Technical Implementation in Same Account

**Current CDK Structure:**
```
packages/cdk/lib/construct/
├── authorization/
│   ├── authorization-system.ts    # ← Can be embedded
│   └── plan-quota-schema.ts
├── openfga/
│   ├── openfga-database.ts
│   ├── openfga-service.ts
│   └── openfga-rds-proxy.ts
└── ... (other constructs)
```

**Integration Pattern:**
```typescript
// In GenerativeAiUseCasesStack or other common stack
import { AuthorizationSystem } from '../../construct/authorization/authorization-system';

export class GenerativeAiUseCasesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GenerativeAiUseCasesStackProps) {
    super(scope, id, props);

    // Deploy authorization in same stack/account
    const authSystem = new AuthorizationSystem(this, 'Authorization', {
      userPool: props.userPool,
      vpc: props.vpc,
      environment: props.environment,
      multiAz: true,
      deletionProtection: true,
    });

    // Use authorizer in API Gateway
    const api = new RestApi(this, 'Api', {
      defaultMethodOptions: {
        authorizer: new RequestAuthorizer(this, 'Authorizer', {
          handler: authSystem.authorizerFunction,
        }),
      },
    });
  }
}
```

### Current Deployment Strategy

**Based on CDK bin files, the system supports:**

1. **Separate Deployment (Recommended Production)**
   ```bash
   # Authorization system in isolated account
   npx cdk deploy -c environment=prod --config cdk.authorization.json
   
   # Application + tenants in separate account
   npm run cdk:deploy
   ```

2. **Same Account Deployment (Development/POC)**
   ```bash
   # Can be integrated by modifying create-stacks.ts to instantiate
   # AuthorizationSystem construct within GenerativeAiUseCasesStack
   npm run cdk:deploy
   ```

---

## 5. CDK Infrastructure Code Structure

### Directory Layout

```
packages/cdk/
├── bin/
│   ├── authorization-system.ts    # Standalone authz deployment
│   ├── generative-ai-use-cases.ts # Main application
│   └── ...
├── lib/
│   ├── construct/
│   │   ├── authorization/
│   │   │   ├── authorization-system.ts    # Reusable construct
│   │   │   └── plan-quota-schema.ts
│   │   ├── openfga/
│   │   │   ├── index.ts
│   │   │   ├── openfga-database.ts       # RDS PostgreSQL
│   │   │   ├── openfga-service.ts        # ECS Fargate
│   │   │   ├── openfga-rds-proxy.ts      # Connection pooling
│   │   │   └── authorization-schema.fga # OpenFGA model
│   │   └── ... (other constructs)
│   ├── stacks/
│   │   ├── common/
│   │   │   ├── generative-ai-use-cases-stack.ts
│   │   │   ├── web-stack.ts
│   │   │   ├── rag-knowledge-base-stack.ts
│   │   │   └── ...
│   │   ├── tenant/
│   │   │   ├── tenant-dynamodb-stack.ts
│   │   │   ├── tenant-s3-stack.ts
│   │   │   ├── tenant-iam-stack.ts
│   │   │   ├── tenant-vpc-stack.ts
│   │   │   └── ...
│   │   └── standalone/
│   │       └── authorization-stack.ts    # Standalone deployment
│   ├── create-stacks.ts        # Creates common stacks
│   ├── create-tenant-stacks.ts # Creates tenant stacks
│   └── ...
└── ...
```

### Key Constructs

#### 1. OpenFGADatabase
**File:** `packages/cdk/lib/construct/openfga/openfga-database.ts`

**Deploys:**
- RDS PostgreSQL 15.4 instance
- Secrets Manager for database credentials
- Security group with restricted inbound
- Automated backups (7 days default)
- Performance Insights enabled
- Multi-AZ support (optional)

**Security:**
- Encryption at rest (S3-managed)
- SSL/TLS required for connections
- Private subnet deployment
- Secrets in Secrets Manager

#### 2. OpenFGAService
**File:** `packages/cdk/lib/construct/openfga/openfga-service.ts`

**Deploys:**
- ECS Fargate cluster
- Fargate tasks (0.5 vCPU, 1 GB RAM default)
- Application Load Balancer
- CloudWatch Log Group
- Auto-scaling policies (CPU/memory)
- Health checks and monitoring

**Endpoints:**
- HTTP: `:8080` - REST API
- gRPC: `:8081` - gRPC API
- Metrics: `:2112` - Prometheus metrics

#### 3. AuthorizationSystem
**File:** `packages/cdk/lib/construct/authorization/authorization-system.ts`

**Composes:**
- OpenFGADatabase
- OpenFGAService
- Lambda Authorizer
- Plan/Quota PostgreSQL schema
- Security groups for cross-component access

**Configuration:**
```typescript
export interface AuthorizationSystemProps {
  userPool: IUserPool;
  userPoolClientId?: string;
  vpc: IVpc;
  environment: string;
  enableCache?: boolean;
  cacheTTLSeconds?: number;
  enablePlayground?: boolean;
  openFgaImageTag?: string;
  multiAz?: boolean;
  deletionProtection?: boolean;
}
```

#### 4. AuthorizationStack
**File:** `packages/cdk/lib/stacks/standalone/authorization-stack.ts`

**CDK Stack that:**
- Creates/imports VPC
- Creates/imports Cognito User Pool
- Instantiates AuthorizationSystem construct
- Exports outputs for cross-stack reference

---

## 6. Authorization Schema

### OpenFGA Model
**File:** `packages/cdk/lib/construct/openfga/authorization-schema.fga`

**Core Types:**
- `user` - Individual users
- `plan` - Subscription plans
- `tenant` - Organizations (ToB)
- `entitlement` - Capabilities granted by plans
- `usecase_capability` - Usecases (chat, image, etc.)
- `model_capability` - LLM models with quotas
- `conversation` - Chat conversations
- `document` - Knowledge base documents
- `quota_grant` - Two-level quota management
- `tenant_entitlement` - Admin-assigned entitlements

**Supports:**
- **ToC (To-Consumer)** - Individual user subscriptions
- **ToB (To-Business)** - Tenant organization + member entitlements
- **Hybrid** - Users with both direct and tenant-based access
- **Additive Union** - Access granted if ANY source allows
- **Explicit Deny** - Admin override to block access

### DynamoDB Tables for Quotas
**Files:** Multiple Lambda functions use DynamoDB for usage tracking

**Quota Tables:**
1. **UserQuotaLimits** - Per-user daily/monthly quotas
2. **TenantQuotaLimits** - Per-tenant daily/monthly quotas
3. **UsageTracking** - Current usage counters

---

## 7. Deployment Guides

### Standalone Deployment (Separate Account - Recommended)

**Reference:** `packages/cdk/bin/authorization-system.ts`

**Steps:**
1. Configure environment variables and CDK context
2. Run: `cdk deploy --config cdk.authorization.json`
3. Outputs exported to CloudFormation exports
4. Application stacks reference via imports

**Configuration File Example:**
```json
{
  "context": {
    "environment": "prod",
    "deploymentId": "default",
    "vpcConfig": {
      "createNew": true,
      "vpcCidr": "10.1.0.0/16"
    },
    "databaseConfig": {
      "multiAz": true,
      "deletionProtection": true
    },
    "openFgaConfig": {
      "imageTag": "v1.5.0",
      "desiredCount": 3,
      "minCapacity": 2,
      "maxCapacity": 10
    }
  }
}
```

### Tenant Stack Deployment

**Reference:** `packages/cdk/lib/create-tenant-stacks.ts`

**Command:**
```bash
npm run cdk:tenant:deploy -- \
  --context tenantId=acme-corp \
  --context environment=prod \
  --context enableAutoDelete=false
```

**Important:** Tenant stacks are **SEPARATE** from authorization system
- Each tenant gets isolated DynamoDB, S3, VPC, IAM roles
- Authorization system validates tenant membership separately
- Tenant stack destruction does NOT affect authorization system

---

## 8. Multi-Tenant Authorization Flow

```
1. User Login
   └─▶ Cognito UserPool
       └─▶ JWT Token with tenant_id claim

2. API Request
   └─▶ API Gateway + JWT
       └─▶ Lambda Authorizer

3. Authorization Check
   ├─▶ Verify JWT with Cognito
   ├─▶ Extract: userId, tenantId from claims
   ├─▶ Get Quota Usage from DynamoDB
   ├─▶ Query OpenFGA for permission
   │   ├─ Check user has entitlement
   │   ├─ Check tenant subscribed to plan
   │   ├─ Verify quota not exceeded
   │   └─ Check no explicit deny
   └─▶ Return IAM Allow/Deny policy

4. Route to Tenant Resource
   └─▶ Lambda accesses tenant-specific:
       ├─ DynamoDB tables (tenant-{id})
       ├─ S3 buckets (tenant-{id})
       └─ Other isolated resources
```

---

## 9. Key Findings

### Authorization System Deployment

| Aspect | Standalone | Embedded |
|--------|-----------|----------|
| Deployment | Separate stack in separate/same account | Integrated in application stack |
| VPC | Dedicated VPC or isolated | Shared with application |
| Database | Dedicated RDS instance | Shared or dedicated |
| Failure Impact | Isolated | Affects entire application |
| Scaling | Independent | Coupled with application |
| Network Latency | Cross-account (higher) | Same VPC (lower) |
| IAM Complexity | Cross-account roles | Simple same-account |
| Blast Radius | Limited | Comprehensive |
| Recommended | Production/Multi-tenant | Development/POC |

### Tenant Stacks Relationship

- **Completely Independent** from Authorization System
- Authorization System validates permissions globally
- Tenant Stacks contain isolated data/infrastructure
- Can be deployed/destroyed independently
- Does NOT require authorization system in same account

### No Hard Coupling

The codebase is designed for **loose coupling**:
- AuthorizationSystem is a construct that can be used anywhere
- Tenant stacks know nothing about authorization system
- Authorization checks happen in API Gateway layer
- Multi-account deployment fully supported

---

## 10. Recommendations

### For Production
- **Deploy Authorization System separately** in dedicated account
- Use **Multi-AZ** for RDS
- Enable **Deletion Protection**
- Use **Pre-shared keys** in Secrets Manager
- Enable **ECS Container Insights**
- Configure **CloudWatch alarms**
- Use **VPC endpoints** for cross-account access

### For Development
- Deploy Authorization System in **same development account**
- Single-AZ RDS acceptable
- Disable Deletion Protection
- Enable **OpenFGA Playground** for debugging
- Smaller ECS task resources

### Avoid in Production
- Deploying authorization in same account as production tenants (security)
- Disabling deletion protection on RDS
- Using default credentials
- Playground enabled
- Single-AZ without backup plan

---

## References

**Documentation Files:**
- `/docs/specs/authorization/OPENFGA_COMPLETE_GUIDE.md` - Full implementation guide
- `/docs/tenant-stack-deployment.md` - Tenant stack architecture
- `/docs/specs/authorization/authorization-mvp.md` - Historical (SpiceDB vs OpenFGA)

**Code Files:**
- `packages/cdk/lib/construct/authorization/` - Authorization system
- `packages/cdk/lib/construct/openfga/` - OpenFGA infrastructure
- `packages/cdk/bin/authorization-system.ts` - Standalone deployment
- `packages/cdk/lib/create-tenant-stacks.ts` - Tenant stack creation

