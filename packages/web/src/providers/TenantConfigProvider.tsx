import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { HiddenUseCases, TenantConfiguration } from 'generative-ai-use-cases';
import useHttp from '../hooks/useHttp';

type TenantConfigState = {
  tenantId: string | null;
  tenantDisplayName: string | null;
  hiddenFeatures: HiddenUseCases;
  isLoading: boolean;
  error?: unknown;
};

const TenantConfigContext = createContext<TenantConfigState | undefined>(undefined);

type TenantConfigProviderProps = {
  children: ReactNode;
};

export const TenantConfigProvider = ({ children }: TenantConfigProviderProps) => {
  const { get } = useHttp();
  const { data, error, isLoading } = get<TenantConfiguration>('/tenants/config', {
    revalidateOnFocus: false,
  });

  const value = useMemo<TenantConfigState>(() => ({
    tenantId: data?.tenantId ?? null,
    tenantDisplayName: data?.tenantDisplayName ?? null,
    hiddenFeatures: data?.hiddenFeatures ?? {},
    isLoading: Boolean(isLoading),
    error,
  }), [data, error, isLoading]);

  return (
    <TenantConfigContext.Provider value={value}>
      {children}
    </TenantConfigContext.Provider>
  );
};

export const useTenantConfig = () => {
  const context = useContext(TenantConfigContext);

  if (!context) {
    throw new Error('useTenantConfig must be used within TenantConfigProvider');
  }

  return context;
};

