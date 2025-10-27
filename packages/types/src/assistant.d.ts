export type Assistant = {
  id: string; // userId - partition key
  createdDate: string; // sort key
  assistantId: string;
  userId: string; // Duplicate for clarity, same as id
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
  syncStatus: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED';
  syncStatusReason: string;
  s3Urls: string[];
  updatedDate: string;
};

export type AssistantMessage = {
  id: string; // assistantId - partition key
  createdDate: string; // Derived from messageId timestamp
  messageId: string; // sort key: timestamp#uuid
  assistantId: string; // Duplicate for clarity, same as id
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AssistantMessageSource[];
  metadata?: {
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
};

export type AssistantMessageSource = {
  content: string;
  contentType: string;
  excerpt: string;
  s3Url: string;
};

export type CreateAssistantRequest = {
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
  s3Urls?: string[];
};

export type UpdateAssistantRequest = {
  name?: string;
  description?: string;
  instruction?: string;
  modelId?: string;
  ragEnabled?: boolean;
  s3Urls?: string[];
};

export type CreateAssistantMessageRequest = {
  content: string;
};

export type ListAssistantsResponse = {
  assistants: Assistant[];
  lastEvaluatedKey?: string;
};

export type ListAssistantMessagesResponse = {
  messages: AssistantMessage[];
  lastEvaluatedKey?: string;
};
