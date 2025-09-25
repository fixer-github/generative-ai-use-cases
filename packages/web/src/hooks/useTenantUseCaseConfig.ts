import { TenantUseCaseConfigResponse } from 'generative-ai-use-cases';
import useHttp from './useHttp';

const useTenantUseCaseConfig = () => {
  const http = useHttp();
  
  const { data, error, mutate, isLoading } = http.get<TenantUseCaseConfigResponse>(
    'tenant-use-case-config',
    {
      revalidateOnFocus: false,
      shouldRetryOnError: true,
      errorRetryCount: 2,
    }
  );

  return {
    tenantConfig: data || null,
    loading: isLoading,
    error: error?.message || null,
    refetch: mutate,
  };
};

export default useTenantUseCaseConfig;