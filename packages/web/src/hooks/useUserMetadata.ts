import { create } from 'zustand';
import { useCallback, useEffect, useRef } from 'react';
import useHttp from './useHttp';

export type UserMetadata = Record<string, string>;

interface UserMetadataState {
  metadata: UserMetadata;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  setMetadata: (metadata: UserMetadata) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const useUserMetadataStore = create<UserMetadataState>((set) => ({
  metadata: {},
  isLoading: false,
  isInitialized: false,
  error: null,
  setMetadata: (metadata) => set({ metadata }),
  setLoading: (isLoading) => set({ isLoading }),
  setInitialized: (isInitialized) => set({ isInitialized }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      metadata: {},
      isLoading: false,
      isInitialized: false,
      error: null,
    }),
}));

interface GetUserMetadataResponse {
  metadata: UserMetadata;
}

interface PutUserMetadataResponse {
  message: string;
  metadata: UserMetadata;
}

interface UseUserMetadataOptions {
  syncOnMount?: boolean;
}

export const useUserMetadata = (options: UseUserMetadataOptions = {}) => {
  const { syncOnMount = true } = options;
  const { api } = useHttp();
  const {
    metadata,
    isLoading,
    isInitialized,
    error,
    setMetadata,
    setLoading,
    setInitialized,
    setError,
    reset,
  } = useUserMetadataStore();

  const fetchInProgress = useRef(false);

  const fetchMetadata = useCallback(async () => {
    if (fetchInProgress.current) return;
    fetchInProgress.current = true;

    setLoading(true);
    setError(null);

    try {
      const response = await api.get<GetUserMetadataResponse>('/user/metadata');
      setMetadata(response.data.metadata);
      setInitialized(true);
    } catch (err) {
      console.error('Failed to fetch user metadata:', err);
      setError('Failed to fetch user metadata');
    } finally {
      setLoading(false);
      fetchInProgress.current = false;
    }
  }, [api, setMetadata, setLoading, setInitialized, setError]);

  const saveMetadata = useCallback(
    async (
      updates: UserMetadata,
      mode: 'merge' | 'replace' = 'merge'
    ): Promise<UserMetadata> => {
      setLoading(true);
      setError(null);

      try {
        const response = await api.put<PutUserMetadataResponse>(
          '/user/metadata',
          { metadata: updates, mode }
        );
        setMetadata(response.data.metadata);
        return response.data.metadata;
      } catch (err) {
        console.error('Failed to save user metadata:', err);
        setError('Failed to save user metadata');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [api, setMetadata, setLoading, setError]
  );

  const updateMetadataKey = useCallback(
    async (key: string, value: string): Promise<UserMetadata> => {
      return saveMetadata({ [key]: value }, 'merge');
    },
    [saveMetadata]
  );

  const getMetadataKey = useCallback(
    (key: string): string | undefined => {
      return metadata[key];
    },
    [metadata]
  );

  useEffect(() => {
    if (syncOnMount && !isInitialized && !isLoading) {
      fetchMetadata();
    }
  }, [syncOnMount, isInitialized, isLoading, fetchMetadata]);

  return {
    metadata,
    isLoading,
    isInitialized,
    error,
    fetchMetadata,
    saveMetadata,
    updateMetadataKey,
    getMetadataKey,
    reset,
  };
};

export default useUserMetadata;
