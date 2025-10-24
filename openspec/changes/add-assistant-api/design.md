# Assistant API Design

## Context

The existing RAG chat bot in `temp-bedrock-chat` uses a Python-based backend with per-bot CloudFormation stacks and OpenSearch ingestion pipelines. This creates operational complexity and doesn't align with the TypeScript patterns used elsewhere in the codebase. The new Assistant API aims to recreate this functionality with better architecture and developer experience.

## Goals / Non-Goals

### Goals
- Implement RAG chat bot functionality with TypeScript Lambda functions
- Follow existing `/api/chat` patterns for consistency
- Provide immediate list updates after assistant creation
- Eliminate per-bot CloudFormation stack creation
- Use LangChain for cleaner OpenSearch integration
- Maintain feature parity with existing RAG bot

### Non-Goals
- Migrate existing bot data automatically (manual migration acceptable)
- Redesign frontend UI (reuse existing temporarily)
- Change botstore infrastructure (reuse temporarily, may change later)
- Add new features beyond existing RAG functionality

## Decisions

### 1. Storage Architecture

**Decision**: Use DynamoDB as primary data store for ALL CRUD/list operations + OpenSearch Serverless ONLY for vector search/RAG

**Rationale**:
- **DynamoDB for all listing/CRUD**: Fast (<100ms), cheap, immediate consistency
- **OpenSearch ONLY for RAG**: Vector similarity search when user sends messages
- **Clear separation**: DynamoDB = source of truth, OpenSearch = search index
- **Cost optimization**: Avoid expensive OpenSearch operations for simple queries
- **Immediate reflection**: DynamoDB queries return results instantly after creation

**Storage Responsibilities**:

| Operation | Storage | Why |
|-----------|---------|-----|
| Create assistant | DynamoDB | Fast write, immediate consistency |
| List assistants | DynamoDB | Cheap, no 60s delay, immediate |
| Get assistant | DynamoDB | Fast read, single-digit ms |
| Update assistant | DynamoDB | Strong consistency |
| Delete assistant | DynamoDB | Transactional |
| Vector search (RAG) | OpenSearch | Semantic search, k-NN |
| Document retrieval | OpenSearch | RAG context |

**Cost Comparison** (Current vs Proposed):

```
Current (temp-bedrock-chat):
- List bots: OpenSearch query = expensive OCU usage
- Create bot: OpenSearch index + 60s wait
- Cost: ~$0.24/hour minimum (0.5 OCU × 2)

Proposed (Assistant API):
- List assistants: DynamoDB query = $0.25 per million reads
- Create assistant: DynamoDB write = $1.25 per million writes
- OpenSearch: Only used for RAG queries (usage-based)
- Cost: ~10-100x cheaper for listing operations
```

**Alternatives Considered**:
- **Use OpenSearch for listing**: ❌ Expensive, 60s delay, overkill
- **Pure DynamoDB**: ❌ Cannot do vector search for RAG
- **RDB (Aurora/RDS)**: ❌ Adds complexity; existing patterns use DynamoDB
- **Pure OpenSearch**: ❌ Not optimal for transactional CRUD operations

### 2. API Pattern

**Decision**: Direct Lambda integration at `/api/assistant/*` endpoints, following `/api/chat` pattern

**Endpoints**:
- `POST /api/assistant` - Create assistant
- `GET /api/assistant` - List assistants
- `GET /api/assistant/{assistantId}` - Get assistant details
- `PUT /api/assistant/{assistantId}` - Update assistant
- `DELETE /api/assistant/{assistantId}` - Delete assistant
- `POST /api/assistant/{assistantId}/messages` - Create message (RAG chat)
- `GET /api/assistant/{assistantId}/messages` - List messages

**Rationale**:
- Consistent with existing `/api/chat` endpoints
- Direct Lambda integration is simpler than proxy pattern
- RESTful design is familiar and well-understood

**Alternatives Considered**:
- **Keep `/api/bedrock-chat` proxy**: Too complex, adds unnecessary indirection
- **WebSocket-based**: Would require different frontend integration, more complex

### 3. Implementation Language

**Decision**: TypeScript for all Lambda functions

**Rationale**:
- Consistency with existing `/api/chat` Lambda functions
- Better type safety and IDE support
- Easier maintenance with monorepo tooling
- User requirement: "use ts everywhere"

### 4. OpenSearch Integration

**Decision**: Use LangChain's OpenSearch integration packages

**Rationale**:
- Cleaner abstraction over raw OpenSearch API
- Built-in support for vector stores and retrievers
- Well-maintained and widely adopted
- Simplifies RAG implementation

**Packages**:
- `@langchain/community` - OpenSearch vector store
- `@langchain/core` - Core abstractions
- Existing AWS SDK for OpenSearch Serverless authentication

### 5. List Reflection Strategy

**Decision**: Implement optimistic updates with eventual consistency

**Approach**:
1. Write to DynamoDB immediately (fast, sub-100ms)
2. Return success to client with new assistant data
3. Asynchronously sync to OpenSearch via DynamoDB Streams
4. List operations read from DynamoDB by default
5. Search operations use OpenSearch

**Rationale**:
- Provides immediate feedback to users
- Decouples write path from search indexing
- DynamoDB provides strong consistency for reads after writes
- OpenSearch eventual consistency is acceptable for search

### 6. Infrastructure Reuse

**Decision**: Reuse existing botstore (OpenSearch collection) temporarily

**Rationale**:
- Avoids duplicate OpenSearch costs during transition
- Faster initial implementation
- Can be changed later without API changes
- User requirement: "reuse infra resources such as botstore (temporary)"

**Future Consideration**: May create separate OpenSearch collection or move to different storage

### 7. CloudFormation Stack Strategy

**Decision**: Single stack for all assistants, no per-assistant stacks

**Rationale**:
- Eliminates stack proliferation problem
- Faster assistant creation (no CFN deployment wait)
- Simpler infrastructure management
- Data-driven approach: assistants are data, not infrastructure

## Risks / Trade-offs

### Risk: OpenSearch Eventual Consistency
- **Impact**: Search results may not immediately include new assistants
- **Mitigation**: Use DynamoDB for list operations, OpenSearch only for search queries
- **Severity**: Low (acceptable for search use case)

### Risk: LangChain Dependency
- **Impact**: Adds external dependency that may have breaking changes
- **Mitigation**: Pin versions, abstract behind internal interfaces
- **Severity**: Low (LangChain is stable and widely used)

### Risk: Botstore Sharing
- **Impact**: Temporary sharing of OpenSearch collection may cause conflicts
- **Mitigation**: Use distinct index names, plan for future separation
- **Severity**: Low (temporary solution with clear migration path)

### Trade-off: No Automatic Data Migration
- **Decision**: Manual migration required for existing bots
- **Rationale**: Clean break allows for better data model
- **Impact**: Users must recreate or manually migrate existing bots

## Migration Plan

### Phase 1: Deploy New API (Week 1-2)
1. Implement DynamoDB tables
2. Implement TypeScript Lambda functions
3. Deploy `/api/assistant` endpoints
4. Keep old `/api/bedrock-chat` running

### Phase 2: Frontend Integration (Week 2-3)
1. Update frontend to use new endpoints
2. Test thoroughly with new API
3. Provide data migration script (optional)

### Phase 3: Cleanup (Week 3-4)
1. Remove old `/api/bedrock-chat` endpoints
2. Archive `temp-bedrock-chat` code
3. Document changes

### Rollback Plan
- Keep old endpoints active during transition
- Feature flag to switch between old/new API
- Can revert frontend to old endpoints if critical issues

## Open Questions

1. **Data Migration**: Should we provide automated migration tool or manual process?
   - **Recommendation**: Manual for v1, automated if needed based on feedback

2. **OpenSearch Collection**: When should we separate from shared botstore?
   - **Recommendation**: After deployment stabilizes, evaluate based on usage patterns

3. **WebSocket Support**: Should we support streaming responses like voice chat?
   - **Recommendation**: Not in initial version, add if requested

4. **Rate Limiting**: Do we need per-assistant or per-user rate limits?
   - **Recommendation**: Reuse existing API Gateway rate limiting initially
