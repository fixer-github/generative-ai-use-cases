import { useCallback, useMemo } from 'react';
import { HiddenUseCases, HiddenUseCasesKeys } from 'generative-ai-use-cases';
import { useTenantConfig } from '../providers/TenantConfigProvider';

const EMPTY_HIDDEN_USE_CASES: HiddenUseCases = {};

const useUseCases = () => {
  const { hiddenFeatures, isLoading } = useTenantConfig();

  const hiddenUseCases = useMemo(() => {
    return hiddenFeatures ?? EMPTY_HIDDEN_USE_CASES;
  }, [hiddenFeatures]);

  const enabledSingle = useCallback(
    (useCase: HiddenUseCasesKeys): boolean => {
      return !hiddenUseCases[useCase];
    },
    [hiddenUseCases]
  );

  const enabled = useCallback(
    (...useCases: HiddenUseCasesKeys[]): boolean => {
      return useCases.every(enabledSingle);
    },
    [enabledSingle]
  );

  return {
    enabled,
    hiddenUseCases,
    isLoading,
  };
};

export default useUseCases;
