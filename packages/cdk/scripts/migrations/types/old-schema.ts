/**
 * Type definitions for the old Python-based bedrock-chat schema
 * These types represent the DynamoDB structure from the legacy system
 */

export type OldBotKnowledge = {
  source_urls?: string[];
  sitemap_urls?: string[];
  filenames?: string[];
  s3_urls?: string[];
};

export type OldGenerationParams = {
  max_tokens?: number;
  top_k?: number;
  top_p?: number;
  temperature?: number;
  stop_sequences?: string[];
};

export type OldAgentTool = {
  name: string;
  description?: string;
  [key: string]: any;
};

export type OldAgentData = {
  tools?: OldAgentTool[];
  [key: string]: any;
};

export type OldBedrockKnowledgeBase = {
  knowledge_base_id?: string;
  [key: string]: any;
};

export type OldGuardrailsParams = {
  guardrail_id?: string;
  guardrail_version?: string;
  [key: string]: any;
};

export type OldConversationQuickStarter = {
  title: string;
  example: string;
};

export type OldActiveModels = {
  [modelName: string]: boolean;
};

export type OldUsageStats = {
  total_conversations?: number;
  total_messages?: number;
  [key: string]: any;
};

export type OldBot = {
  PK: string; // owner_user_id
  SK: string; // "{bot_id}#bot"
  ItemType: string; // "{owner_user_id}#bot"
  BotId: string;
  Title: string;
  Description: string;
  Instruction: string;
  CreateTime: number; // decimal timestamp
  LastUsedTime?: number; // decimal timestamp
  SharedStatus: string;
  SharedScope?: string; // sparse index
  AllowedCognitoGroups?: string[];
  AllowedCognitoUsers?: string[];
  GenerationParams?: OldGenerationParams;
  AgentData?: OldAgentData;
  Knowledge?: OldBotKnowledge;
  PromptCachingEnabled?: boolean;
  SyncStatus: string; // "QUEUED" | "SYNCING" | "SUCCEEDED" | "FAILED" | "PARTIAL"
  SyncStatusReason?: string;
  LastExecId?: string;
  DisplayRetrievedChunks?: boolean;
  ConversationQuickStarters?: OldConversationQuickStarter[];
  ActiveModels?: OldActiveModels;
  UsageStats?: OldUsageStats;
  IsStarred?: 'TRUE'; // sparse index
  BedrockKnowledgeBase?: OldBedrockKnowledgeBase;
  GuardrailsParams?: OldGuardrailsParams;
};

export type OldMessageContentText = {
  content_type: 'text';
  body: string;
  media_type?: never;
};

export type OldMessageContentImage = {
  content_type: 'image';
  media_type: string;
  body: string; // base64 encoded
};

export type OldMessageContentAttachment = {
  content_type: 'attachment';
  body: string;
  file_name?: string;
  file_type?: string;
};

export type OldMessageContentToolUse = {
  content_type: 'tool_use';
  tool_use_id: string;
  name: string;
  input: any;
};

export type OldMessageContentToolResult = {
  content_type: 'tool_result';
  tool_use_id: string;
  content: string | any[];
  status?: string;
};

export type OldMessageContent =
  | OldMessageContentText
  | OldMessageContentImage
  | OldMessageContentAttachment
  | OldMessageContentToolUse
  | OldMessageContentToolResult;

export type OldMessageFeedback = {
  thumbs_up: boolean;
  category?: string;
  comment?: string;
};

export type OldUsedChunk = {
  content_type: string;
  content: string;
  source?: string;
  rank?: number;
  [key: string]: any;
};

export type OldMessage = {
  role: 'user' | 'assistant';
  content: OldMessageContent[];
  model?: string;
  children: string[];
  parent: string | null;
  create_time: number; // float timestamp
  feedback?: OldMessageFeedback | null;
  used_chunks?: OldUsedChunk[] | null;
};

export type OldMessageMap = {
  [messageId: string]: OldMessage;
};

export type OldConversation = {
  PK: string; // user_id
  SK: string; // "{user_id}#CONV#{conversation_id}"
  Title: string;
  CreateTime: number; // decimal timestamp
  TotalPrice?: number;
  LastMessageId: string;
  ShouldContinue?: boolean;
  BotId?: string; // Links to bot
  // Either inline MessageMap or S3 reference
  MessageMap?: string; // JSON string
  IsLargeMessage?: boolean;
  LargeMessagePath?: string; // "s3://bucket/path"
};

/**
 * Parsed MessageMap from either inline JSON or S3
 */
export type ParsedMessageMap = OldMessageMap;

/**
 * Helper type for S3 location
 */
export type S3Location = {
  bucket: string;
  key: string;
};
