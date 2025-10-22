# Tenant Authorization System Integration

## Overview

This document describes the integrated authorization system deployment where each tenant gets a dedicated OpenFGA authorization system deployed within their own VPC, eliminating the need for cross-VPC communication and reducing operational complexity.

## Architecture

### Integrated Stack Approach

Each tenant stack now includes:
- **Tenant VPC** (single VPC for all tenant resources)
- **Authorization System** (OpenFGA + PostgreSQL RDS + Lambda Authorizer)
- **OpenSearch** (document storage)
- **DynamoDB** (tenant data)
- **S3** (tenant files)
- **Lambda Functions** (business logic)

### Key Benefits

1. **Cost Savings**: ~30% reduction per tenant by eliminating duplicate VPC and NAT Gateway
   - Separate stacks: $124/month per tenant (2 VPCs, 2 NAT Gateways)
   - Integrated stack: $87/month per tenant (1 VPC, 1 NAT Gateway)

2. **Simplified Networking**: No VPC peering or cross-VPC routing required

3. **Lower Latency**: Same-VPC communication between tenant Lambdas and OpenFGA

4. **Better Resource Utilization**: Shared subnets and NAT gateways

5. **Single Deployment**: One command deploys entire tenant infrastructure

## Configuration

### Required Configuration

Add `authorizationConfig` to your `cdk.tenant.json`:

```json
{
  "context": {
    "tenantId": "tenant-001",
    "environment": "dev",
    "controlPlane": {
      "userPoolId": "us-east-1_XXXXXXXXX",
      "userPoolClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "authorizationConfig": {
      "enabled": true,
      "enableCache": true,
      "cacheTTLSeconds": 300,
      "enablePlayground": false,
      "openFgaImageTag": "v1.5.0",
      "multiAz": false,
      "deletionProtection": true
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable authorization stack deployment |
| `enableCache` | boolean | `true` | Enable Lambda Authorizer response caching |
| `cacheTTLSeconds` | number | `300` | Cache TTL in seconds (5 minutes) |
| `enablePlayground` | boolean | `false` | Enable OpenFGA playground (dev only) |
| `openFgaImageTag` | string | `"latest"` | OpenFGA container image tag |
| `multiAz` | boolean | `false` | Enable Multi-AZ RDS deployment (recommended for prod) |
| `deletionProtection` | boolean | `true` | Enable RDS deletion protection |

### Environment-Specific Configurations

**Development:**
```json
{
  "authorizationConfig": {
    "enabled": true,
    "enableCache": false,
    "enablePlayground": true,
    "multiAz": false,
    "deletionProtection": false
  }
}
```

**Production:**
```json
{
  "authorizationConfig": {
    "enabled": true,
    "enableCache": true,
    "cacheTTLSeconds": 300,
    "enablePlayground": false,
    "multiAz": true,
    "deletionProtection": true
  }
}
```

## Deployment

### Deploy Tenant with Authorization

```bash
cd packages/cdk

# Copy and configure tenant settings
cp cdk.tenant.example.json cdk.tenant.json
# Edit cdk.tenant.json with your values

# Deploy all tenant stacks (includes authorization)
npm run cdk:tenant:deploy
```

### Deploy Without Authorization

To disable authorization stack deployment:

```json
{
  "authorizationConfig": {
    "enabled": false
  }
}
```

## Stack Outputs

After deployment, the following outputs are available:

### TenantAuthorizationStack Outputs

| Output Name | Description | Usage |
|-------------|-------------|-------|
| `OpenFgaEndpoint` | HTTP endpoint (port 8080) | API calls from Lambda functions |
| `OpenFgaGrpcEndpoint` | gRPC endpoint (port 8081) | High-performance clients |
| `OpenFgaSecretArn` | Pre-shared keys secret ARN | Authentication |
| `DatabaseEndpoint` | PostgreSQL endpoint | Direct DB access (if needed) |
| `DatabaseSecretArn` | DB credentials secret ARN | Database access |
| `AuthorizerFunctionArn` | Lambda Authorizer ARN | API Gateway integration |
| `AuthorizerFunctionName` | Lambda Authorizer name | CloudWatch Logs |

### Accessing Outputs

```bash
# List all outputs
aws cloudformation describe-stacks \
  --stack-name TenantAuthorizationStackdev-tenant-001 \
  --query 'Stacks[0].Outputs'

# Get specific output
aws cloudformation describe-stacks \
  --stack-name TenantAuthorizationStackdev-tenant-001 \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenFgaEndpoint`].OutputValue' \
  --output text
```

## Usage in Lambda Functions

### Using OpenFGA Client

```typescript
import { OpenFgaClient } from '@openfga/sdk';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Get OpenFGA endpoint from environment variable
const OPENFGA_ENDPOINT = process.env.OPENFGA_ENDPOINT!;
const SECRET_ARN = process.env.OPENFGA_SECRET_ARN!;

// Initialize client
const secretsClient = new SecretsManagerClient({});
const secretResponse = await secretsClient.send(
  new GetSecretValueCommand({ SecretId: SECRET_ARN })
);
const credentials = JSON.parse(secretResponse.SecretString!);

const fgaClient = new OpenFgaClient({
  apiUrl: OPENFGA_ENDPOINT,
  storeId: credentials.storeId,
  credentials: {
    method: 'api_token',
    config: {
      token: credentials.apiToken,
    },
  },
});

// Check permission
const { allowed } = await fgaClient.check({
  user: `user:${userId}`,
  relation: 'viewer',
  object: `document:${documentId}`,
});
```

## Migration from Separate Stacks

If you previously deployed authorization as a separate stack:

### Step 1: Export Data (if needed)

```bash
# Backup OpenFGA authorization model
pg_dump -h <old-db-endpoint> -U postgres openfga > backup.sql
```

### Step 2: Destroy Old Authorization Stack

```bash
npm run cdk:authz:destroy --context tenantId=tenant-001
```

### Step 3: Deploy Integrated Stack

```bash
# Update cdk.tenant.json with authorizationConfig
npm run cdk:tenant:deploy
```

### Step 4: Restore Data (if needed)

```bash
# Restore to new database
psql -h <new-db-endpoint> -U postgres openfga < backup.sql
```

## Monitoring

### CloudWatch Metrics

Key metrics to monitor:

- **ECS Service**:
  - `CPUUtilization`: Target < 70%
  - `MemoryUtilization`: Target < 80%
  - `TaskCount`: Should match desired count

- **RDS Database**:
  - `DatabaseConnections`: Monitor connection pool
  - `CPUUtilization`: Target < 70%
  - `FreeStorageSpace`: Alert if < 20%

- **Lambda Authorizer**:
  - `Duration`: Monitor authorization latency
  - `Errors`: Should be near zero
  - `ConcurrentExecutions`: Monitor under load

### CloudWatch Logs

Log groups created:
- `/aws/ecs/tenant-{tenantId}-openfga-service`
- `/aws/lambda/tenant-{tenantId}-authorizer`
- `/aws/rds/instance/tenant-{tenantId}-openfga-db`

## Troubleshooting

### Authorization Requests Failing

1. **Check Lambda Authorizer logs**:
   ```bash
   aws logs tail /aws/lambda/TenantAuthorizationStack-AuthorizerFunction --follow
   ```

2. **Verify OpenFGA service is running**:
   ```bash
   aws ecs describe-services \
     --cluster tenant-{tenantId}-cluster \
     --services openfga-service
   ```

3. **Test OpenFGA endpoint**:
   ```bash
   curl -X GET http://<openfga-endpoint>:8080/healthz
   ```

### Database Connection Issues

1. **Check RDS instance status**:
   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier tenant-{tenantId}-openfga-db
   ```

2. **Verify security groups**:
   - OpenFGA ECS tasks should have access to RDS
   - Check VPC security group rules

### High Latency

1. **Enable caching** in production:
   ```json
   {
     "authorizationConfig": {
       "enableCache": true,
       "cacheTTLSeconds": 300
     }
   }
   ```

2. **Scale OpenFGA service**:
   - Increase ECS task count
   - Use larger instance types

3. **Upgrade RDS instance**:
   - Consider Multi-AZ for high availability
   - Use larger instance class

## Cost Optimization

### Development Environment

```json
{
  "authorizationConfig": {
    "multiAz": false,
    "deletionProtection": false
  },
  "networkConfig": {
    "natGateways": 1
  }
}
```

**Estimated cost**: ~$70-90/month per tenant

### Production Environment

```json
{
  "authorizationConfig": {
    "multiAz": true,
    "deletionProtection": true
  },
  "networkConfig": {
    "natGateways": 2
  }
}
```

**Estimated cost**: ~$120-150/month per tenant

## Security Considerations

1. **VPC Security Groups**: Authorization system uses private subnets
2. **Secrets Management**: Pre-shared keys stored in AWS Secrets Manager
3. **Deletion Protection**: Enabled by default for RDS
4. **Encryption**: RDS encryption at rest enabled
5. **Network Isolation**: Authorization system isolated per tenant

## References

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA Complete Guide](./specs/authorization/OPENFGA_COMPLETE_GUIDE.md)
- [Tenant Stack Deployment](./tenant-stack-deployment.md)
- [Authorization System Architecture](./specs/authorization/authorization-mvp.md)

## Support

For issues or questions:
1. Check CloudWatch Logs for error details
2. Review this documentation
3. Consult the OpenFGA documentation
4. Contact the platform team
