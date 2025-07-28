import { fetchAuthSession } from 'aws-amplify/auth';
import axios, {
  AxiosResponse,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { sign } from 'aws4';
import useSWR, { SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useSts } from './useSts';

interface HttpConfig {
  useStsTempCredentials?: boolean;
  roleArn?: string;
  autoRefreshCredentials?: boolean;
}

// Create a shared axios instance for backward compatibility
const sharedApi = axios.create({
  baseURL: import.meta.env.VITE_APP_API_ENDPOINT,
});

// Configure the shared instance with default Cognito auth (backward compatibility)
sharedApi.interceptors.request.use(async (config) => {
  // If Authenticated, append ID Token to Request Header
  const token = (await fetchAuthSession()).tokens?.idToken?.toString();
  if (token) {
    config.headers['Authorization'] = token;
  }

  config.headers['Content-Type'] = 'application/json';

  return config;
});

/**
 * HTTP hook that uses either Cognito tokens or STS temporary credentials based on configuration
 * - If STS is enabled in environment, uses STS temporary credentials
 * - Otherwise, uses Cognito ID tokens (backward compatible)
 */
const useHttp = (config?: HttpConfig) => {
  // Check if STS is enabled in environment
  const stsEnabled =
    import.meta.env.VITE_APP_USE_STS_TEMP_CREDENTIALS === 'true';
  const envRoleArn = import.meta.env.VITE_APP_TENANT_ROLE_ARN;

  // Determine if we should use STS based on environment or config
  const shouldUseSts = stsEnabled || config?.useStsTempCredentials;
  const roleArn = config?.roleArn || envRoleArn;

  // Create a new axios instance when using STS
  const api = shouldUseSts
    ? axios.create({
        baseURL: import.meta.env.VITE_APP_API_ENDPOINT,
      })
    : sharedApi;

  // Only initialize STS hook when needed
  const stsHook = useSts({
    roleArn: shouldUseSts ? roleArn : undefined,
    autoRefresh: shouldUseSts
      ? (config?.autoRefreshCredentials ?? true)
      : false,
  });

  // Request interceptor to add authentication (only for STS instances)
  if (shouldUseSts) {
    api.interceptors.request.use(
      async (axiosConfig: InternalAxiosRequestConfig) => {
        try {
          // Use STS temporary credentials
          const stsCredentials = await stsHook.getValidCredentials();

          if (stsCredentials) {
            // Parse the API endpoint to get host and path
            const url = new URL(axiosConfig.url || '', axiosConfig.baseURL);
            const service = 'execute-api';
            const region = import.meta.env.VITE_APP_REGION || 'us-east-1';

            // Prepare the request for signing
            const request = {
              host: url.hostname,
              method: axiosConfig.method?.toUpperCase() || 'GET',
              url: url.pathname + url.search,
              path: url.pathname + url.search,
              headers: {
                ...axiosConfig.headers,
                'Content-Type': 'application/json',
              },
              body: axiosConfig.data
                ? JSON.stringify(axiosConfig.data)
                : undefined,
              service,
              region,
            };

            // Sign the request with AWS Signature V4
            const signedRequest = sign(request, {
              accessKeyId: stsCredentials.accessKeyId,
              secretAccessKey: stsCredentials.secretAccessKey,
              sessionToken: stsCredentials.sessionToken,
            });

            // Apply the signed headers
            Object.assign(axiosConfig.headers, signedRequest.headers);
          }

          axiosConfig.headers['Content-Type'] = 'application/json';
          return axiosConfig;
        } catch (error) {
          console.error('Error in request interceptor:', error);
          throw error;
        }
      }
    );
  }

  const fetcher = (url: string) => {
    return api.get(url).then((res) => res.data);
  };

  return {
    api,
    credentials: shouldUseSts ? stsHook.credentials : undefined,
    /**
     * GET Request
     * Implemented with SWR
     * @param url
     * @returns
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: <Data = any, Error = any>(
      url: string | null,
      swrConfig?: SWRConfiguration
    ) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSWR<Data, Error>(url, fetcher, swrConfig);
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPagination: <Data = any, Error = any>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getKey: (pageIndex: number, previousPageData: any) => string | null,
      swrConfig?: SWRConfiguration
    ) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSWRInfinite<Data, Error>(getKey, fetcher, swrConfig);
    },

    /**
     * POST Request
     * @param url
     * @param data
     * @returns
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: <RES = any, DATA = any>(
      url: string,
      data: DATA,
      reqConfig?: AxiosRequestConfig,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errorProcess?: (err: any) => void
    ) => {
      return new Promise<AxiosResponse<RES>>((resolve, reject) => {
        api
          .post<RES, AxiosResponse<RES>, DATA>(url, data, reqConfig)
          .then((data) => {
            resolve(data);
          })
          .catch((err) => {
            if (errorProcess) {
              errorProcess(err);
            }
            reject(err);
          });
      });
    },

    /**
     * PUT Request
     * @param url
     * @param data
     * @returns
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    put: <RES = any, DATA = any>(
      url: string,
      data: DATA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errorProcess?: (err: any) => void
    ) => {
      return new Promise<AxiosResponse<RES>>((resolve, reject) => {
        api
          .put<RES, AxiosResponse<RES>, DATA>(url, data)
          .then((data) => {
            resolve(data);
          })
          .catch((err) => {
            if (errorProcess) {
              errorProcess(err);
            }
            reject(err);
          });
      });
    },
    /**
     * DELETE Request
     * @param url
     * @returns
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: <RES = any, DATA = any>(
      url: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errorProcess?: (err: any) => void
    ) => {
      return new Promise<AxiosResponse<RES>>((resolve, reject) => {
        api
          .delete<RES, AxiosResponse<RES>, DATA>(url)
          .then((data) => {
            resolve(data);
          })
          .catch((err) => {
            if (errorProcess) {
              errorProcess(err);
            }
            reject(err);
          });
      });
    },
  };
};

/**
 * Get STS configuration from environment variables
 */
export const getStsConfig = (): HttpConfig | undefined => {
  const roleArn = import.meta.env.VITE_APP_TENANT_ROLE_ARN;

  // Always use STS when tenant role ARN is available
  if (roleArn) {
    return {
      useStsTempCredentials: true,
      roleArn,
      autoRefreshCredentials: true,
    };
  }

  return undefined;
};

export default useHttp;
