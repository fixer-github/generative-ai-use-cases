#!/usr/bin/env node

const { execSync } = require('child_process');
const { program } = require('commander');

program
  .name('deploy-tenant-role')
  .description('Deploy tenant-specific IAM role stack')
  .requiredOption('-t, --tenant-id <value>', 'Tenant ID')
  .requiredOption('-i, --identity-provider-arn <value>', 'Identity Provider ARN')
  .requiredOption('-a, --audience <value>', 'Audience/Client ID')
  .option('-c, --tenant-id-claim <value>', 'Tenant ID claim', 'custom:tenant_id')
  .option('-r, --region <value>', 'AWS region', process.env.CDK_DEFAULT_REGION || 'us-east-1')
  .option('-n, --role-name <value>', 'Custom role name')
  .option('--dry-run', 'Show CDK command without executing')
  .parse();

const options = program.opts();

// Build context parameters
const contextParams = [
  `tenantId=${options.tenantId}`,
  `identityProviderArn=${options.identityProviderArn}`,
  `audience=${options.audience}`,
  `tenantIdClaim=${options.tenantIdClaim}`,
  `tenantRegion=${options.region}`,
];

if (options.roleName) {
  contextParams.push(`roleName=${options.roleName}`);
}

// Build CDK command
const cdkCommand = `npm run cdk:deploy:tenant -- ${contextParams.map(p => `--context ${p}`).join(' ')} TenantIamRoleStack-${options.tenantId}`;

console.log('Deploying tenant IAM role stack...');
console.log(`Tenant ID: ${options.tenantId}`);
console.log(`Region: ${options.region}`);
console.log(`Identity Provider ARN: ${options.identityProviderArn}`);
console.log(`Audience: ${options.audience}`);
console.log(`Tenant ID Claim: ${options.tenantIdClaim}`);
if (options.roleName) {
  console.log(`Role Name: ${options.roleName}`);
}
console.log('\nCDK Command:');
console.log(cdkCommand);

if (options.dryRun) {
  console.log('\n[DRY RUN] Command not executed.');
} else {
  console.log('\nExecuting deployment...\n');
  try {
    execSync(cdkCommand, { stdio: 'inherit' });
    console.log('\n✅ Deployment completed successfully!');
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}