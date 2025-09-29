import { useEffect, useRef, useState } from 'react';
import useHttp from './useHttp';
import { useAuthContext } from '../contexts/AuthContext';

// Global pause flag for role monitoring during critical operations
let globalPauseRoleMonitoring = false;

export const pauseRoleMonitoring = () => {
  globalPauseRoleMonitoring = true;
};

export const resumeRoleMonitoring = () => {
  globalPauseRoleMonitoring = false;
};

interface RoleMonitorConfig {
  pollingInterval?: number; // in milliseconds
  checkOnFocus?: boolean;
  enabled?: boolean;
}

interface RoleStatus {
  isAdmin: boolean;
  roleChanged?: boolean;
  message?: string;
}

export const useRoleMonitor = (config: RoleMonitorConfig = {}) => {
  const {
    pollingInterval = 30000, // 30 seconds default
    checkOnFocus = true,
    enabled = true,
  } = config;

  const { api } = useHttp();
  const { handleRoleMismatch, isRoleChangeDetected } = useAuthContext();
  const [lastKnownRole, setLastKnownRole] = useState<boolean | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCheckingRef = useRef(false);
  const focusDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkRoleStatus = async () => {
    if (isCheckingRef.current || isRoleChangeDetected || globalPauseRoleMonitoring) return;

    isCheckingRef.current = true;

    try {
      const response = await api.post<RoleStatus>('/admin/refresh-role');
      const { isAdmin, roleChanged } = response.data;

      // Initialize lastKnownRole on first check
      if (lastKnownRole === null) {
        setLastKnownRole(isAdmin);
        return;
      }

      // Server-side role change detection is authoritative - it compares token claims vs live Cognito attributes
      if (roleChanged) {
        console.log(`Server detected role change: current isAdmin=${isAdmin}`);

        // Update our local tracking before handling the change
        setLastKnownRole(isAdmin);

        // If user was demoted (admin -> regular user)
        if (!isAdmin) {
          console.log('User was demoted from admin to regular user');
          handleRoleMismatch();
          return;
        }

        // If user was promoted (regular user -> admin)
        if (isAdmin) {
          console.log('User was promoted to admin');
          // Immediate reload to show new admin UI
          window.location.reload();
          return;
        }
      }

      // Check if role changed from our local tracking (as fallback)
      if (lastKnownRole !== null && lastKnownRole !== isAdmin) {
        console.log(`Local role change detected: ${lastKnownRole} -> ${isAdmin}`);

        // Update our local tracking
        setLastKnownRole(isAdmin);

        // If user was demoted (admin -> regular user)
        if (lastKnownRole === true && isAdmin === false) {
          console.log('Local detection: User was demoted from admin to regular user');
          handleRoleMismatch();
          return;
        }

        // For promotions, reload immediately to show new UI
        if (lastKnownRole === false && isAdmin === true) {
          console.log('Local detection: User was promoted to admin');
          // Immediate reload to show new admin UI
          window.location.reload();
        }
      }
    } catch (error: any) {
      // If we get 403/409, it means role was revoked
      if (error?.response?.status === 403 || error?.response?.status === 409) {
        console.log('Received 403/409 error - admin privileges likely revoked');
        if (lastKnownRole === true) {
          // Only if we thought we were admin
          console.log('User was previously admin - triggering role mismatch handler');
          handleRoleMismatch();
        }
      }
      // For other errors, we don't need to do anything as they might be network issues
      else {
        console.log('Role monitor error (non-auth):', error);
      }
    } finally {
      isCheckingRef.current = false;
    }
  };

  const startPolling = () => {
    if (intervalRef.current || !enabled) return;

    intervalRef.current = setInterval(checkRoleStatus, pollingInterval);
  };

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    if (!enabled) return;

    // Initial check
    checkRoleStatus();

    // Start polling
    startPolling();

    // Check on window focus if enabled (with debouncing)
    const handleFocus = () => {
      if (checkOnFocus && !document.hidden) {
        // Clear existing debounce timeout
        if (focusDebounceRef.current) {
          clearTimeout(focusDebounceRef.current);
        }
        
        // Set new debounced timeout
        focusDebounceRef.current = setTimeout(() => {
          checkRoleStatus();
        }, 500); // 500ms debounce
      }
    };

    if (checkOnFocus) {
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleFocus);
    }

    return () => {
      stopPolling();
      if (focusDebounceRef.current) {
        clearTimeout(focusDebounceRef.current);
      }
      if (checkOnFocus) {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleFocus);
      }
    };
  }, [enabled, pollingInterval, checkOnFocus, isRoleChangeDetected]);

  // Stop monitoring if role change was detected
  useEffect(() => {
    if (isRoleChangeDetected) {
      stopPolling();
    }
  }, [isRoleChangeDetected]);

  return {
    checkRoleStatus,
    startPolling,
    stopPolling,
  };
};
