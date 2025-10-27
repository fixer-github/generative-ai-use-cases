import { ModelConfiguration } from 'generative-ai-use-cases';
import useHttp from './useHttp';

export interface ModelsResponse {
  modelRegion: string;
  modelIds: ModelConfiguration[];
  imageModelIds: ModelConfiguration[];
  videoModelIds: ModelConfiguration[];
  speechToSpeechModelIds: ModelConfiguration[];
  endpointNames: string[];
  agentNames: string[];
  flows: any[];
}

const useModelsApi = () => {
  const http = useHttp();

  return {
    getModels: () => {
      return http.get<ModelsResponse>('models');
    },
  };
};

export default useModelsApi;
