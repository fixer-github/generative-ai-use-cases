#!/usr/bin/env ts-node

/**
 * Migration script to populate tenant records with OpenSearch endpoints
 *
 * Usage:
 *   AWS_PROFILE=genu npx ts-node scripts/migrate-tenant-opensearch.ts <environment>
 *
 * Example:
 *   AWS_PROFILE=genu npx ts-node scripts/migrate-tenant-opensearch.ts dev
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const environment = process.argv[2];
const region = process.env.AWS_REGION || 'us-east-1';

if (!environment) {
  console.error('Error: Environment argument is required');
  console.error('Usage: AWS_PROFILE=genu npx ts-node scripts/migrate-tenant-opensearch.ts <environment>');
  console.error('Example: AWS_PROFILE=genu npx ts-node scripts/migrate-tenant-opensearch.ts dev');
  process.exit(1);
}

const cfnClient = new CloudFormationClient({ region });
const dynamoClient = new DynamoDBClient({ region });

interface TenantRecord {
  tenantId: string;
  openSearchEndpoint?: string;
  openSearchDomainArn?: string;
  openSearchIndexName?: string;
}

interface OpenSearchStackInfo {
  stackName: string;
  tenantId: string;
  endpoint: string;
  domainArn: string;
}

/**
 * Find all tenant OpenSearch stacks for the given environment
 */
async function findTenantOpenSearchStacks(): Promise<OpenSearchStackInfo[]> {
  console.log(`\nSearching for tenant OpenSearch stacks in environment: ${environment}...`);

  const stacks: OpenSearchStackInfo[] = [];
  let nextToken: string | undefined;

  do {
    const response = await cfnClient.send(
      new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: [
          'CREATE_COMPLETE',
          'UPDATE_COMPLETE',
          'UPDATE_ROLLBACK_COMPLETE',
        ],
      })
    );

    for (const summary of response.StackSummaries || []) {
      const stackName = summary.StackName;

      // Look for tenant OpenSearch stacks matching the pattern
      // Example: dev-tenant123-opensearch, prod-customer456-opensearch
      if (
        stackName.startsWith(`${environment}-`) &&
        stackName.includes('-opensearch') &&
        summary.StackStatus?.includes('COMPLETE')
      ) {
        console.log(`Found stack: ${stackName}`);

        try {
          // Get stack details to extract outputs
          const stackDetails = await cfnClient.send(
            new DescribeStacksCommand({
              StackName: stackName,
            })
          );

          const stack = stackDetails.Stacks?.[0];
          if (!stack || !stack.Outputs) {
            console.warn(`  ⚠ Stack has no outputs, skipping`);
            continue;
          }

          // Extract tenant ID from stack name or tags
          const tenantTag = stack.Tags?.find((t) => t.Key === 'TenantId');
          if (!tenantTag?.Value) {
            console.warn(`  ⚠ Stack has no TenantId tag, skipping`);
            continue;
          }

          const tenantId = tenantTag.Value;

          // Extract OpenSearch endpoint and ARN from outputs
          const endpoint = stack.Outputs.find(
            (o) => o.OutputKey === 'DomainEndpoint'
          )?.OutputValue;

          const domainArn = stack.Outputs.find(
            (o) => o.OutputKey === 'DomainArn'
          )?.OutputValue;

          if (!endpoint) {
            console.warn(`  ⚠ No DomainEndpoint output found, skipping`);
            continue;
          }

          stacks.push({
            stackName,
            tenantId,
            endpoint,
            domainArn: domainArn || '',
          });

          console.log(`  ✓ Tenant: ${tenantId}, Endpoint: ${endpoint}`);
        } catch (error) {
          console.error(`  ✗ Error processing stack:`, error);
        }
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);

  console.log(`\nFound ${stacks.length} tenant OpenSearch stacks`);
  return stacks;
}

/**
 * Get all tenant records from DynamoDB
 */
async function getTenantRecords(tableName: string): Promise<TenantRecord[]> {
  console.log(`\nScanning tenants table: ${tableName}...`);

  const tenants: TenantRecord[] = [];
  let lastEvaluatedKey: any;

  do {
    const response = await dynamoClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    for (const item of response.Items || []) {
      const tenant = unmarshall(item) as TenantRecord;
      tenants.push(tenant);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Found ${tenants.length} tenant records`);
  return tenants;
}

/**
 * Update tenant record with OpenSearch metadata
 */
async function updateTenantWithOpenSearch(
  tableName: string,
  tenantId: string,
  stackInfo: OpenSearchStackInfo
): Promise<void> {
  console.log(`\nUpdating tenant ${tenantId}...`);

  try {
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ tenantId }),
        UpdateExpression:
          'SET openSearchEndpoint = :endpoint, openSearchDomainArn = :arn, openSearchIndexName = :indexName, updatedAt = :updatedAt',
        ExpressionAttributeValues: marshall({
          ':endpoint': stackInfo.endpoint,
          ':arn': stackInfo.domainArn,
          ':indexName': 'assistant-docs',
          ':updatedAt': new Date().toISOString(),
        }),
      })
    );

    console.log(`  ✓ Updated successfully`);
  } catch (error) {
    console.error(`  ✗ Failed to update:`, error);
    throw error;
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('Tenant OpenSearch Endpoint Migration');
  console.log('='.repeat(80));
  console.log(`Environment: ${environment}`);
  console.log(`Region: ${region}`);
  console.log(`AWS Profile: ${process.env.AWS_PROFILE || '(default)'}`);

  // Determine tenants table name
  const tenantsTableName = `Tenants-${environment}`;
  console.log(`Tenants Table: ${tenantsTableName}`);

  try {
    // Step 1: Find all tenant OpenSearch stacks
    const opensearchStacks = await findTenantOpenSearchStacks();

    if (opensearchStacks.length === 0) {
      console.log('\n⚠ No tenant OpenSearch stacks found. Nothing to migrate.');
      return;
    }

    // Step 2: Get all tenant records
    const tenantRecords = await getTenantRecords(tenantsTableName);

    // Step 3: Match and update
    console.log('\n' + '='.repeat(80));
    console.log('Updating Tenant Records');
    console.log('='.repeat(80));

    let updatedCount = 0;
    let skippedCount = 0;

    for (const stackInfo of opensearchStacks) {
      const tenant = tenantRecords.find((t) => t.tenantId === stackInfo.tenantId);

      if (!tenant) {
        console.log(`\n⚠ No tenant record found for ${stackInfo.tenantId}, skipping`);
        skippedCount++;
        continue;
      }

      // Check if already configured
      if (tenant.openSearchEndpoint === stackInfo.endpoint) {
        console.log(`\n✓ Tenant ${stackInfo.tenantId} already has correct endpoint, skipping`);
        skippedCount++;
        continue;
      }

      await updateTenantWithOpenSearch(tenantsTableName, stackInfo.tenantId, stackInfo);
      updatedCount++;
    }

    console.log('\n' + '='.repeat(80));
    console.log('Migration Summary');
    console.log('='.repeat(80));
    console.log(`Total stacks found: ${opensearchStacks.length}`);
    console.log(`Tenants updated: ${updatedCount}`);
    console.log(`Tenants skipped: ${skippedCount}`);
    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
main();
