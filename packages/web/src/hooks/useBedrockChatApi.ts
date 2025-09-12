import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';
import { useCallback } from 'react';

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
  create_time: number;
  last_used_time: number;
  owner_user_id: string;
  shared_scope: 'private' | 'partial' | 'all';
  is_starred?: boolean;
  sync_status?: string;
  display_retrieved_chunks?: boolean;
  conversation_quick_starters?: Array<{
    title: string;
    example: string;
  }>;
  generation_params?: {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
  knowledge?: {
    source_urls: string[];
    sitemap_urls: string[];
    filenames: string[];
    s3_urls: string[];
  };
  prompt_caching_enabled?: boolean;
}

export interface BedrockChatBotInput {
  title: string;
  description?: string;
  instruction: string;
  generation_params?: {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
  knowledge?: {
    source_urls: string[];
    sitemap_urls: string[];
    filenames: string[];
    s3_urls: string[];
  };
  display_retrieved_chunks?: boolean;
  prompt_caching_enabled?: boolean;
  conversation_quick_starters?: Array<{
    title: string;
    example: string;
  }>;
}

export interface BedrockChatBotSummary {
  id: string;
  title: string;
  description?: string;
  available: boolean;
  has_bedrock_knowledge_base: boolean;
  has_knowledge: boolean;
}

export interface BedrockChatPresignedUrlResponse {
  url: string;
}

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

  const createConversation = async (title?: string) => {
    try {
      const response = await bedrockChatApi.post('/conversation', {
        title: title || 'Test Conversation',
      });
      return response.data;
    } catch (error) {
      console.error('BedrockChat conversation creation failed:', error);
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
        id: `bot-${Date.now()}`,
        active_models: {
          claude_3_5_sonnet_v2: true,
          claude_3_5_haiku: false,
          claude_3_opus: false,
        },
      };
      const response = await bedrockChatApi.post<BedrockChatBot>('/bot', botData);
      return response.data;
    } catch (error) {
      console.error('BedrockChat create bot failed:', error);
      throw error;
    }
  };

  const updateBot = async (botId: string, bot: Partial<BedrockChatBotInput>) => {
    try {
      const response = await bedrockChatApi.patch(`/bot/${botId}`, bot);
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
    botId?: string
  ) => {
    try {
      const response = await bedrockChatApi.post('/conversation', {
        conversation_id: conversationId,
        message: {
          role: 'user',
          content: message,
        },
        bot_id: botId,
        stream: false,
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
    createConversation,
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