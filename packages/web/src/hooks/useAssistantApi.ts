import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';
import { useCallback } from 'react';
import type {
  Assistant,
  AssistantMessage,
  CreateAssistantRequest,
  UpdateAssistantRequest,
  CreateAssistantMessageRequest,
  ListAssistantsResponse,
  ListAssistantMessagesResponse,
} from 'generative-ai-use-cases';

const assistantApi = axios.create({
  baseURL: import.meta.env.VITE_APP_API_ENDPOINT
    ? `${import.meta.env.VITE_APP_API_ENDPOINT}assistant`
    : '/api/assistant',
});

// Request interceptor to add authentication
assistantApi.interceptors.request.use(async (config) => {
  const token = (await fetchAuthSession()).tokens?.idToken?.toString();
  if (token) {
    config.headers['Authorization'] = token;
  }
  config.headers['Content-Type'] = 'application/json';
  return config;
});

const useAssistantApi = () => {
  const listAssistants = useCallback(
    async (params?: { limit?: number; lastEvaluatedKey?: string }) => {
      try {
        const response = await assistantApi.get<ListAssistantsResponse>('/', {
          params,
        });
        return response.data;
      } catch (error) {
        console.error('Assistant list failed:', error);
        throw error;
      }
    },
    []
  );

  const getAssistant = useCallback(async (assistantId: string) => {
    try {
      const response = await assistantApi.get<Assistant>(`/${assistantId}`);
      return response.data;
    } catch (error) {
      console.error('Assistant get failed:', error);
      throw error;
    }
  }, []);

  const createAssistant = useCallback(
    async (request: CreateAssistantRequest) => {
      try {
        const response = await assistantApi.post<Assistant>('/', request);
        return response.data;
      } catch (error) {
        console.error('Assistant creation failed:', error);
        throw error;
      }
    },
    []
  );

  const updateAssistant = useCallback(
    async (assistantId: string, request: UpdateAssistantRequest) => {
      try {
        const response = await assistantApi.put<Assistant>(
          `/${assistantId}`,
          request
        );
        return response.data;
      } catch (error) {
        console.error('Assistant update failed:', error);
        throw error;
      }
    },
    []
  );

  const deleteAssistant = useCallback(async (assistantId: string) => {
    try {
      await assistantApi.delete(`/${assistantId}`);
    } catch (error) {
      console.error('Assistant deletion failed:', error);
      throw error;
    }
  }, []);

  const listMessages = useCallback(
    async (
      assistantId: string,
      params?: { limit?: number; lastEvaluatedKey?: string }
    ) => {
      try {
        const response = await assistantApi.get<ListAssistantMessagesResponse>(
          `/${assistantId}/messages`,
          { params }
        );
        return response.data;
      } catch (error) {
        console.error('Assistant messages list failed:', error);
        throw error;
      }
    },
    []
  );

  const createMessage = useCallback(
    async (assistantId: string, request: CreateAssistantMessageRequest) => {
      try {
        const response = await assistantApi.post<AssistantMessage>(
          `/${assistantId}/messages`,
          request
        );
        return response.data;
      } catch (error) {
        console.error('Assistant message creation failed:', error);
        throw error;
      }
    },
    []
  );

  return {
    listAssistants,
    getAssistant,
    createAssistant,
    updateAssistant,
    deleteAssistant,
    listMessages,
    createMessage,
  };
};

export default useAssistantApi;
