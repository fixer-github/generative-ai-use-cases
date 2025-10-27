# Migration Guide: temp-bedrock-chat to Assistant API

This guide helps you migrate from the Python-based `temp-bedrock-chat` implementation to the new TypeScript-based Assistant API.

## Table of Contents

- [Overview](#overview)
- [What's Changed](#whats-changed)
- [Breaking Changes](#breaking-changes)
- [Side-by-Side Comparison](#side-by-side-comparison)
- [Migration Steps](#migration-steps)
- [Data Migration](#data-migration)
- [Testing Your Migration](#testing-your-migration)
- [Rollback Plan](#rollback-plan)

## Overview

The Assistant API is a complete reimplementation that provides:

- **Better Performance**: Immediate list updates using DynamoDB instead of OpenSearch aggregations
- **Lower Costs**: DynamoDB for metadata storage is more cost-effective than OpenSearch
- **Type Safety**: Full TypeScript implementation with compile-time type checking
- **Improved Architecture**: Clean separation between metadata (DynamoDB) and vector search (OpenSearch)
- **Consistent Patterns**: Follows the same patterns as existing `/api/chat` endpoints

## What's Changed

### Technology Stack

| Component | Old (temp-bedrock-chat) | New (Assistant API) |
|-----------|------------------------|---------------------|
| Language | Python | TypeScript |
| Primary Storage | OpenSearch | DynamoDB |
| Vector Search | OpenSearch | OpenSearch Serverless |
| List Operations | OpenSearch aggregations | DynamoDB queries |
| Framework | Python Lambda | TypeScript Lambda |
| Type Safety | Runtime validation | Compile-time TypeScript |

### Architecture

**Old Architecture:**
```
temp-bedrock-chat (Python)
├── OpenSearch (metadata + vectors)
├── S3 (document storage)
└── Bedrock (LLM)
```

**New Architecture:**
```
Assistant API (TypeScript)
├── DynamoDB (metadata: assistants, messages)
├── OpenSearch Serverless (vector search only)
├── S3 (document storage)
└── Bedrock (LLM)
```

### Key Improvements

1. **Instant List Updates**: Assistant lists update immediately after creation/deletion (DynamoDB query vs OpenSearch eventual consistency)
2. **Lower Latency**: Direct DynamoDB queries are faster than OpenSearch aggregations
3. **Cost Optimization**: DynamoDB is cheaper for metadata operations
4. **Better Scalability**: DynamoDB auto-scaling handles traffic spikes better
5. **Type Safety**: TypeScript prevents runtime type errors
6. **Testability**: Comprehensive unit test coverage with Jest

## Breaking Changes

### 1. Endpoint Structure

**Old Format:**
```
POST /bedrock-chat/assistants
GET /bedrock-chat/assistants
GET /bedrock-chat/assistants/{id}
PUT /bedrock-chat/assistants/{id}
DELETE /bedrock-chat/assistants/{id}
POST /bedrock-chat/assistants/{id}/chat
GET /bedrock-chat/assistants/{id}/messages
```

**New Format:**
```
POST /assistants
GET /assistants
GET /assistants/{assistantId}
PUT /assistants/{assistantId}
DELETE /assistants/{assistantId}
POST /assistants/{assistantId}/messages
GET /assistants/{assistantId}/messages
```

**Changes:**
- Removed `/bedrock-chat` prefix
- Changed `/chat` to `/messages` for consistency

### 2. Request/Response Format Changes

#### Assistant Creation

**Old Request:**
```json
{
  "name": "My Assistant",
  "description": "Description",
  "systemPrompt": "System instructions",
  "modelId": "anthropic.claude-v2",
  "enableRag": true,
  "documentUrls": ["s3://bucket/file.pdf"]
}
```

**New Request:**
```json
{
  "name": "My Assistant",
  "description": "Description",
  "instruction": "System instructions",
  "modelId": "anthropic.claude-v2",
  "ragEnabled": true,
  "s3Urls": ["s3://bucket/file.pdf"]
}
```

**Field Mapping:**
- `systemPrompt` → `instruction`
- `enableRag` → `ragEnabled`
- `documentUrls` → `s3Urls`

#### Assistant Response

**Old Response:**
```json
{
  "assistantId": "123",
  "name": "My Assistant",
  "description": "Description",
  "systemPrompt": "Instructions",
  "modelId": "anthropic.claude-v2",
  "enableRag": true,
  "documentUrls": ["s3://bucket/file.pdf"],
  "indexStatus": "completed",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

**New Response:**
```json
{
  "id": "user#john.doe",
  "createdDate": "1698765432000",
  "assistantId": "assistant#123",
  "userId": "user#john.doe",
  "name": "My Assistant",
  "description": "Description",
  "instruction": "Instructions",
  "modelId": "anthropic.claude-v2",
  "ragEnabled": true,
  "s3Urls": ["s3://bucket/file.pdf"],
  "syncStatus": "SUCCEEDED",
  "syncStatusReason": "",
  "updatedDate": "1698765432000"
}
```

**Field Mapping:**
- `systemPrompt` → `instruction`
- `enableRag` → `ragEnabled`
- `documentUrls` → `s3Urls`
- `indexStatus` → `syncStatus`
- `createdAt` → `createdDate` (Unix timestamp)
- `updatedAt` → `updatedDate` (Unix timestamp)
- New fields: `id`, `userId`, `syncStatusReason`

### 3. Message Endpoint Changes

**Old Endpoint:**
```
POST /bedrock-chat/assistants/{id}/chat
```

**New Endpoint:**
```
POST /assistants/{assistantId}/messages
```

**Old Request:**
```json
{
  "message": "Hello"
}
```

**New Request:**
```json
{
  "content": "Hello"
}
```

**Field Mapping:**
- `message` → `content`

### 4. Pagination Format

**Old Pagination:**
```json
{
  "items": [...],
  "nextToken": "opaque-token"
}
```

**New Pagination:**
```json
{
  "assistants": [...],
  "lastEvaluatedKey": "base64-encoded-key"
}
```

**Field Mapping:**
- `items` → `assistants` (for assistant lists) or `messages` (for message lists)
- `nextToken` → `lastEvaluatedKey`

### 5. Error Response Format

**Old Format:**
```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**New Format:**
```json
{
  "message": "Error message"
}
```

Status codes remain the same (400, 403, 404, 500).

## Side-by-Side Comparison

### List Assistants

**Old (Python):**
```bash
curl -X GET "https://api.example.com/bedrock-chat/assistants" \
  -H "Authorization: Bearer TOKEN"
```

**New (TypeScript):**
```bash
curl -X GET "https://api.example.com/assistants" \
  -H "Authorization: Bearer TOKEN"
```

### Create Assistant

**Old (Python):**
```bash
curl -X POST "https://api.example.com/bedrock-chat/assistants" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Assistant",
    "description": "Description",
    "systemPrompt": "You are helpful",
    "modelId": "anthropic.claude-v2",
    "enableRag": true,
    "documentUrls": ["s3://bucket/file.pdf"]
  }'
```

**New (TypeScript):**
```bash
curl -X POST "https://api.example.com/assistants" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Assistant",
    "description": "Description",
    "instruction": "You are helpful",
    "modelId": "anthropic.claude-v2",
    "ragEnabled": true,
    "s3Urls": ["s3://bucket/file.pdf"]
  }'
```

### Send Message

**Old (Python):**
```bash
curl -X POST "https://api.example.com/bedrock-chat/assistants/123/chat" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello"
  }'
```

**New (TypeScript):**
```bash
curl -X POST "https://api.example.com/assistants/123/messages" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello"
  }'
```

## Migration Steps

### Step 1: Update Client Code

Update your client application to use the new endpoints and request/response formats.

**JavaScript/TypeScript Client Example:**

```typescript
// Old client code
class OldAssistantClient {
  async createAssistant(data: any) {
    return fetch('/bedrock-chat/assistants', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        systemPrompt: data.instruction,
        modelId: data.modelId,
        enableRag: data.ragEnabled,
        documentUrls: data.s3Urls,
      }),
    });
  }
}

// New client code
class AssistantClient {
  async createAssistant(data: CreateAssistantRequest) {
    return fetch('/assistants', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        instruction: data.instruction,
        modelId: data.modelId,
        ragEnabled: data.ragEnabled,
        s3Urls: data.s3Urls,
      }),
    });
  }
}
```

### Step 2: Update Response Handlers

Update code that processes API responses to handle the new field names.

```typescript
// Old response handler
function handleAssistantResponse(response: any) {
  console.log('Assistant ID:', response.assistantId);
  console.log('Created at:', new Date(response.createdAt));
  console.log('Status:', response.indexStatus);
}

// New response handler
function handleAssistantResponse(response: Assistant) {
  console.log('Assistant ID:', response.assistantId);
  console.log('Created at:', new Date(parseInt(response.createdDate)));
  console.log('Status:', response.syncStatus);
}
```

### Step 3: Update Error Handling

Adapt error handling to the new response format.

```typescript
// Old error handler
function handleError(error: any) {
  console.error('Error:', error.error);
  console.error('Code:', error.code);
}

// New error handler
function handleError(error: any) {
  console.error('Error:', error.message);
}
```

### Step 4: Update Pagination Logic

Modify pagination to use `lastEvaluatedKey` instead of `nextToken`.

```typescript
// Old pagination
async function listAllAssistants() {
  let allAssistants = [];
  let nextToken = undefined;

  do {
    const url = nextToken
      ? `/bedrock-chat/assistants?nextToken=${nextToken}`
      : '/bedrock-chat/assistants';
    const response = await fetch(url);
    const data = await response.json();

    allAssistants.push(...data.items);
    nextToken = data.nextToken;
  } while (nextToken);

  return allAssistants;
}

// New pagination
async function listAllAssistants() {
  let allAssistants = [];
  let lastEvaluatedKey = undefined;

  do {
    const url = lastEvaluatedKey
      ? `/assistants?exclusiveStartKey=${lastEvaluatedKey}`
      : '/assistants';
    const response = await fetch(url);
    const data = await response.json();

    allAssistants.push(...data.assistants);
    lastEvaluatedKey = data.lastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allAssistants;
}
```

### Step 5: Deploy Updated Client

1. Test the updated client code in a development environment
2. Deploy to staging for integration testing
3. Deploy to production with monitoring

### Step 6: Monitor and Verify

After deployment, monitor:

- API response times (should be faster)
- Error rates (should be low)
- DynamoDB metrics (provisioned capacity or on-demand usage)
- OpenSearch metrics (only vector search queries)

## Data Migration

### Important Notes

**Manual migration is required** - there is no automated migration tool. Consider these options:

### Option 1: Fresh Start (Recommended)

If your existing assistants are temporary or easily recreated:

1. Users create new assistants in the new system
2. Documents are re-uploaded and re-indexed
3. Old assistants are gradually deprecated

**Pros:**
- Clean slate with no migration issues
- Users validate their assistants
- No data transformation required

**Cons:**
- Users need to recreate assistants
- Temporary disruption

### Option 2: Export and Import

For production systems with critical assistants:

1. **Export from OpenSearch:**
   ```bash
   # Query all assistants from old OpenSearch index
   aws opensearch query --index assistants --query '{"query": {"match_all": {}}}'
   ```

2. **Transform Data:**
   ```python
   # Transform old format to new format
   def transform_assistant(old_assistant):
       return {
           'name': old_assistant['name'],
           'description': old_assistant['description'],
           'instruction': old_assistant['systemPrompt'],
           'modelId': old_assistant['modelId'],
           'ragEnabled': old_assistant['enableRag'],
           's3Urls': old_assistant['documentUrls'],
       }
   ```

3. **Import via API:**
   ```bash
   # Create assistants via new API
   for assistant in transformed_assistants:
       curl -X POST "https://api.example.com/assistants" \
         -H "Authorization: Bearer TOKEN" \
         -d "$assistant"
   ```

**Pros:**
- Preserves existing assistants
- Minimal disruption to users

**Cons:**
- Requires custom migration scripts
- Potential for data inconsistencies
- Time-consuming for large datasets

### Option 3: Parallel Operation

Run both systems in parallel during transition:

1. Deploy new Assistant API alongside old system
2. Update frontend to support both APIs (feature flag)
3. Gradually migrate users to new system
4. Deprecate old system after migration complete

**Pros:**
- Zero downtime
- Gradual rollout
- Easy rollback

**Cons:**
- Operational complexity
- Maintaining two systems temporarily
- Data synchronization challenges

### Message History Migration

**Note:** Message history is **not** automatically migrated. Options:

1. **Fresh start**: Users begin new conversations (recommended)
2. **Export/import**: Extract from OpenSearch, transform, bulk import to DynamoDB
3. **On-demand**: Load old messages only when accessed (lazy migration)

## Testing Your Migration

### Pre-Migration Testing

1. **Unit Tests**: Verify all tests pass
   ```bash
   cd packages/cdk
   npm test
   ```

2. **Integration Tests**: Test API endpoints
   ```bash
   # Test create assistant
   curl -X POST "https://staging-api.example.com/assistants" \
     -H "Authorization: Bearer TOKEN" \
     -d '{...}'

   # Test list assistants
   curl -X GET "https://staging-api.example.com/assistants" \
     -H "Authorization: Bearer TOKEN"
   ```

3. **Load Testing**: Verify performance under load
   ```bash
   # Use your preferred load testing tool
   artillery run load-test.yml
   ```

### Post-Migration Verification

1. **Functional Testing**:
   - Create assistant → verify in list
   - Send message → verify response
   - Update assistant → verify changes
   - Delete assistant → verify removal

2. **Performance Testing**:
   - List response time < 200ms (was ~500ms with OpenSearch)
   - Create response time < 1s
   - Message response time depends on LLM

3. **Data Validation**:
   - Verify assistant count matches
   - Spot-check assistant configurations
   - Test RAG functionality with known documents

## Rollback Plan

If critical issues arise after migration:

### Immediate Rollback

1. **Revert API Gateway configuration** to old Lambda functions
2. **Update frontend** to use old endpoints (if already deployed)
3. **Monitor** old system for stability

### Partial Rollback

1. Use **feature flags** to disable new API for affected users
2. Route specific tenants to old API
3. Fix issues and gradually re-enable new API

### Data Recovery

- DynamoDB point-in-time recovery: Enable before migration
- OpenSearch snapshots: Keep old data for 30 days
- S3 document versioning: Ensure enabled

## Support and Troubleshooting

### Common Issues

#### Issue: 403 Forbidden
**Cause:** User trying to access another user's assistant
**Solution:** Verify `userId` matches assistant owner

#### Issue: 404 Not Found
**Cause:** Invalid `assistantId` or assistant deleted
**Solution:** Verify assistant exists via list endpoint

#### Issue: 500 Internal Server Error
**Cause:** Various (DynamoDB throttling, Bedrock errors, etc.)
**Solution:** Check CloudWatch logs for detailed error

### Getting Help

1. **CloudWatch Logs**: Check Lambda logs for detailed errors
2. **API Gateway Logs**: Enable execution logging for request/response inspection
3. **DynamoDB Metrics**: Monitor for throttling or capacity issues
4. **Documentation**: Refer to [ASSISTANT_API.md](./ASSISTANT_API.md)
5. **Repository**: File issues with logs and reproduction steps

## Conclusion

The migration from `temp-bedrock-chat` to Assistant API brings significant improvements in performance, cost, and maintainability. While the changes are breaking, the new API follows modern best practices and aligns with existing patterns in the codebase.

For most use cases, we recommend **Option 1: Fresh Start** as it's the simplest and ensures data consistency. For production systems with critical data, **Option 2: Export and Import** or **Option 3: Parallel Operation** provide paths with minimal disruption.

Remember to:
- Test thoroughly in staging before production deployment
- Monitor closely after migration
- Have a rollback plan ready
- Communicate changes to users in advance

The improved architecture will provide better user experience and lower operational costs in the long run.
