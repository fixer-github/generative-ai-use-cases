#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const params = {};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-p':
    case '--provider-arn':
      params.providerArn = args[++i];
      break;
    case '-a':
    case '--audience':
      params.audience = args[++i];
      break;
    case '-c':
    case '--claim':
      params.claim = args[++i];
      break;
    case '-n':
    case '--role-name':
      params.roleName = args[++i];
      break;
    case '-s':
    case '--stack-name':
      params.stackName = args[++i];
      break;
    case '-r':
    case '--region':
      params.region = args[++i];
      break;
    case '-h':
    case '--help':
      showHelp();
      process.exit(0);
    default:
      if (!args[i].startsWith('-')) {
        // Allow positional arguments for provider ARN and audience
        if (!params.providerArn) {
          params.providerArn = args[i];
        } else if (!params.audience) {
          params.audience = args[i];
        }
      }
  }
}

function showHelp() {
  console.log(`
Usage: npm run cdk:deploy:tenant -- [OPTIONS]

Options:
  -p, --provider-arn ARN    Identity provider ARN (required)
  -a, --audience ID         Audience/Client ID (required)
  -c, --claim NAME          Tenant ID claim name (default: custom:tenant_id)
  -n, --role-name NAME      IAM role name (optional)
  -s, --stack-name NAME     CloudFormation stack name (default: TenantIamRoleStack)
  -r, --region REGION       AWS region (default: current region)
  -h, --help                Show this help message

Examples:
  # Basic usage
  npm run cdk:deploy:tenant -- -p arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-id -a client-id

  # With custom role name
  npm run cdk:deploy:tenant -- -p arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-id -a client-id -n MyTenantRole

  # With all options
  npm run cdk:deploy:tenant -- -p arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-id -a client-id -n MyTenantRole -c custom:tenant_id -r ap-northeast-1
`);
}

// Validate required parameters
if (!params.providerArn || !params.audience) {
  console.error('Error: Identity provider ARN and audience are required');
  showHelp();
  process.exit(1);
}

// Build CDK command
const stackName = params.stackName || 'TenantIamRoleStack';
let cdkCommand = `npm run cdk -- deploy ${stackName}`;

// Add parameters
cdkCommand += ` --parameters IdentityProviderArn="${params.providerArn}"`;
cdkCommand += ` --parameters Audience="${params.audience}"`;

// Add context values
if (params.roleName) {
  cdkCommand += ` --context roleName="${params.roleName}"`;
}
if (params.claim) {
  cdkCommand += ` --context tenantIdClaim="${params.claim}"`;
}
if (params.region) {
  cdkCommand += ` --region ${params.region}`;
}

cdkCommand += ' --require-approval never';

// Show configuration
console.log('Deploying with configuration:');
console.log(`  Stack Name: ${stackName}`);
console.log(`  Identity Provider ARN: ${params.providerArn}`);
console.log(`  Audience: ${params.audience}`);
if (params.roleName) console.log(`  Role Name: ${params.roleName}`);
if (params.claim) console.log(`  Tenant ID Claim: ${params.claim}`);
if (params.region) console.log(`  Region: ${params.region}`);
console.log('');

try {
  // Deploy with CDK
  console.log('Deploying stack...');
  execSync(cdkCommand, { stdio: 'inherit' });

  console.log('\nDeployment successful!');
} catch (error) {
  console.error('\nDeployment failed!');
  process.exit(1);
}