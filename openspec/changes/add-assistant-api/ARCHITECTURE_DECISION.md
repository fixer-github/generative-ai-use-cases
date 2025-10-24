# Key Architecture Decision: Storage Separation

## The Problem

The current `temp-bedrock-chat` implementation uses **OpenSearch Serverless for listing bots/collections**, which causes:

1. **High costs**: Minimum $0.24/hour (~$175/month) for 0.5 OCU just to list bots
2. **Delayed updates**: 60-second OpenSearch refresh interval means new bots don't appear immediately
3. **Complexity**: Unnecessary use of expensive search infrastructure for simple CRUD operations

## The Solution

### Clear Storage Separation

```
┌─────────────────────────────────────────────────────────────┐
│                     Assistant API                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  DynamoDB (Primary Data Store)        OpenSearch Serverless │
│  ═══════════════════════════          ═══════════════════   │
│                                                               │
│  ✅ Create assistant                   ❌ NOT used for CRUD │
│  ✅ List assistants (<100ms)           ❌ NOT used for list │
│  ✅ Get assistant details              ✅ Vector search     │
│  ✅ Update assistant                   ✅ RAG context       │
│  ✅ Delete assistant                   ✅ Semantic search   │
│  ✅ Message history                                          │
│                                                               │
│  💰 Pay per request                    💰 Pay only for      │
│     ($0.25/million reads)                 actual queries    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Storage Responsibilities

| Storage | Use Case | Cost Model | Consistency |
|---------|----------|------------|-------------|
| **DynamoDB** | All CRUD, listing, retrieval | Pay per request | Immediate (strong consistency) |
| **OpenSearch** | Vector search, RAG context only | Pay per query + OCU | Eventual (60s refresh) |

## Cost Comparison

### Current Implementation (temp-bedrock-chat)

```
List 1000 assistants:
- OpenSearch query: Continuous OCU cost
- Minimum cost: $0.24/hour ($175/month)
- Whether you list 0 times or 1 million times: Same cost

Create assistant:
- OpenSearch indexing: OCU cost
- 60-second delay before appearing in list
```

### New Implementation (Assistant API)

```
List 1000 assistants:
- DynamoDB query: $0.125 per million requests
- Cost: $0.000125 per 1000 lists
- Only pay for actual requests

Create assistant:
- DynamoDB write: $0.625 per million writes
- Cost: $0.000625 per 1000 creates
- Appears immediately in list (<100ms)

OpenSearch:
- Only used when user sends RAG message
- Usage-based cost (per query)
- Zero cost when idle
```

### Monthly Cost Example

**Scenario**: 100 users, each:
- Lists assistants 10 times/day
- Creates 2 assistants/day
- Sends 5 RAG messages/day

**Current (temp-bedrock-chat)**:
```
OpenSearch base: $175/month (0.5 OCU × 24h × 30d × $0.24)
Total: ~$175/month minimum
```

**New (Assistant API)**:
```
DynamoDB reads:  100 users × 10 lists × 30 days = 30,000 reads
                 = 30,000 × ($0.125/million) = $0.00375

DynamoDB writes: 100 users × 2 creates × 30 days = 6,000 writes
                 = 6,000 × ($0.625/million) = $0.00375

OpenSearch:      100 users × 5 RAG × 30 days = 15,000 queries
                 = Minimal cost (queries only, no base OCU)

Total: ~$0.0075/month for CRUD + minimal OpenSearch query costs
Savings: 99.996% cost reduction for listing operations
```

## Implementation Impact

### What Changes

1. **List endpoint** (`GET /api/assistant`):
   ```typescript
   // ❌ OLD: Query OpenSearch (expensive, delayed)
   const results = await opensearch.search({ index: 'bots' });

   // ✅ NEW: Query DynamoDB (cheap, immediate)
   const results = await dynamodb.query({
     TableName: 'assistants',
     KeyConditionExpression: 'userId = :userId'
   });
   ```

2. **Create endpoint** (`POST /api/assistant`):
   ```typescript
   // ✅ Write to DynamoDB (immediate)
   await dynamodb.putItem({ TableName: 'assistants', Item: assistant });

   // ✅ Async index to OpenSearch (for vector search only)
   // Triggered by DynamoDB Stream, doesn't block API response
   ```

3. **Message endpoint** (`POST /api/assistant/{id}/messages`):
   ```typescript
   // ✅ THIS is where OpenSearch is used
   const context = await opensearch.vectorSearch({
     query: userMessage,
     k: 5
   });
   const response = await llm.generate(context + userMessage);
   ```

### What Doesn't Change

- RAG functionality remains the same
- Vector search quality unchanged
- Frontend experience equivalent or better
- All existing features preserved

## Architecture Principles

### 1. Right Tool for the Job

```
Question: "What assistants do I have?"
Answer: Simple list query
Tool: DynamoDB (optimized for this)
Cost: $0.000125 per query

Question: "Find documents similar to this concept"
Answer: Vector similarity search
Tool: OpenSearch (optimized for this)
Cost: Usage-based per query
```

### 2. Cost Optimization

- Don't pay for expensive infrastructure for simple operations
- Only use OpenSearch when vector search is actually needed
- DynamoDB pricing model better fits CRUD usage patterns

### 3. Performance

- DynamoDB: Single-digit millisecond reads
- Strong consistency for list operations
- No 60-second refresh delay

### 4. Simplicity

- Clear separation of concerns
- Easier to understand and maintain
- Follows existing `/api/chat` patterns

## Migration Strategy

### Phase 1: Deploy New API
- New endpoints use DynamoDB for listing
- OpenSearch only for RAG
- Old endpoints still available

### Phase 2: Frontend Update
- Update frontend to use new endpoints
- Test listing performance
- Verify immediate reflection

### Phase 3: Cost Validation
- Monitor DynamoDB costs
- Monitor OpenSearch query costs
- Confirm 10-100x cost reduction

### Phase 4: Cleanup
- Remove old bedrock-chat endpoints
- Archive temp-bedrock-chat code
- Document savings

## Key Takeaways

1. **OpenSearch is NOT a database**: It's a search engine optimized for vector/text search
2. **DynamoDB is excellent for CRUD**: Fast, cheap, consistent for transactional operations
3. **Use the right tool**: Don't use a search engine for listing, don't use a database for vector search
4. **Cost matters**: 99.996% cost reduction by using appropriate storage for each operation
5. **Performance matters**: Immediate consistency vs 60-second delays

## References

- AWS Pricing: DynamoDB charges $0.125 per million reads (strongly consistent), $0.625 per million writes
- AWS Pricing: OpenSearch Serverless minimum 0.5 OCU at $0.24/hour ($175.20/month for 1 OCU)
- Current implementation: `packages/cdk/lib/temp-bedrock-chat/`
- Proposed implementation: Tasks in `tasks.md`
- Pricing sources: https://aws.amazon.com/dynamodb/pricing/on-demand/, https://aws.amazon.com/opensearch-service/pricing/
