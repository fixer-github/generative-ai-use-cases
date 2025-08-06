import useHttp from './useHttp';

type GetAvailableModelsResponse = {
  models: string[];
};

const useModelApi = () => {
  const http = useHttp();

  let models: string[] = [];

  try {
    const response = http.get<GetAvailableModelsResponse>('models');
    console.log(JSON.stringify(response));

    models = response.data ? response.data.models : ['empty'];
  } catch (error) {
    console.error(error);
  }

  return {
    models: models,
  };
};

export default useModelApi;
