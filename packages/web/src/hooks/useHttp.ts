import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import axios, { AxiosResponse, AxiosRequestConfig } from 'axios';
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

// HTTP Response Preprocessing - Combined auth retry and role mismatch handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 errors with retry logic for auth failures
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

    // Handle role mismatch errors (403 Forbidden or 409 Conflict)
    if (
      error.response &&
      (error.response.status === 403 || error.response.status === 409)
    ) {
      // Check if this is specifically a role-related error
      const errorMessage = error.response.data?.message || '';
      const isRoleMismatch =
        errorMessage.includes('admin') ||
        errorMessage.includes('privilege') ||
        errorMessage.includes('revoked') ||
        error.response.status === 409; // 409 typically indicates role mismatch

      if (isRoleMismatch) {
        console.log('Role mismatch detected, forcing re-authentication');

        // Dispatch custom event to notify other components
        window.dispatchEvent(
          new CustomEvent('role-mismatch-detected', {
            detail: {
              status: error.response.status,
              message: errorMessage,
            },
          })
        );

        // Force sign out after a short delay to allow UI to show message
        setTimeout(async () => {
          try {
            await signOut();
            // Redirect will be handled by auth components
          } catch (signOutError) {
            console.error(
              'Failed to sign out after role mismatch:',
              signOutError
            );
            // Force page reload as fallback
            window.location.href = '/';
          }
        }, 2000);
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