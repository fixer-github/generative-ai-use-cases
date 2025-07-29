import { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

interface StsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export const useTenantStsCredentials = () => {
  const [credentials, setCredentials] = useState<StsCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getCredentialsFromToken = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get the current Cognito session
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;

      if (!idToken) {
        throw new Error('No ID token available');
      }

      // Extract STS credentials from custom claims
      const stsCredentialsJson = idToken.payload?.[
        'custom:sts_credentials'
      ] as string;

      if (!stsCredentialsJson) {
        // No STS credentials in token - this might be expected if multi-tenant role is not configured
        console.log('No STS credentials found in ID token');
        setCredentials(null);
        setIsLoading(false);
        return null;
      }

      // Parse the STS credentials
      const parsedCredentials = JSON.parse(stsCredentialsJson);

      const stsCredentials: StsCredentials = {
        accessKeyId: parsedCredentials.AccessKeyId,
        secretAccessKey: parsedCredentials.SecretAccessKey,
        sessionToken: parsedCredentials.SessionToken,
        expiration: new Date(parsedCredentials.Expiration),
      };

      setCredentials(stsCredentials);
      setIsLoading(false);
      return stsCredentials;
    } catch (err) {
      console.error('Error getting STS credentials from token:', err);
      setError(err as Error);
      setIsLoading(false);
      throw err;
    }
  }, []);

  // Get credentials on mount
  useEffect(() => {
    getCredentialsFromToken();
  }, [getCredentialsFromToken]);

  // Check if credentials are expired
  const isExpired = useCallback(() => {
    if (!credentials) return true;
    return new Date() >= credentials.expiration;
  }, [credentials]);

  // Get valid credentials (refresh if expired)
  const getValidCredentials = useCallback(async () => {
    if (!credentials || isExpired()) {
      return await getCredentialsFromToken();
    }
    return credentials;
  }, [credentials, isExpired, getCredentialsFromToken]);

  // Clear credentials
  const clearCredentials = useCallback(() => {
    setCredentials(null);
  }, []);

  return {
    credentials,
    isLoading,
    error,
    isExpired,
    getValidCredentials,
    clearCredentials,
    refreshCredentials: getCredentialsFromToken,
  };
};
