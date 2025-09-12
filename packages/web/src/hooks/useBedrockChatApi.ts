import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

const bedrockChatApi = axios.create({
  baseURL: import.meta.env.VITE_APP_API_ENDPOINT
    ? `${import.meta.env.VITE_APP_API_ENDPOINT}bedrock-chat`
    : '/api/bedrock-chat',
});

// Request interceptor to add authentication
bedrockChatApi.interceptors.request.use(async (config) => {
  const token = (await fetchAuthSession()).tokens?.idToken?.toString();
  if (token) {
    config.headers['Authorization'] = token;
  }
  config.headers['Content-Type'] = 'application/json';
  return config;
});

export interface BedrockChatConversation {
  id: string;
  title?: string;
  createdAt?: string;
}

export interface BedrockChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp?: string;
}

export interface BedrockChatHealthResponse {
  status: string;
  message?: string;
}

export interface BedrockChatConfigResponse {
  models?: string[];
  features?: Record<string, boolean>;
}

export interface BedrockChatBot {
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
  conversationQuickStarters?: Array<{
    title: string;
    example: string;
  }>;
  generationParams?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
  };
  knowledge?: {
    sourceUrls: string[];
    sitemapUrls: string[];
    filenames: string[];
    s3Urls: string[];
  };
  promptCachingEnabled?: boolean;
}

export interface BedrockChatBotInput {
  id?: string;
  title: string;
  description?: string;
  instruction: string;
  generationParams?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
  };
  knowledge?: {
    sourceUrls: string[];
    sitemapUrls: string[];
    filenames: string[];
    s3Urls: string[];
  };
  displayRetrievedChunks?: boolean;
  promptCachingEnabled?: boolean;
  conversationQuickStarters?: Array<{
    title: string;
    example: string;
  }>;
}

export interface BedrockChatBotSummary {
  id: string;
  title: string;
  description?: string;
  available: boolean;
  hasBedrockKnowledgeBase: boolean;
  hasKnowledge: boolean;
}

export interface BedrockChatPresignedUrlResponse {
  url: string;
}

// Helper function to convert snake_case to camelCase
const toCamelCase = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (typeof obj !== 'object') return obj;
  
  const converted: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      converted[camelKey] = toCamelCase(obj[key]);
    }
  }
  return converted;
};

const useBedrockChatApi = () => {
  const testConnection = async () => {
    try {
      const response = await bedrockChatApi.get<BedrockChatHealthResponse>('/health');
      return response.data;
    } catch (error) {
      console.error('BedrockChat health check failed:', error);
      throw error;
    }
  };

  const getConfig = async () => {
    try {
      const response = await bedrockChatApi.get<BedrockChatConfigResponse>('/config/global');
      return response.data;
    } catch (error) {
      console.error('BedrockChat config fetch failed:', error);
      throw error;
    }
  };

  const getConversations = async () => {
    try {
      const response = await bedrockChatApi.get<BedrockChatConversation[]>('/conversations');
      return response.data;
    } catch (error) {
      console.error('BedrockChat conversations fetch failed:', error);
      throw error;
    }
  };


  const deleteConversation = async (conversationId: string) => {
    try {
      const response = await bedrockChatApi.delete(`/conversation/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error('BedrockChat conversation deletion failed:', error);
      throw error;
    }
  };

  const searchConversations = async (query: string) => {
    try {
      const response = await bedrockChatApi.get('/conversations/search', {
        params: { query },
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat conversation search failed:', error);
      throw error;
    }
  };

  // Test basic store endpoints
  const searchStore = async (query?: string) => {
    try {
      const response = await bedrockChatApi.get('/store/search', {
        params: query ? { query } : {},
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat store search failed:', error);
      throw error;
    }
  };

  const getPopularBots = async () => {
    try {
      const response = await bedrockChatApi.get('/store/popular');
      return response.data;
    } catch (error) {
      console.error('BedrockChat popular bots fetch failed:', error);
      throw error;
    }
  };

  // Bot management endpoints
  const getAllBots = useCallback(async (params?: {
    kind?: 'private' | 'mixed';
    starred?: boolean;
    limit?: number;
  }) => {
    try {
      const response = await bedrockChatApi.get<BedrockChatBot[]>('/bot', {
        params,
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat get all bots failed:', error);
      throw error;
    }
  }, []);

  const getPrivateBot = async (botId: string) => {
    try {
      const response = await bedrockChatApi.get<BedrockChatBot>(
        `/bot/private/${botId}`
      );
      return response.data;
    } catch (error) {
      console.error('BedrockChat get private bot failed:', error);
      throw error;
    }
  };

  const getBotSummary = async (botId: string) => {
    try {
      const response = await bedrockChatApi.get<BedrockChatBotSummary>(
        `/bot/summary/${botId}`
      );
      return response.data;
    } catch (error) {
      console.error('BedrockChat get bot summary failed:', error);
      throw error;
    }
  };

  const createBot = async (bot: BedrockChatBotInput) => {
    try {
      const botData = {
        ...bot,
        id: bot.id || uuidv4(),
        active_models: {
          claude_v4_opus: true,
          claude_v4_1_opus: true,
          claude_v4_sonnet: true,
          claude_v3_5_sonnet: true,
          claude_v3_5_sonnet_v2: true,
          claude_v3_7_sonnet: true,
          claude_v3_5_haiku: true,
          claude_v3_haiku: true,
          claude_v3_opus: true,
          mistral_7b_instruct: true,
          mixtral_8x7b_instruct: true,
          mistral_large: true,
          mistral_large_2: true,
          amazon_nova_pro: true,
          amazon_nova_lite: true,
          amazon_nova_micro: true,
          deepseek_r1: true,
          llama3_3_70b_instruct: true,
          llama3_2_1b_instruct: true,
          llama3_2_3b_instruct: true,
          llama3_2_11b_instruct: true,
          llama3_2_90b_instruct: true,
          gpt_oss_20b: true,
          gpt_oss_120b: true,
        },
        // Add missing required fields with default values
        agent: {
          tools: []
        },
        bedrockKnowledgeBase: {
          knowledgeBaseId: null,
          existKnowledgeBaseId: null,
          embeddingsModel: 'titan_v2',
          chunkingConfiguration: {
            chunkingStrategy: 'default'
          },
          openSearch: {
            analyzer: {
              characterFilters: ['icu_normalizer'],
              tokenizer: 'kuromoji_tokenizer',
              tokenFilters: [
                'kuromoji_baseform',
                'kuromoji_part_of_speech',
                'kuromoji_stemmer',
                'cjk_width',
                'ja_stop',
                'lowercase',
                'icu_folding'
              ]
            }
          },
          searchParams: {
            maxResults: 5,
            searchType: 'hybrid'
          },
          webCrawlingScope: 'DEFAULT',
          webCrawlingFilters: {
            includePatterns: [''],
            excludePatterns: ['']
          }
        },
        bedrockGuardrails: {
          isGuardrailEnabled: false,
          hateThreshold: 0,
          insultsThreshold: 0,
          sexualThreshold: 0,
          violenceThreshold: 0,
          misconductThreshold: 0,
          groundingThreshold: 0,
          relevanceThreshold: 0,
          guardrailArn: '',
          guardrailVersion: ''
        }
      };
      
      // Convert snake_case to camelCase
      const camelCaseData = toCamelCase(botData);
      // Add stopSequences if not present
      if (camelCaseData.generationParams && !camelCaseData.generationParams.stopSequences) {
        camelCaseData.generationParams.stopSequences = [''];
      }
      // Add reasoningParams if not present
      if (camelCaseData.generationParams && !camelCaseData.generationParams.reasoningParams) {
        camelCaseData.generationParams.reasoningParams = {
          budgetTokens: 1024
        };
      }
      
      const response = await bedrockChatApi.post<BedrockChatBot>('/bot', camelCaseData);
      return response.data;
    } catch (error) {
      console.error('BedrockChat create bot failed:', error);
      throw error;
    }
  };

  const updateBot = async (botId: string, bot: Partial<BedrockChatBotInput>) => {
    try {
      // Convert snake_case to camelCase
      const camelCaseData = toCamelCase(bot);
      const response = await bedrockChatApi.patch(`/bot/${botId}`, camelCaseData);
      return response.data;
    } catch (error) {
      console.error('BedrockChat update bot failed:', error);
      throw error;
    }
  };

  const deleteBot = useCallback(async (botId: string) => {
    try {
      const response = await bedrockChatApi.delete(`/bot/${botId}`);
      return response.data;
    } catch (error) {
      console.error('BedrockChat delete bot failed:', error);
      throw error;
    }
  }, []);

  const setStarredStatus = useCallback(async (botId: string, starred: boolean) => {
    try {
      const response = await bedrockChatApi.patch(`/bot/${botId}/starred`, {
        starred,
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat set starred status failed:', error);
      throw error;
    }
  }, []);

  const setBotVisibility = async (
    botId: string,
    visibility: 'private' | 'partial' | 'all'
  ) => {
    try {
      const response = await bedrockChatApi.patch(`/bot/${botId}/visibility`, {
        visibility,
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat set bot visibility failed:', error);
      throw error;
    }
  };

  const getBotPresignedUrl = async (
    botId: string,
    filename: string,
    contentType: string
  ) => {
    try {
      const response = await bedrockChatApi.get<BedrockChatPresignedUrlResponse>(
        `/bot/${botId}/presigned-url`,
        {
          params: { filename, contentType },
        }
      );
      return response.data;
    } catch (error) {
      console.error('BedrockChat get presigned url failed:', error);
      throw error;
    }
  };

  const deleteBotUploadedFile = async (botId: string, filename: string) => {
    try {
      const response = await bedrockChatApi.delete(
        `/bot/${botId}/uploaded-file`,
        {
          params: { filename },
        }
      );
      return response.data;
    } catch (error) {
      console.error('BedrockChat delete uploaded file failed:', error);
      throw error;
    }
  };

  const sendMessage = async (
    conversationId: string,
    message: string,
    botId?: string,
    model: string = 'claude-v4-sonnet'
  ) => {
    try {
      const response = await bedrockChatApi.post('/conversation', {
        conversation_id: conversationId,
        message: {
          role: 'user',
          content: [
            {
              content_type: 'text',
              body: message,
            },
          ],
          model: model,
          parent_message_id: null,
          message_id: null,
        },
        bot_id: botId,
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat send message failed:', error);
      throw error;
    }
  };

  const getConversation = async (conversationId: string) => {
    try {
      const response = await bedrockChatApi.get(
        `/conversation/${conversationId}`
      );
      return response.data;
    } catch (error) {
      console.error('BedrockChat get conversation failed:', error);
      throw error;
    }
  };

  return {
    testConnection,
    getConfig,
    getConversations,
    deleteConversation,
    searchConversations,
    searchStore,
    getPopularBots,
    getAllBots,
    getPrivateBot,
    getBotSummary,
    createBot,
    updateBot,
    deleteBot,
    setStarredStatus,
    setBotVisibility,
    getBotPresignedUrl,
    deleteBotUploadedFile,
    sendMessage,
    getConversation,
  };
};

export default useBedrockChatApi;