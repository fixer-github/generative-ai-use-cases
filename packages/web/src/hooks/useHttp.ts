import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import axios, { AxiosRequestConfig } from 'axios';
import useSWR, { SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';

const api = axios.create({
  baseURL: import.meta.env.VITE_APP_API_ENDPOINT,
});

// HTTP Request Preprocessing
api.interceptors.request.use(async (config) => {
  try {
    // If Authenticated, append ID Token to Request Header
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      config.headers['Authorization'] = token;
    }
  } catch (error) {
    console.warn('[useHttp] Failed to get auth session:', error);
  }

  config.headers['Content-Type'] = 'application/json';

  return config;
});

// HTTP Response Preprocessing - Combined auth failure and role mismatch handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If we get a 401 and haven't already retried, try to refresh the session
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to get a fresh session
        const session = await fetchAuthSession({ forceRefresh: true });
        const token = session.tokens?.idToken?.toString();

        if (token) {
          originalRequest.headers['Authorization'] = token;
          return api(originalRequest);
        }
      } catch (refreshError) {
        console.warn('[useHttp] Token refresh failed:', refreshError);
      }
    }

    // Check for role mismatch errors (409 Conflict indicates demoted user)
    if (error.response?.status === 409) {
      const responseData = error.response.data;
      
      // Check if this indicates a role change that requires immediate action
      if (responseData?.roleChanged && responseData?.refreshRequired) {
        console.warn('[useHttp] User has been demoted - triggering immediate logout');
        
        try {
          // Force immediate logout without delay
          await signOut();
          
          // Reload the page to clear all state
          window.location.reload();
        } catch (signOutError) {
          console.error('[useHttp] Failed to sign out demoted user:', signOutError);
          // Even if signOut fails, reload to clear state
          window.location.reload();
        }
        return; // Don't propagate the error further
      }
    }

    // Check for other role mismatch errors (403 Forbidden)
    if (error.response?.status === 403) {
      // Skip role mismatch handling for validate-domains and invite endpoints
      // Let the calling component handle these errors appropriately
      const requestUrl = originalRequest.url || '';
      if (requestUrl.includes('/validate-domains') || requestUrl.includes('/admin/users/invite')) {
        return Promise.reject(error);
      }

      // Check if this is specifically a role-related error
      const errorMessage = error.response.data?.message || '';
      const isRoleMismatch =
        errorMessage.includes('admin') ||
        errorMessage.includes('privilege') ||
        errorMessage.includes('revoked');

      if (isRoleMismatch) {
        console.log('[useHttp] Role mismatch detected (403), forcing re-authentication');

        // Dispatch custom event to notify other components
        window.dispatchEvent(
          new CustomEvent('role-mismatch-detected', {
            detail: {
              status: error.response.status,
              message: errorMessage,
            },
          })
        );

        // Force immediate sign out without any delay
        try {
          await signOut();
          window.location.reload();
        } catch (signOutError) {
          console.error('[useHttp] Failed to sign out after role mismatch:', signOutError);
          window.location.reload();
        }
      }
    }

    return Promise.reject(error);
  }
);
const fetcher = (url: string) => {
  return api.get(url).then((res) => res.data);
};

/**
 * Hooks for Http Request
 * @returns
 */
const useHttp = () => {
  return {
    api,
    fetcher,
    /**
     * GET Request
     * Implemented with SWR
     * @param url
     * @returns
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: <Data = any, Error = any>(
      url: string | null,
      config?: SWRConfiguration
    ) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSWR<Data, Error>(url, fetcher, config);
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPagination: <Data = any, Error = any>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getKey: (pageIndex: number, previousPageData: any) => string | null,
      config?: SWRConfiguration
    ) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSWRInfinite<Data, Error>(getKey, fetcher, config);
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
      return new Promise<import('axios').AxiosResponse<RES>>((resolve, reject) => {
        api
          .post<RES, import('axios').AxiosResponse<RES>, DATA>(url, data, reqConfig)
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
      return new Promise<import('axios').AxiosResponse<RES>>((resolve, reject) => {
        api
          .put<RES, import('axios').AxiosResponse<RES>, DATA>(url, data)
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
      return new Promise<import('axios').AxiosResponse<RES>>((resolve, reject) => {
        api
          .delete<RES, import('axios').AxiosResponse<RES>, DATA>(url)
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

const usePagination = <T>(
  url: string,
  initialSize = 10,
  options?: SWRConfiguration,
  config?: AxiosRequestConfig,
) => {
  const swr = useSWRInfinite<T>(
    (pageIndex) => {
      const query = `limit=${initialSize}&offset=${initialSize * pageIndex}`;
      return url.indexOf('?') > 0 ? `${url}&${query}` : `${url}?${query}`;
    },
    (requestUrl) => {
      return api.get(requestUrl, config).then((res) => res.data);
    },
    options,
  );

  return {
    ...swr,
    hasMore: (() => {
      if (!swr.data || swr.data.length === 0) return false;
      const lastData = swr.data[swr.data.length - 1];
      return Array.isArray(lastData) && lastData.length === initialSize;
    })(),
  };
};

const useSwrWithFetcher = <T>(url: string, options?: SWRConfiguration) => {
  return useSWR<T>(url, fetcher, options);
};

const useSwrWithAPI = <T>(
  url: string,
  options?: SWRConfiguration,
  config?: AxiosRequestConfig,
) => {
  return useSWR<T>(
    url,
    (requestUrl) => {
      return api.get(requestUrl, config).then((res) => res.data);
    },
    options,
  );
};

export default useHttp;
export { usePagination, useSwrWithFetcher, useSwrWithAPI };