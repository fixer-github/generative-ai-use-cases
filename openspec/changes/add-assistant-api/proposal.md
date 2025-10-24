# Add Assistant API

## Why

The existing RAG chat bot implementation in `temp-bedrock-chat` has several architectural and operational issues that make it difficult to maintain and scale:

1. **Expensive listing operations**: Uses OpenSearch Serverless for listing bots, incurring continuous OCU costs (~$0.24/hour minimum) even for simple list queries
2. **Delayed list updates**: Collections don't reflect immediately after creation due to 60-second OpenSearch refresh interval
3. **Stack proliferation**: Each bot creation triggers a new CloudFormation stack deployment, causing management overhead
4. **Code complexity**: Python-based backend with complex infrastructure makes maintenance difficult
5. **Inconsistent patterns**: The proxy-based `/api/bedrock-chat` approach differs from other API patterns in the codebase
6. **Storage misuse**: OpenSearch used for both listing AND vector search, when it should only be used for vector search

This change recreates the RAG chat bot functionality as a new "Assistant API" feature with a cleaner TypeScript-based implementation that:
- **Uses DynamoDB for ALL listing/CRUD** (10-100x cheaper, immediate consistency)
- **Uses OpenSearch ONLY for vector search/RAG** (usage-based costs)
- Follows existing patterns from `/api/chat`
- Properly separates transactional data (DynamoDB) from search indexes (OpenSearch)

## What Changes

- **NEW**: Assistant API with TypeScript Lambda functions at `/api/assistant/*` endpoints
- **NEW**: DynamoDB tables for assistant conversations with proper indexing
- **NEW**: OpenSearch Serverless integration using LangChain for vector search capabilities
- **NEW**: Immediate list reflection through optimistic updates and proper data synchronization
- **REPLACE**: `/api/bedrock-chat` proxy endpoints with direct `/api/assistant` endpoints
- **REMOVE**: Per-bot CloudFormation stack creation pattern
- **IMPROVE**: Infrastructure reuses shared resources (botstore temporarily, may be modified in future)

The new implementation:
- Uses TypeScript throughout for consistency with `/api/chat` patterns
- Implements CRUD operations similar to existing chat API
- Integrates OpenSearch Serverless for search and vector operations via LangChain
- Provides immediate feedback on assistant creation
- Maintains same RAG functionality as the original implementation

## Impact

### Affected Code
- `packages/cdk/lib/construct/api/` - New assistant API construct
- `packages/cdk/lib/temp-bedrock-chat/` - Eventually deprecated/removed
- `packages/cdk/lambda/` - New TypeScript Lambda functions for assistant operations
- `packages/web/` - Frontend integration (temporary reuse, will change later)

### Affected Infrastructure
- New DynamoDB tables for assistant data
- Reuse existing botstore (OpenSearch Serverless) from temp-bedrock-chat
- New API Gateway routes under `/api/assistant`
- Remove per-bot CloudFormation stack creation logic

### Migration Path
- Deploy new assistant API alongside existing bedrock-chat
- Update frontend to use new endpoints
- Migrate existing bot data (if needed)
- Remove old bedrock-chat infrastructure

### Breaking Changes
- **BREAKING**: `/api/bedrock-chat/*` endpoints will be replaced with `/api/assistant/*`
- Frontend must be updated to use new API structure
- Existing bot data may need migration
