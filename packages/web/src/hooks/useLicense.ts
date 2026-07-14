import { useMemo } from 'react';
import useLicenseApi from './useLicenseApi';

// Self-service hook for the current user's license/usage info (e.g. header remaining-count badge)
const useLicense = () => {
  const { data, error, isLoading, mutate } = useLicenseApi().getMyLicense();

  const license = useMemo(() => data?.license ?? null, [data]);
  const usage = useMemo(() => license?.usage ?? null, [license]);

  return {
    license,
    usage,
    remaining: usage?.remaining ?? null,
    limit: usage?.limit ?? null,
    isLoading,
    isError: !!error,
    mutate,
  };
};

export default useLicense;
