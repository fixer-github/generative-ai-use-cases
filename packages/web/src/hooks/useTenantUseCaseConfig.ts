import { useState, useEffect } from 'react';
import { TenantUseCaseConfigResponse } from 'generative-ai-use-cases-types';
import useHttp from './useHttp';

const useTenantUseCaseConfig = () => {
  const [tenantConfig, setTenantConfig] = useState<TenantUseCaseConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const http = useHttp();

  const fetchTenantConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await http.get<TenantUseCaseConfigResponse>('tenant-use-case-config');
      
      if (response.data) {
        setTenantConfig(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch tenant use case configuration:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch configuration');
      
      // Fallback to global configuration from environment variables
      const globalConfig: HiddenUseCases = JSON.parse(
        import.meta.env.VITE_APP_HIDDEN_USE_CASES || '{}'
      );
      
      setTenantConfig({
        tenantId: null,
        hiddenUseCases: globalConfig,
        source: 'global_fallback',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenantConfig();
  }, []);

  return {
    tenantConfig,
    loading,
    error,
    refetch: fetchTenantConfig,
  };
};

export default useTenantUseCaseConfig;