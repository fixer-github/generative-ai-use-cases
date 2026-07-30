import { useMemo } from 'react';
import useLicenseApi from './useLicenseApi';

// Self-service hook for the current user's license status (sidebar badge,
// send blocking, model filtering, warning banner).
const useLicense = () => {
  const { data, error, isLoading, mutate } = useLicenseApi().getMyLicense();

  const license = useMemo(() => data?.license ?? null, [data]);

  // While loading (license === null) nothing is blocked yet; the server-side
  // gate is authoritative either way (requirement 29).
  const blocked = useMemo(() => {
    if (!license) return false;
    return !license.assigned || license.remainingPercent <= 0;
  }, [license]);

  const blockReason: 'unassigned' | 'exhausted' | null = useMemo(() => {
    if (!license || !blocked) return null;
    return license.assigned ? 'exhausted' : 'unassigned';
  }, [license, blocked]);

  const warnLevel: 'none' | 'warn' | 'critical' = useMemo(() => {
    if (!license || !license.assigned) return 'none';
    if (license.remainingPercent <= license.criticalThresholdPercent) {
      return 'critical';
    }
    if (license.remainingPercent <= license.warnThresholdPercent) {
      return 'warn';
    }
    return 'none';
  }, [license]);

  return {
    license,
    // true once the license is loaded and the user must not send
    blocked,
    blockReason,
    warnLevel,
    remainingPercent: license?.remainingPercent ?? null,
    allowedModelIds: license?.allowedModelIds ?? null,
    resetDate: license?.resetDate ?? null,
    isLoading,
    isError: !!error,
    mutate,
  };
};

export default useLicense;
