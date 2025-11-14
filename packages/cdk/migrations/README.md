# RAG Chatbot to Assistant Migration Guide

This document provides comprehensive instructions for migrating data from the old Python-based bedrock-chat (RAG chatbot) to the new TypeScript-based Assistant feature.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Migration Architecture](#migration-architecture)
4. [Step-by-Step Guide](#step-by-step-guide)
5. [Validation](#validation)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)
8. [Appendix](#appendix)

## Overview

### What This Migration Does

- Migrates Bot records to Assistant records
- Migrates Conversation records to Chat and Message records
- Transforms Knowledge Base configurations
- Copies S3 files to new locations
- Provides validation and reporting tools

### Schema Mapping

| Old Schema (Python) | New Schema (TypeScript) |
|---------------------|-------------------------|
| Bot Table | Assistant Table |
| Conversation Table | ChatHistory Table (Chat + Message records) |
| Knowledge.s3_urls[] | KnowledgeSource[] with type='file' |
| Knowledge.source_urls[] | KnowledgeSource[] with type='url' |
| Knowledge.sitemap_urls[] | KnowledgeSource[] with type='web' |
| MessageMap (nested) | Flat Message records |

## Prerequisites

### Required Information

1. AWS region where resources are deployed
2. Old DynamoDB table names:
   - Bot table name
   - Conversation table name
3. New DynamoDB table names:
   - Assistant table name
   - ChatHistory table name
4. Default tenant ID for migrated data
5. AWS credentials with appropriate permissions

### Required Permissions

The migration script requires IAM permissions for:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:Query",
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:DescribeTable",
        "dynamodb:ListTables"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/OLD_BOT_TABLE",
        "arn:aws:dynamodb:*:*:table/OLD_CONVERSATION_TABLE",
        "arn:aws:dynamodb:*:*:table/NEW_ASSISTANT_TABLE",
        "arn:aws:dynamodb:*:*:table/NEW_CHAT_TABLE"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:CopyObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::OLD_BUCKET/*",
        "arn:aws:s3:::NEW_BUCKET/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:DescribeDomain",
        "es:ListDomainNames"
      ],
      "Resource": "*"
    }
  ]
}
```

### Install Dependencies

```bash
cd packages/cdk
npm install
```

## Migration Architecture

### Module Structure

```
scripts/migrations/
├── cli.ts                      # Main CLI entry point
├── discovery.ts                # Resource discovery
├── types/
│   └── old-schema.ts          # Old schema type definitions
├── transformers/
│   ├── assistant.ts           # Bot → Assistant transformer
│   ├── chat.ts                # Conversation → Chat transformer
│   └── knowledge.ts           # Knowledge source transformer
├── writers/
│   ├── dynamo.ts              # DynamoDB writer with batching
│   ├── s3.ts                  # S3 file migration writer
│   └── opensearch.ts          # OpenSearch migration stub
└── utils/
    └── validation.ts          # Validation utilities
```

### Data Flow

```
Old DynamoDB Tables → Scan & Transform → Validate → Write → New DynamoDB Tables
Old S3 Buckets     → Discover & Copy   → Verify  →        → New S3 Buckets
Old OpenSearch     → Export to JSON    → Manual Process  → New Knowledge Base
```

## Step-by-Step Guide

### Step 1: Resource Discovery

Run the discovery command to identify old resources:

```bash
npx ts-node scripts/migrations/cli.ts discover \
  --region us-east-1 \
  --table-prefix "BedrockChat" \
  --output discovery-report.json
```

**What this does:**
- Scans for DynamoDB tables matching patterns
- Lists S3 buckets
- Identifies OpenSearch domains
- Generates a report with resource details

**Review the output:**
- Verify old bot and conversation tables are identified
- Note the table names for next steps
- Check S3 bucket counts

### Step 2: Dry Run Migration

Execute a dry run to preview the migration:

```bash
npx ts-node scripts/migrations/cli.ts migrate \
  --region us-east-1 \
  --old-bot-table "BedrockChat-BotTable" \
  --old-conversation-table "BedrockChat-ConversationTable" \
  --new-assistant-table "Assistant-Table" \
  --new-chat-table "ChatHistory-Table" \
  --tenant-id "default-tenant" \
  --dry-run
```

**What this does:**
- Scans all old data
- Transforms to new schema
- Reports what would be written
- Does NOT write any data

**Review the output:**
- Check transformation success rate
- Note any errors or warnings
- Verify record counts match expectations

### Step 3: Execute Migration

After dry run validation, execute the actual migration:

```bash
npx ts-node scripts/migrations/cli.ts migrate \
  --region us-east-1 \
  --old-bot-table "BedrockChat-BotTable" \
  --old-conversation-table "BedrockChat-ConversationTable" \
  --new-assistant-table "Assistant-Table" \
  --new-chat-table "ChatHistory-Table" \
  --tenant-id "default-tenant" \
  --batch-size 25
```

**What this does:**
- Transforms and writes assistants
- Transforms and writes chats + messages
- Provides progress updates
- Logs errors

**Optional flags:**
- `--skip-assistants`: Skip assistant migration
- `--skip-chats`: Skip chat migration
- `--skip-s3`: Skip S3 file migration
- `--batch-size`: Control batch size (default: 25)

**Note:** You will be prompted to confirm before writing data.

### Step 4: Validate Migration

Run validation to compare old and new data:

```bash
npx ts-node scripts/migrations/cli.ts validate \
  --region us-east-1 \
  --old-bot-table "BedrockChat-BotTable" \
  --old-conversation-table "BedrockChat-ConversationTable" \
  --new-assistant-table "Assistant-Table" \
  --new-chat-table "ChatHistory-Table" \
  --sample-size 20 \
  --output validation-report.json
```

**What this does:**
- Counts records in old and new tables
- Samples records for comparison
- Generates diff report
- Identifies discrepancies

**Review the validation report:**
- Check that record counts match
- Review sample comparisons
- Investigate any failed validations
- Note warnings (may be acceptable)

### Step 5: S3 File Migration (If Needed)

If knowledge base files need to be migrated:

```bash
# This is handled within the main migrate command
# Or can be done separately with S3Writer if needed
```

The S3Writer:
- Copies files from old buckets to new buckets
- Preserves metadata
- Updates storage key references
- Skips files that already exist

### Step 6: OpenSearch Migration (Manual)

For OpenSearch indices, follow manual steps:

```bash
npx ts-node scripts/migrations/cli.ts opensearch-info \
  --region us-east-1 \
  --source-domain "old-opensearch-domain" \
  --export-path "./opensearch-exports"
```

**Follow the printed instructions:**

1. Export old OpenSearch indices using elasticdump:
   ```bash
   elasticdump \
     --input=https://OLD_DOMAIN/INDEX_NAME \
     --output=./exports/INDEX_NAME.jsonl \
     --type=data
   ```

2. Transform exported data to Bedrock KB format

3. Upload to new KB S3 bucket

4. Trigger Knowledge Base sync via AWS Console

## Validation

### Automated Validation

The `validate` command performs:

- **Record Count Comparison**: Ensures old and new counts match
- **Sample Data Comparison**: Validates transformations on sample records
- **Field Mapping Verification**: Checks key fields were mapped correctly

### Manual Validation

After migration, manually verify:

1. **Assistants:**
   - Open the Assistant UI
   - Verify assistants appear with correct names
   - Check knowledge sources are linked
   - Test RAG functionality

2. **Chats:**
   - Open chat history
   - Verify conversations appear
   - Check messages are in correct order
   - Verify assistant-linked chats work

3. **Knowledge Base:**
   - Check files in S3
   - Verify sync status
   - Test retrieval queries

## Rollback Procedures

### Before Migration

1. **Backup DynamoDB Tables:**
   ```bash
   aws dynamodb create-backup \
     --table-name BedrockChat-BotTable \
     --backup-name bot-table-backup-$(date +%Y%m%d)

   aws dynamodb create-backup \
     --table-name BedrockChat-ConversationTable \
     --backup-name conversation-table-backup-$(date +%Y%m%d)
   ```

2. **Export to S3 (Alternative):**
   ```bash
   aws dynamodb export-table-to-point-in-time \
     --table-arn arn:aws:dynamodb:REGION:ACCOUNT:table/TABLE_NAME \
     --s3-bucket backup-bucket \
     --s3-prefix dynamodb-backups/
   ```

### Rollback New Data

If migration fails and you need to rollback:

1. **Delete Migrated Records (New Tables):**
   ```bash
   # WARNING: This deletes all data in the new tables
   aws dynamodb delete-table --table-name Assistant-Table
   aws dynamodb delete-table --table-name ChatHistory-Table

   # Recreate tables using CDK
   cdk deploy
   ```

2. **Restore Old Tables (If Deleted):**
   ```bash
   aws dynamodb restore-table-from-backup \
     --target-table-name BedrockChat-BotTable \
     --backup-arn arn:aws:dynamodb:REGION:ACCOUNT:table/TABLE_NAME/backup/BACKUP_NAME
   ```

## Troubleshooting

### Common Issues

#### Issue: Table Not Found

**Error:** `ResourceNotFoundException: Requested resource not found`

**Solution:**
- Verify table names are correct
- Check region is correct
- Ensure AWS credentials have access

#### Issue: Transform Validation Errors

**Error:** `Validation failed: Missing required field`

**Solution:**
- Review old data structure
- Check if old records are missing expected fields
- Update transformer to handle missing fields

#### Issue: S3 Parse Errors

**Error:** `Failed to parse S3 URL`

**Solution:**
- Check S3 URL format in old data
- Update `parseS3Url` regex in `knowledge.ts`
- Manually fix malformed URLs in old data

#### Issue: Large Message Load Errors

**Error:** `Failed to load large message from S3`

**Solution:**
- Verify S3 bucket access
- Check `LargeMessagePath` format
- Ensure S3 objects exist

#### Issue: Rate Limiting

**Error:** `ProvisionedThroughputExceededException`

**Solution:**
- Reduce batch size: `--batch-size 10`
- Add delays between batches
- Increase table capacity temporarily

### Debug Mode

For detailed logging, set environment variable:

```bash
export DEBUG=migration:*
npx ts-node scripts/migrations/cli.ts migrate ...
```

## Appendix

### Tenant Assignment Strategy

Since old data doesn't have explicit `tenantId`:

1. Check if user pattern includes tenant: `tenant#xxx#user#yyy`
2. If not, use `--tenant-id` flag value
3. Document tenant mapping in migration report

### Timestamp Conversion

- Old: Unix timestamp (seconds) as decimal
- New: ISO 8601 string
- Conversion: `new Date(oldTime * 1000).toISOString()`

### Message Threading

- Old: Parent/children references in MessageMap
- New: Flat messages ordered by createdDate
- Threading preserved via timestamp ordering

### Knowledge Source Type Mapping

| Old Field | New Type | Notes |
|-----------|----------|-------|
| s3_urls | file | Extract storageKey from URL |
| filenames | file | May need S3 path resolution |
| source_urls | url | Direct URL mapping |
| sitemap_urls | web | Sitemap type |

### Performance Considerations

- **Table Scan**: Full table scans can take time for large tables
- **Batch Size**: Balance between speed and rate limits (default: 25)
- **Parallel Processing**: Currently sequential; could be parallelized
- **Memory**: Large MessageMaps loaded in memory; monitor usage

### Cost Estimation

Migration costs include:

- DynamoDB read capacity (scans)
- DynamoDB write capacity (puts)
- S3 data transfer (copy operations)
- Lambda executions (if any)

Estimated costs for 1000 bots + 10,000 conversations:
- DynamoDB: ~$10-20
- S3: ~$5-10
- Total: ~$15-30 (varies by region)

### Support

For issues or questions:

1. Check this README
2. Review error logs
3. Check validation reports
4. Contact development team

### Version History

- **v1.0.0** (2025-01-14): Initial migration script system
