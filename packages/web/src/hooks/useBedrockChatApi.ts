import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';

const bedrockChatApi = axios.create({
  baseURL: import.meta.env.VITE_APP_API_ENDPOINT
    ? `${import.meta.env.VITE_APP_API_ENDPOINT}/bedrock-chat`
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

  return {
    testConnection,
    getConfig,
    getConversations,
    createConversation,
    deleteConversation,
    searchConversations,
    searchStore,
    getPopularBots,
  };
};

export default useBedrockChatApi;