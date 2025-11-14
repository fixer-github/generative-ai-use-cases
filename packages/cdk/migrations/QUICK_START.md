# Migration Quick Start Guide

## Installation

```bash
cd packages/cdk
npm install
```

## Quick Commands

### 1. Discover Resources

```bash
npx ts-node scripts/migrations/cli.ts discover \
  --region us-east-1 \
  --output discovery-report.json
```

### 2. Dry Run

```bash
npx ts-node scripts/migrations/cli.ts migrate \
  --region us-east-1 \
  --old-bot-table "YOUR_BOT_TABLE" \
  --old-conversation-table "YOUR_CONVERSATION_TABLE" \
  --new-assistant-table "YOUR_ASSISTANT_TABLE" \
  --new-chat-table "YOUR_CHAT_TABLE" \
  --tenant-id "default" \
  --dry-run
```

### 3. Execute Migration

```bash
npx ts-node scripts/migrations/cli.ts migrate \
  --region us-east-1 \
  --old-bot-table "YOUR_BOT_TABLE" \
  --old-conversation-table "YOUR_CONVERSATION_TABLE" \
  --new-assistant-table "YOUR_ASSISTANT_TABLE" \
  --new-chat-table "YOUR_CHAT_TABLE" \
  --tenant-id "default"
```

### 4. Validate

```bash
npx ts-node scripts/migrations/cli.ts validate \
  --region us-east-1 \
  --old-bot-table "YOUR_BOT_TABLE" \
  --old-conversation-table "YOUR_CONVERSATION_TABLE" \
  --new-assistant-table "YOUR_ASSISTANT_TABLE" \
  --new-chat-table "YOUR_CHAT_TABLE" \
  --sample-size 20 \
  --output validation-report.json
```

### 5. OpenSearch Info

```bash
npx ts-node scripts/migrations/cli.ts opensearch-info \
  --region us-east-1 \
  --source-domain "old-domain" \
  --export-path "./exports"
```

## Files Created

```
scripts/migrations/
├── cli.ts                          # Main CLI entry point
├── discovery.ts                    # Resource discovery tool
├── README.md                       # Full documentation
├── QUICK_START.md                  # This file
├── types/
│   └── old-schema.ts              # Old schema type definitions
├── transformers/
│   ├── assistant.ts               # Bot → Assistant transformer
│   ├── chat.ts                    # Conversation → Chat+Messages transformer
│   └── knowledge.ts               # Knowledge source transformer
├── writers/
│   ├── dynamo.ts                  # DynamoDB batch writer
│   ├── s3.ts                      # S3 file migration
│   └── opensearch.ts              # OpenSearch stub (manual process)
└── utils/
    └── validation.ts              # Validation and reporting
```

## Key Features

- **Idempotent**: Safe to re-run, skips existing records
- **Dry Run**: Preview changes without writing
- **Validation**: Compare old and new data
- **Progress Tracking**: Real-time progress updates
- **Error Handling**: Graceful error handling with reporting
- **Batch Processing**: Configurable batch sizes
- **Type Safe**: Full TypeScript type checking

## See Full Documentation

For complete details, see [README.md](./README.md)
