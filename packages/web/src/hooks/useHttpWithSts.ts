import { fetchAuthSession } from 'aws-amplify/auth';
import axios, { AxiosResponse, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { sign } from 'aws4';
import useSWR, { SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useSts } from './useSts';

interface HttpWithStsConfig {
  useStsTempCredentials?: boolean;
  roleArn?: string;
  autoRefreshCredentials?: boolean;
}

// Create a new axios instance for STS-enabled requests
const createApiInstance = () => {
  return axios.create({
    baseURL: import.meta.env.VITE_APP_API_ENDPOINT,
  });
};

/**
 * Enhanced HTTP hook that supports both Cognito tokens and STS temporary credentials
 */
const useHttpWithSts = (config?: HttpWithStsConfig) => {
  const api = createApiInstance();
  const { getValidCredentials, credentials } = useSts({
    roleArn: config?.roleArn,
    autoRefresh: config?.autoRefreshCredentials,
  });

  // Request interceptor to add authentication
  api.interceptors.request.use(async (axiosConfig: InternalAxiosRequestConfig) => {
    try {
      if (config?.useStsTempCredentials && config?.roleArn) {
        // Use STS temporary credentials
        const stsCredentials = await getValidCredentials();
        
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
            body: axiosConfig.data ? JSON.stringify(axiosConfig.data) : undefined,
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
      } else {
        // Use Cognito ID token (existing behavior)
        const token = (await fetchAuthSession()).tokens?.idToken?.toString();
        if (token) {
          axiosConfig.headers['Authorization'] = token;
        }
      }

      axiosConfig.headers['Content-Type'] = 'application/json';
      return axiosConfig;
    } catch (error) {
      console.error('Error in request interceptor:', error);
      throw error;
    }
  });

  const fetcher = (url: string) => {
    return api.get(url).then((res) => res.data);
  };

  return {
    api,
    credentials,
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

export default useHttpWithSts;