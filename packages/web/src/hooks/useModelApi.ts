import useHttp from './useHttp';

type GetAvailableModelsResponse = {
  models: string[];
};

const useModelApi = () => {
  const http = useHttp();

  return {
    getAvailableModels: (): string[] => {
      const response = http.get<GetAvailableModelsResponse>('models');
      const models = response.data?.models ?? [];

      return models;
    },
  };
};

export default useModelApi;
