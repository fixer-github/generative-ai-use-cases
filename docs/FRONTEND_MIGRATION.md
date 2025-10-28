# Frontend Migration Guide: BedrockChat to Assistant API

## Overview

The old BedrockChat API has been removed and replaced with the new Assistant API. The frontend currently uses the old API through `useBedrockChatApi` hook, but needs to be migrated to use the new `useAssistantApi` hook.

## Status

- ✅ Backend: Old `temp-bedrock-chat` infrastructure removed
- ✅ Backend: New Assistant API implemented
- ✅ Hook: New `useAssistantApi` hook created
- ❌ Frontend: Pages still use old `useBedrockChatApi` hook

## Key Differences

### API Simplification

The new Assistant API is significantly simpler than the old BedrockChat API:

| Feature | BedrockChat API | Assistant API | Status |
|---------|----------------|---------------|---------|
| List assistants/bots | ✅ | ✅ | Equivalent |
| Create assistant/bot | ✅ | ✅ | Simplified |
| Get assistant/bot | ✅ | ✅ | Equivalent |
| Update assistant/bot | ✅ | ✅ | Simplified |
| Delete assistant/bot | ✅ | ✅ | Equivalent |
| Send message | ✅ | ✅ | Simplified |
| List messages | ✅ | ✅ | Equivalent |
| **Bot store** | ✅ | ❌ | **Removed** |
| **Search store** | ✅ | ❌ | **Removed** |
| **Popular bots** | ✅ | ❌ | **Removed** |
| **Starred status** | ✅ | ❌ | **Removed** |
| **Visibility settings** | ✅ | ❌ | **Removed** |
| **Complex KB config** | ✅ | ❌ | **Simplified** |
| **Conversation search** | ✅ | ❌ | **Removed** |
| **File upload** | ✅ | ❌ | **Use S3 directly** |

### Data Model Changes

**Old BedrockChatBot:**
```typescript
interface BedrockChatBot {
  id: string;
  title: string;
  description?: string;
  instruction: string;
  createTime: number;
  lastUsedTime: number;
  owned?: boolean;
  available?: boolean;
  sharedStatus?: string;
  sharedScope: 'private' | 'partial' | 'all';
  isStarred?: boolean;
  syncStatus: string;
  displayRetrievedChunks?: boolean;
  conversationQuickStarters?: Array<{...}>;
  generationParams?: {...};
  knowledge?: {...};
  promptCachingEnabled?: boolean;
}
```

**New Assistant:**
```typescript
interface Assistant {
  assistantId: string;
  userId: string;
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
  syncStatus: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED';
  syncStatusReason: string;
  s3Urls: string[];
  createdDate: string;
  updatedDate: string;
}
```

## Migration Steps

### Phase 1: Update Affected Pages

The following pages need to be updated to use the new Assistant API:

1. **RagChatBotPage.tsx** - Main listing page
   - Replace `getAllBots()` with `listAssistants()`
   - Update bot card rendering to use Assistant model
   - Remove store/search/starred features

2. **RagChatBotEditPage.tsx** - Bot creation/editing page
   - Replace `createBot()` with `createAssistant()`
   - Replace `updateBot()` with `updateAssistant()`
   - Simplify form to match Assistant fields
   - Remove complex KB configuration UI
   - Remove visibility/sharing UI

3. **RagChatBotChatPage.tsx** - Chat interface
   - Replace `sendMessage()` with `createMessage()`
   - Replace conversation API with `listMessages()`
   - Update message rendering

4. **RagChatBotHistoryPage.tsx** - Chat history
   - Replace `getConversations()` with `listMessages()`
   - Update history display

### Phase 2: Remove Old Features

Features that need to be removed or redesigned:

1. **Bot Store** - Remove store search UI
2. **Starred/Favorites** - Remove starring functionality
3. **Visibility Settings** - Remove public/private/shared controls
4. **Complex Knowledge Base** - Simplify to S3 URLs only
5. **Conversation Quick Starters** - Remove or simplify
6. **File Upload** - Use direct S3 upload with presigned URLs

### Phase 3: Simplify Configuration

The new Assistant API has simpler configuration:

**Remove:**
- Active models selection
- Agent tools configuration
- Bedrock Knowledge Base settings
- Guardrails configuration
- Generation parameters (handled at message level)

**Keep:**
- Name, description, instruction
- Model selection (single model)
- RAG enable/disable
- S3 URLs for knowledge

### Phase 4: Update Types

Replace all `BedrockChatBot` type references with `Assistant` type from `types` package.

### Phase 5: Testing

1. Create new assistant
2. Upload knowledge documents
3. Send messages and verify RAG responses
4. List messages and verify history
5. Update assistant configuration
6. Delete assistant

## Implementation Example

### Before (useBedrockChatApi):
```typescript
import useBedrockChatApi, { BedrockChatBot } from '../hooks/useBedrockChatApi';

const { getAllBots, createBot, deleteBot } = useBedrockChatApi();

// List bots
const bots = await getAllBots({ kind: 'private' });

// Create bot
const bot = await createBot({
  title: 'My Bot',
  description: 'Description',
  instruction: 'System prompt',
  knowledge: { sourceUrls: ['https://example.com'] },
  // ... many more fields
});
```

### After (useAssistantApi):
```typescript
import useAssistantApi from '../hooks/useAssistantApi';
import type { Assistant } from 'types';

const { listAssistants, createAssistant, deleteAssistant } = useAssistantApi();

// List assistants
const { assistants } = await listAssistants();

// Create assistant
const assistant = await createAssistant({
  name: 'My Assistant',
  description: 'Description',
  instruction: 'System prompt',
  modelId: 'anthropic.claude-v4-sonnet',
  ragEnabled: true,
  s3Urls: ['s3://bucket/key'],
});
```

## Breaking Changes

Users will need to:

1. Recreate their bots as assistants (no automatic migration)
2. Re-upload knowledge documents if needed
3. Lose access to store/shared bots
4. Lose conversation history from old system

## Recommendations

1. **Start Fresh**: Don't try to map old features 1:1, embrace the simpler model
2. **Deprecation Period**: Keep old pages with deprecation notice, add new Assistant pages
3. **Migration Tool**: Consider building a migration tool to help users transfer bots
4. **Documentation**: Update user-facing docs to explain new workflow

## Files to Update

```
packages/web/src/
├── hooks/
│   ├── useBedrockChatApi.ts       [REMOVE after migration]
│   └── useAssistantApi.ts         [✅ CREATED]
├── pages/
│   ├── RagChatBotPage.tsx         [UPDATE]
│   ├── RagChatBotEditPage.tsx     [UPDATE]
│   ├── RagChatBotChatPage.tsx     [UPDATE]
│   └── RagChatBotHistoryPage.tsx  [UPDATE]
└── components/
    └── [Update any components using BedrockChatBot types]
```

## Next Steps

1. Create new simplified Assistant pages
2. Update routing to use new pages
3. Add migration notice to old pages
4. Test thoroughly
5. Deploy with feature flag
6. Monitor adoption
7. Remove old pages after transition period
