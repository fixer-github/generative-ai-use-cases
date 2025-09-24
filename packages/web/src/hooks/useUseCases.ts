import { HiddenUseCases, HiddenUseCasesKeys } from 'generative-ai-use-cases';
import useTenantUseCaseConfig from './useTenantUseCaseConfig';

// Fallback to global configuration from environment variables
const globalHiddenUseCases: HiddenUseCases = JSON.parse(
  import.meta.env.VITE_APP_HIDDEN_USE_CASES || '{}'
);

const useUseCases = () => {
  const { tenantConfig } = useTenantUseCaseConfig();

  // Use tenant-specific configuration if available, otherwise use global configuration
  const hiddenUseCases = tenantConfig?.hiddenUseCases || globalHiddenUseCases;

  const enabledSingle = (useCase: HiddenUseCasesKeys): boolean => {
    return !hiddenUseCases[useCase];
  };

  const enabled = (...useCases: HiddenUseCasesKeys[]): boolean => {
    return useCases.every(enabledSingle);
  };

  return {
    enabled,
    tenantConfig, // Expose tenant config for debugging/information
    loading: tenantConfig === null, // Still loading if no config yet
  };
};

export default useUseCases;
