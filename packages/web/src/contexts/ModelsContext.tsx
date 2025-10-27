import React, { createContext, useContext, ReactNode } from 'react';
import { useModels } from '../hooks/useModel';
import { MODELS } from '../hooks/useModel';

type ModelsContextType = typeof MODELS | null;

const ModelsContext = createContext<ModelsContextType>(null);

export const ModelsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { models, isLoading } = useModels();

  // Show loading state while fetching models
  if (isLoading || !models) {
    return <div>Loading models...</div>;
  }

  return (
    <ModelsContext.Provider value={models}>{children}</ModelsContext.Provider>
  );
};

export const useModelsContext = () => {
  const context = useContext(ModelsContext);
  if (!context) {
    // Fall back to static MODELS for backward compatibility
    return MODELS;
  }
  return context;
};
