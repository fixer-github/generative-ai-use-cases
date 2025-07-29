import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useState, useCallback, useEffect, useRef } from 'react';

interface StsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

interface AwsError extends Error {
  Code?: string;
  code?: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
  };
}

interface UseStsConfig {
  roleArn: string;
  sessionDuration?: number;
  autoRefresh?: boolean;
  refreshBuffer?: number; // minutes before expiration to refresh
}

const DEFAULT_SESSION_DURATION = 3600; // 1 hour
const DEFAULT_REFRESH_BUFFER = 5; // 5 minutes

export const useSts = (config: UseStsConfig) => {
  const [credentials, setCredentials] = useState<StsCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout>();

  const assumeRole = useCallback(async () => {
    if (!config.roleArn) {
      throw new Error('Role ARN is required for STS authentication');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get the current Cognito session
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();

      if (!idToken) {
        throw new Error('No ID token available');
      }

      // Get user attributes to extract tenant ID
      const payload = session.tokens?.idToken?.payload;
      const tenantId = payload?.['custom:tenant_id'] as string;

      if (!tenantId) {
        throw new Error('No tenant ID found in token');
      }

      const region = import.meta.env.VITE_APP_REGION || 'us-east-1';

      console.log('STS AssumeRole Debug:', {
        roleArn: config.roleArn,
        tenantId,
        region,
        sessionName: `tenant-${tenantId}-session-${Date.now()}`,
        idTokenLength: idToken.length,
        idTokenPrefix: idToken.substring(0, 20) + '...',
      });

      // Create STS client
      const stsClient = new STSClient({
        region: import.meta.env.VITE_APP_REGION || 'us-east-1',
      });

      // Assume role with web identity using Cognito User Pool ID token
      const command = new AssumeRoleWithWebIdentityCommand({
        RoleArn: config.roleArn,
        RoleSessionName: `tenant-${tenantId}-session-${Date.now()}`,
        WebIdentityToken: idToken,
        DurationSeconds: config.sessionDuration || DEFAULT_SESSION_DURATION,
      });

      const response = await stsClient.send(command);

      if (!response.Credentials) {
        throw new Error('No credentials returned from STS');
      }

      const stsCredentials: StsCredentials = {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
        expiration: response.Credentials.Expiration!,
      };

      setCredentials(stsCredentials);
      setIsLoading(false);

      // Schedule refresh if auto-refresh is enabled
      if (config.autoRefresh) {
        const refreshBuffer =
          (config.refreshBuffer || DEFAULT_REFRESH_BUFFER) * 60 * 1000;
        const timeUntilExpiration =
          stsCredentials.expiration.getTime() - Date.now();
        const refreshTime = timeUntilExpiration - refreshBuffer;

        if (refreshTime > 0) {
          refreshTimeoutRef.current = setTimeout(() => {
            assumeRole();
          }, refreshTime);
        }
      }

      return stsCredentials;
    } catch (err) {
      const awsError = err as AwsError;
      console.error('STS AssumeRole Error:', {
        error: err,
        message: awsError.message,
        code: awsError.Code || awsError.code,
        statusCode: awsError.$metadata?.httpStatusCode,
        requestId: awsError.$metadata?.requestId,
        roleArn: config.roleArn,
      });
      setError(awsError);
      setIsLoading(false);
      throw err;
    }
  }, [config]);

  // Clear refresh timeout on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Check if credentials are expired
  const isExpired = useCallback(() => {
    if (!credentials) return true;
    return new Date() >= credentials.expiration;
  }, [credentials]);

  // Get valid credentials (refresh if expired)
  const getValidCredentials = useCallback(async () => {
    if (!credentials || isExpired()) {
      return await assumeRole();
    }
    return credentials;
  }, [credentials, isExpired, assumeRole]);

  // Clear credentials
  const clearCredentials = useCallback(() => {
    setCredentials(null);
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
  }, []);

  return {
    credentials,
    isLoading,
    error,
    assumeRole,
    isExpired,
    getValidCredentials,
    clearCredentials,
  };
};
