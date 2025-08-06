import useHttp from './useHttp';

type GetAvailableModelsResponse = {
  models: string[];
};

const useModelApi = () => {
  const http = useHttp();

  return {
    getAvailableModels: (): string[] => {
      try {
        const response = http.get<GetAvailableModelsResponse>('models');
        console.log(JSON.stringify(response));

        const models = response.data ? response.data.models : ['empty'];

        return models;
      } catch (error) {
        console.error(error);

        return ['error'];
      }
    },
  };
};

export default useModelApi;
