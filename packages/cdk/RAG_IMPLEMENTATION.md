# RAG/OpenSearch Integration Implementation

## Overview

This implementation adds RAG (Retrieval-Augmented Generation) capabilities to the Assistant API, enabling assistants to retrieve context from uploaded documents using OpenSearch vector search for enhanced responses.

## Implementation Summary

### Files Created

1. **`lambda/repository/assistantSearch.ts`**
   - OpenSearch vector store repository using LangChain
   - Functions: `initVectorStore`, `indexDocuments`, `similaritySearch`, `deleteAssistantDocuments`
   - Uses BedrockEmbeddings (Titan v2) for generating embeddings
   - Filters documents by assistantId metadata

2. **`lambda/utils/documentLoader.ts`**
   - Document loading and processing utilities
   - Functions: `loadDocumentsFromS3`, `chunkDocuments`, `addMetadata`
   - Supports multiple S3 URL formats
   - Uses RecursiveCharacterTextSplitter for chunking (1000 chars, 200 overlap)

### Files Modified

3. **`lambda/createAssistantMessage.ts`**
   - Added RAG context retrieval when `ragEnabled=true`
   - Queries OpenSearch for top 5 relevant documents
   - Includes context in system message
   - Returns sources in response
   - Graceful fallback if RAG fails

4. **`lambda/createAssistant.ts`**
   - Added document ingestion after assistant creation
   - Loads, chunks, and indexes documents synchronously
   - Non-blocking: assistant creation succeeds even if indexing fails

5. **`lambda/updateAssistant.ts`**
   - Re-indexes documents when S3 URLs are updated
   - Deletes old documents before indexing new ones
   - Only triggers when `ragEnabled=true` and `s3Urls` changed

6. **`lambda/deleteAssistant.ts`**
   - Cleans up OpenSearch documents when assistant is deleted
   - Non-blocking: deletion succeeds even if OpenSearch cleanup fails

7. **`lib/construct/api/assistant.ts`**
   - Added environment variables: `OPENSEARCH_ENDPOINT`, `OPENSEARCH_INDEX`
   - Granted S3 read permissions to create/update functions
   - Added TODO for OpenSearch IAM permissions

8. **`package.json`**
   - Added required dependencies:
     - `@langchain/aws` (^0.1.16)
     - `@langchain/community` (^0.3.31)
     - `@langchain/textsplitters` (^0.1.0)
     - `@opensearch-project/opensearch` (^2.15.0)

## Architecture

```
┌─────────────────┐
│   User Request  │
│  (with RAG on)  │
└────────┬────────┘
         │
         v
┌─────────────────────────────────────┐
│  createAssistantMessage Lambda      │
│                                     │
│  1. Store user message              │
│  2. Query OpenSearch (top 5 docs)   │
│  3. Format RAG context              │
│  4. Call Bedrock with context       │
│  5. Store response with sources     │
└─────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────┐
│     OpenSearch Vector Store         │
│                                     │
│  - Index: assistant-docs            │
│  - Filter: assistantId metadata     │
│  - Embeddings: Titan v2             │
└─────────────────────────────────────┘
```

## Next Steps Required

### 1. Install Dependencies

```bash
cd packages/cdk
npm install
```

### 2. Configure OpenSearch

The implementation requires an OpenSearch Serverless collection. You have two options:

**Option A: Create New OpenSearch Collection for Assistant API**

Add to the main API stack:

```typescript
import { BotStore } from '../temp-bedrock-chat/constructs/bot-store';

// In BackendApi construct
const assistantBotStore = new BotStore(this, 'AssistantBotStore', {
  envPrefix: props.environment,
  botTable: props.assistantTable,
  conversationTable: props.table,
  language: 'en',
  enableBotStoreReplicas: false,
});

// Pass to AssistantApi
const apiProps = {
  ...existingProps,
  assistantBotStore,
};
```

**Option B: Share Existing BotStore from Tenant Stacks**

If tenant stacks already have BotStore, expose the endpoint via environment variable or SSM parameter.

### 3. Add OpenSearch IAM Permissions

In `lib/construct/api/assistant.ts`, uncomment and configure the TODO section:

```typescript
// After BotStore is available, add data access policies
if (assistantBotStore) {
  assistantBotStore.addDataAccessPolicy(
    props.environment,
    'AssistantCreateDataAccess',
    createAssistantFunction.role!,
    ['aoss:DescribeCollectionItems', 'aoss:CreateCollectionItems'],
    ['aoss:WriteDocument', 'aoss:DescribeIndex', 'aoss:CreateIndex']
  );

  assistantBotStore.addDataAccessPolicy(
    props.environment,
    'AssistantUpdateDataAccess',
    updateAssistantFunction.role!,
    ['aoss:DescribeCollectionItems', 'aoss:CreateCollectionItems'],
    ['aoss:WriteDocument', 'aoss:DescribeIndex', 'aoss:CreateIndex', 'aoss:DeleteDocument']
  );

  assistantBotStore.addDataAccessPolicy(
    props.environment,
    'AssistantDeleteDataAccess',
    deleteAssistantFunction.role!,
    ['aoss:DescribeCollectionItems'],
    ['aoss:DeleteDocument', 'aoss:DescribeIndex']
  );

  assistantBotStore.addDataAccessPolicy(
    props.environment,
    'AssistantMessageDataAccess',
    createMessageFunction.role!,
    ['aoss:DescribeCollectionItems'],
    ['aoss:ReadDocument', 'aoss:DescribeIndex']
  );
}
```

### 4. Set Environment Variable

Set `OPENSEARCH_ENDPOINT` to your OpenSearch collection endpoint:

```typescript
// In assistant.ts, replace:
OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT || '',

// With:
OPENSEARCH_ENDPOINT: assistantBotStore.openSearchEndpoint,
```

### 5. Testing

**Create Assistant with RAG:**
```bash
curl -X POST https://api.example.com/assistant \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Document Assistant",
    "instruction": "You are a helpful assistant that answers questions based on provided documents.",
    "modelId": "anthropic.claude-3-sonnet-20240229-v1:0",
    "ragEnabled": true,
    "s3Urls": ["s3://bucket/document.txt"]
  }'
```

**Send Message:**
```bash
curl -X POST https://api.example.com/assistant/{id}/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "What does the document say about X?"
  }'
```

Expected response includes `sources` array with relevant document excerpts.

### 6. Monitoring

Monitor these CloudWatch metrics:
- Lambda invocation errors
- Lambda duration (document ingestion may be slow)
- OpenSearch indexing errors
- RAG retrieval failures (logged but non-blocking)

## Key Features

✅ **Vector Search**: Uses OpenSearch for semantic similarity search
✅ **Automatic Chunking**: Splits large documents into 1000-char chunks
✅ **Source Attribution**: Returns document sources with responses
✅ **Graceful Degradation**: Works without RAG if indexing/retrieval fails
✅ **Isolation**: Documents filtered by assistantId to prevent cross-contamination
✅ **Cleanup**: Automatic document deletion when assistant is removed

## Limitations & Future Enhancements

- **Synchronous Ingestion**: Document processing blocks assistant creation (consider async via SQS)
- **Single Embedding Model**: Hard-coded to Titan v2 (consider making configurable)
- **Text Only**: Currently supports text documents only (could add PDF parsing)
- **No Progress Tracking**: Users can't see indexing status (consider adding `syncStatus` updates)
- **Fixed Chunk Size**: 1000 chars may not be optimal for all document types

## Compatibility

This implementation maintains full backward compatibility:
- Assistants with `ragEnabled=false` work exactly as before
- No changes required to existing API contracts
- Assistants without S3 URLs skip document processing
