# Tenant IAM Role with AssumeRoleWithWebIdentity

Simple IAM role creation for multi-tenant access using JWT tokens.

## Quick Start

```bash
# For Cognito User Pool
./scripts/create-tenant-iam-role.sh \
  -p arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXXX \
  -a your-client-id

# For custom OIDC provider
./scripts/create-tenant-iam-role.sh \
  -p arn:aws:iam::123456789012:oidc-provider/example.com \
  -a my-app-id
```

## CDK Usage

### Basic Role Creation

```typescript
import { TenantIamRole } from './construct/tenant-iam-role';

const role = new TenantIamRole(this, 'MyTenantRole', {
  identityProviderArn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-id',
  audience: 'client-id',
  tenantIdClaim: 'custom:tenant_id', // optional, this is the default
  roleName: 'MyTenantAccessRole', // optional
  maxSessionDuration: cdk.Duration.hours(2), // optional, default is 1 hour
});
```

### Adding Policies

```typescript
// Add custom policy statement
role.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['s3:ListBucket'],
  resources: ['arn:aws:s3:::my-bucket'],
}));

// Add managed policy
role.attachManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess')
);

// Use helper methods for common patterns
const dynamoStatement = role.createDynamoDbPolicyStatement(
  'arn:aws:dynamodb:us-east-1:123456789012:table/MyTable'
);
role.addToPolicy(dynamoStatement);

const s3Statements = role.createS3PolicyStatement(
  'arn:aws:s3:::my-bucket'
);
s3Statements.forEach(stmt => role.addToPolicy(stmt));
```

## Trust Policy

The role automatically creates a trust policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:cognito-idp:region:account:userpool/pool-id"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "cognito-idp.region.amazonaws.com/pool-id:aud": "client-id"
      }
    }
  }]
}
```

## Client Usage

```javascript
// Get JWT token from your identity provider
const idToken = await getIdToken();

// Exchange for AWS credentials
const sts = new AWS.STS();
const credentials = await sts.assumeRoleWithWebIdentity({
  RoleArn: 'arn:aws:iam::123456789012:role/TenantRole',
  RoleSessionName: `tenant-${tenantId}`,
  WebIdentityToken: idToken,
  DurationSeconds: 3600,
}).promise();

// Use credentials
const s3 = new AWS.S3({
  credentials: {
    accessKeyId: credentials.Credentials.AccessKeyId,
    secretAccessKey: credentials.Credentials.SecretAccessKey,
    sessionToken: credentials.Credentials.SessionToken,
  },
});
```

## Script Options

```bash
./scripts/create-tenant-iam-role.sh [OPTIONS]

Options:
  -p, --provider-arn ARN       Identity provider ARN (required)
  -a, --audience ID            Audience/Client ID (required)
  -c, --claim NAME             Tenant ID claim name (default: custom:tenant_id)
  -n, --role-name NAME         IAM role name (optional)
  -s, --stack-name NAME        CloudFormation stack name (default: TenantIamRoleStack)
  -r, --region REGION          AWS region (default: current region)
  -h, --help                   Show help message
```

## Outputs

After deployment, the stack outputs:
- **RoleArn**: The ARN of the created IAM role
- **RoleName**: The name of the created IAM role

The script also creates `tenant-iam-role-config.json` with all configuration details.