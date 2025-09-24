import React, { createContext, useContext, useEffect, useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { useToast } from '../hooks/useToast';

interface AuthContextType {
  isRoleChangeDetected: boolean;
  handleRoleMismatch: (message: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isRoleChangeDetected, setIsRoleChangeDetected] = useState(false);
  const toast = useToast();

  const handleRoleMismatch = (message: string) => {
    if (isRoleChangeDetected) return; // Prevent multiple notifications

    setIsRoleChangeDetected(true);
    toast.show(
      'Your permissions have changed. Redirecting to login...',
      'warning'
    );

    // Force sign out after showing the message
    setTimeout(async () => {
      try {
        await signOut();
      } catch (error) {
        console.error('Failed to sign out after role change:', error);
        window.location.href = '/';
      }
    }, 2000);
  };

  useEffect(() => {
    const handleRoleMismatchEvent = (event: CustomEvent) => {
      const { message } = event.detail;
      handleRoleMismatch(message || 'Your admin privileges have been revoked.');
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
