import React, { createContext, useContext, useEffect, useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { useToast } from '../hooks/useToast';

interface AuthContextType {
  isRoleChangeDetected: boolean;
  handleRoleMismatch: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isRoleChangeDetected, setIsRoleChangeDetected] = useState(false);
  const toast = useToast();

  const handleRoleMismatch = () => {
    if (isRoleChangeDetected) return; // Prevent multiple notifications

    setIsRoleChangeDetected(true);
    toast.show(
      'Your permissions have changed. Redirecting to login...',
      'warning'
    );

    // Force immediate sign out without delay
    setTimeout(async () => {
      try {
        await signOut();
        window.location.reload();
      } catch (error) {
        console.error('Failed to sign out after role change:', error);
        window.location.reload();
      }
    }, 100); // Minimal delay to allow toast to show briefly
  };

  useEffect(() => {
    const handleRoleMismatchEvent = () => {
      handleRoleMismatch();
    };

    // Listen for role mismatch events from API interceptor
    window.addEventListener(
      'role-mismatch-detected',
      handleRoleMismatchEvent as EventListener
    );

    return () => {
      window.removeEventListener(
        'role-mismatch-detected',
        handleRoleMismatchEvent as EventListener
      );
    };
  }, [isRoleChangeDetected]);

  const value: AuthContextType = {
    isRoleChangeDetected,
    handleRoleMismatch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
