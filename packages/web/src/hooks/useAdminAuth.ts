import { useState, useEffect, useRef } from 'react';
import { signOut } from 'aws-amplify/auth';
import useHttp from './useHttp';

interface AdminStatus {
  isAdmin: boolean;
  tenantId: string;
  username: string;
}

interface AdminAuthState {
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
  tenantId: string | null;
  username: string | null;
}

/**
 * Custom hook for ABAC (Attribute-Based Access Control) validation
 * specifically for tenantAdmin attribute validation
 *
 * This hook provides:
 * - Real-time admin status checking via API
 * - Periodic role monitoring to detect demotion
 * - Loading states for UI feedback
 * - Error handling for network issues
 * - Cached results for performance
 * - Automatic logout on role demotion
 *
 * @returns AdminAuthState object with admin validation results
 */
const useAdminAuth = (): AdminAuthState => {
  const { api } = useHttp();
  const [state, setState] = useState<AdminAuthState>({
    isAdmin: false,
    isLoading: true,
    error: null,
    tenantId: null,
    username: null,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastKnownAdminStatusRef = useRef<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkAdminStatus = async (isPeriodicCheck = false) => {
      try {
        if (!isPeriodicCheck) {
          setState((prev) => ({ ...prev, isLoading: true, error: null }));
        }

        // Call the same endpoint that AdminPortal uses for consistency
        const response = await api.get<AdminStatus>('/admin/status');

        if (isMounted) {
          const isCurrentlyAdmin = response.data.isAdmin || false;
          
          // Check if user was demoted (was admin but no longer is)
          if (lastKnownAdminStatusRef.current === true && isCurrentlyAdmin === false) {
            console.warn('[useAdminAuth] User demotion detected - was admin, now regular user');
            
            try {
              await signOut();
              window.location.reload();
            } catch (signOutError) {
              console.error('[useAdminAuth] Failed to sign out demoted user:', signOutError);
              window.location.reload();
            }
            return;
          }

          setState({
            isAdmin: isCurrentlyAdmin,
            isLoading: false,
            error: null,
            tenantId: response.data.tenantId || null,
            username: response.data.username || null,
          });

          // Update last known status
          lastKnownAdminStatusRef.current = isCurrentlyAdmin;

          // Start periodic monitoring if user is admin
          if (isCurrentlyAdmin && !intervalRef.current) {
            intervalRef.current = setInterval(() => {
              checkAdminStatus(true);
            }, 30000); // Check every 30 seconds
          } else if (!isCurrentlyAdmin && intervalRef.current) {
            // Stop monitoring if not admin
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (error: any) {
        if (isMounted) {
          // Check for role mismatch errors
          if (error.response?.status === 409) {
            const responseData = error.response.data;
            if (responseData?.roleChanged && responseData?.refreshRequired) {
              // User was demoted, but this should be handled by the HTTP interceptor
              console.warn('[useAdminAuth] Role change detected via 409 error');
              return;
            }
          }

          if (error.response?.status === 403) {
            const errorMessage = error.response.data?.message || '';
            if (errorMessage.includes('admin') || errorMessage.includes('privilege')) {
              // User was likely demoted
              if (lastKnownAdminStatusRef.current === true) {
                console.warn('[useAdminAuth] User demotion detected via 403 error');
                
                try {
                  await signOut();
                  window.location.reload();
                } catch (signOutError) {
                  console.error('[useAdminAuth] Failed to sign out demoted user:', signOutError);
                  window.location.reload();
                }
                return;
              }
            }
          }

          // If the API call fails (e.g., 403 Forbidden), user is not admin
          setState({
            isAdmin: false,
            isLoading: false,
            error:
              error.response?.status === 403
                ? null // 403 is expected for non-admin users, don't show as error
                : 'Failed to verify admin status',
            tenantId: null,
            username: null,
          });

          lastKnownAdminStatusRef.current = false;
          
          // Stop monitoring if we get an error and clear interval
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      }
    };

    checkAdminStatus();

    // Listen for focus events to check status when user returns to tab
    const handleFocus = () => {
      if (!document.hidden) {
        checkAdminStatus(true);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    // Cleanup function to prevent state updates on unmounted component
    return () => {
      isMounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [api]);

  return state;
};

export default useAdminAuth;
