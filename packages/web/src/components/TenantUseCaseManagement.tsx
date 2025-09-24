import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PiGear, PiFloppyDisk, PiArrowClockwise, PiInfo } from 'react-icons/pi';
import { HiddenUseCasesKeys } from 'generative-ai-use-cases';
import { TenantUseCaseConfigResponse } from 'generative-ai-use-cases-types';
import Button from './Button';
import Switch from './Switch';
import Alert from './Alert';
import LoadingOverlay from './LoadingOverlay';
import useHttp from '../hooks/useHttp';

interface TenantUseCaseManagementProps {
  className?: string;
}

// Use case definitions with display names and descriptions
const USE_CASE_DEFINITIONS: Record<HiddenUseCasesKeys, { name: string; description: string }> = {
  generate: { 
    name: 'useCases.generate', 
    description: 'useCases.generateDescription' 
  },
  summarize: { 
    name: 'useCases.summarize', 
    description: 'useCases.summarizeDescription' 
  },
  writer: { 
    name: 'useCases.writer', 
    description: 'useCases.writerDescription' 
  },
  translate: { 
    name: 'useCases.translate', 
    description: 'useCases.translateDescription' 
  },
  webContent: { 
    name: 'useCases.webContent', 
    description: 'useCases.webContentDescription' 
  },
  image: { 
    name: 'useCases.image', 
    description: 'useCases.imageDescription' 
  },
  video: { 
    name: 'useCases.video', 
    description: 'useCases.videoDescription' 
  },
  videoAnalyzer: { 
    name: 'useCases.videoAnalyzer', 
    description: 'useCases.videoAnalyzerDescription' 
  },
  diagram: { 
    name: 'useCases.diagram', 
    description: 'useCases.diagramDescription' 
  },
  meetingMinutes: { 
    name: 'useCases.meetingMinutes', 
    description: 'useCases.meetingMinutesDescription' 
  },
  voiceChat: { 
    name: 'useCases.voiceChat', 
    description: 'useCases.voiceChatDescription' 
  },
};

const TenantUseCaseManagement: React.FC<TenantUseCaseManagementProps> = ({ className }) => {
  const { t } = useTranslation();
  const { api } = useHttp();

  const [config, setConfig] = useState<TenantUseCaseConfigResponse | null>(null);
  const [localConfig, setLocalConfig] = useState<HiddenUseCases>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadConfiguration = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get<TenantUseCaseConfigResponse>('/admin/use-case-config');
      
      if (response.data) {
        setConfig(response.data);
        setLocalConfig(response.data.hiddenUseCases);
      }
    } catch (err) {
      console.error('Failed to load use case configuration:', err);
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveConfiguration = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      await api.put('/admin/use-case-config', {
        hiddenUseCases: localConfig,
      });

      setSuccessMessage(t('adminPortal.useCaseManagement.saveSuccess'));
      
      // Reload configuration to get updated data
      await loadConfiguration();
    } catch (err) {
      console.error('Failed to save use case configuration:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const resetToGlobal = () => {
    if (config?.globalHiddenUseCases) {
      setLocalConfig(config.globalHiddenUseCases);
    }
  };

  const toggleUseCase = (useCase: HiddenUseCasesKeys) => {
    setLocalConfig(prev => ({
      ...prev,
      [useCase]: !prev[useCase],
    }));
  };

  const hasChanges = JSON.stringify(localConfig) !== JSON.stringify(config?.hiddenUseCases || {});

  useEffect(() => {
    loadConfiguration();
  }, []);

  if (loading) {
    return <LoadingOverlay>{t('common.loading')}</LoadingOverlay>;
  }

  return (
    <div className={`rounded-lg bg-white shadow ${className}`}>
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <PiGear className="mr-2 h-6 w-6 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {t('adminPortal.useCaseManagement.title')}
            </h2>
          </div>
          <div className="flex space-x-2">
            {config?.globalHiddenUseCases && (
              <Button
                outlined={true}
                onClick={resetToGlobal}
                disabled={saving}
                className="text-sm">
                <PiArrowClockwise className="mr-1 h-4 w-4" />
                {t('adminPortal.useCaseManagement.resetToGlobal')}
              </Button>
            )}
            <Button
              onClick={saveConfiguration}
              disabled={!hasChanges || saving}
              loading={saving}
              className="text-sm">
              <PiFloppyDisk className="mr-1 h-4 w-4" />
              {t('adminPortal.useCaseManagement.saveChanges')}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-6">
            <Alert severity="error" className="w-full">
              {error}
            </Alert>
          </div>
        )}

        {successMessage && (
          <div className="mb-6">
            <Alert severity="info" className="w-full">
              {successMessage}
            </Alert>
          </div>
        )}

        <div className="mb-6">
          <div className="flex items-center space-x-2 rounded-lg bg-blue-50 p-3">
            <PiInfo className="h-5 w-5 text-blue-600" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">
                {t('adminPortal.useCaseManagement.infoTitle')}
              </p>
              <p>
                {t('adminPortal.useCaseManagement.infoDescription', {
                  source: config?.source || 'unknown',
                  tenantId: config?.tenantId || 'N/A',
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {Object.entries(USE_CASE_DEFINITIONS).map(([useCase, definition]) => {
            const key = useCase as HiddenUseCasesKeys;
            const isHidden = localConfig[key] || false;
            const isEnabled = !isHidden;

            return (
              <div
                key={useCase}
                className="flex items-center justify-between rounded-lg border p-4 hover:bg-gray-50">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">
                    {t(definition.name)}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {t(definition.description)}
                  </p>
                </div>
                <div className="ml-4 flex items-center space-x-2">
                  <span className={`text-sm ${isEnabled ? 'text-green-600' : 'text-red-600'}`}>
                    {isEnabled ? t('adminPortal.useCaseManagement.enabled') : t('adminPortal.useCaseManagement.disabled')}
                  </span>
                  <Switch
                    checked={isEnabled}
                    onSwitch={() => toggleUseCase(key)}
                    label=""
                  />
                </div>
              </div>
            );
          })}
        </div>

        {hasChanges && (
          <div className="mt-6 rounded-lg bg-yellow-50 p-4">
            <p className="text-sm text-yellow-800">
              {t('adminPortal.useCaseManagement.unsavedChanges')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantUseCaseManagement;