import axios, {
  AxiosResponse,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { sign } from 'aws4';
import useSWR, { SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useTenantStsCredentials } from './useTenantStsCredentials';

/**
 * HTTP hook that uses STS temporary credentials for authentication
 * Credentials are obtained from Lambda via ID token claims
 */
const useHttp = () => {
  // Create axios instance
  const api = axios.create({
    baseURL: import.meta.env.VITE_APP_API_ENDPOINT,
  });

  // Use tenant STS credentials from ID token
  const stsHook = useTenantStsCredentials();

  // Request interceptor to add STS authentication
  api.interceptors.request.use(
    async (axiosConfig: InternalAxiosRequestConfig) => {
      try {
        // Get STS temporary credentials
        const stsCredentials = await stsHook.getValidCredentials();

        if (stsCredentials) {
          // Parse the API endpoint to get host and path
          const url = new URL(axiosConfig.url || '', axiosConfig.baseURL);
          const service = 'execute-api';
          const region = import.meta.env.VITE_APP_REGION || 'us-east-1';

          // Clean headers to remove null values
          const cleanHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(axiosConfig.headers)) {
            if (value !== null && value !== undefined) {
              cleanHeaders[key] = String(value);
            }
          }

          // Prepare the request for signing
          const request = {
            host: url.hostname,
            method: axiosConfig.method?.toUpperCase() || 'GET',
            url: url.pathname + url.search,
            path: url.pathname + url.search,
            headers: {
              ...cleanHeaders,
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
        } else {
          throw new Error('Failed to obtain STS credentials');
        }

        axiosConfig.headers['Content-Type'] = 'application/json';
        return axiosConfig;
      } catch (error) {
        console.error('Error in request interceptor:', error);
        throw error;
      }
    }
  );

  const fetcher = (url: string) => {
    return api.get(url).then((res) => res.data);
  };

  return {
    api,
    credentials: stsHook.credentials,
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

export default useHttp;
