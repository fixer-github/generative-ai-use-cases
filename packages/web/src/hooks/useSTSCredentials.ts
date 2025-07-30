import { useState, useEffect, useCallback } from 'react';
import { useHttp } from './useHttp';

interface STSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

interface STSResponse {
  credentials: STSCredentials;
  assumedRoleUser: {
    arn: string;
    assumedRoleId: string;
  };
  tenantId: string;
}

export const useSTSCredentials = () => {
  const http = useHttp();
  const [credentials, setCredentials] = useState<STSCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCredentials = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await http.post<STSResponse>('/auth/assume-role', {});
      setCredentials(response.data.credentials);
      
      // Set up auto-refresh 5 minutes before expiration
      const expirationTime = new Date(response.data.credentials.expiration).getTime();
      const currentTime = new Date().getTime();
      const refreshTime = expirationTime - currentTime - (5 * 60 * 1000); // 5 minutes before expiry
      
      if (refreshTime > 0) {
        setTimeout(() => {
          refreshCredentials();
        }, refreshTime);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get credentials');
      setCredentials(null);
    } finally {
      setIsLoading(false);
    }
  }, [http]);

  // Initial load
  useEffect(() => {
    refreshCredentials();
  }, [refreshCredentials]);

  // Check if credentials are expired
  const isExpired = useCallback(() => {
    if (!credentials) return true;
    
    const expirationTime = new Date(credentials.expiration).getTime();
    const currentTime = new Date().getTime();
    
    return currentTime >= expirationTime;
  }, [credentials]);

  // Get valid credentials (refresh if expired)
  const getCredentials = useCallback(async (): Promise<STSCredentials | null> => {
    if (!credentials || isExpired()) {
      await refreshCredentials();
    }
    return credentials;
  }, [credentials, isExpired, refreshCredentials]);

  return {
    credentials,
    isLoading,
    error,
    refreshCredentials,
    getCredentials,
    isExpired,
  };
};