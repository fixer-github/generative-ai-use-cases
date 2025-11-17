import React from 'react';
import { Assistant } from 'generative-ai-use-cases';
import Card from '../Card';
import { useTranslation } from 'react-i18next';
import { getStatusInfo } from './statusMetadata';

type Props = {
  assistant: Assistant;
  className?: string;
};

/**
 * AssistantInfoPanel - Display assistant configuration and status information
 */
const AssistantInfoPanel: React.FC<Props> = ({ assistant, className = '' }) => {
  const { t } = useTranslation();
  const statusInfo = assistant.ragEnabled
    ? getStatusInfo(assistant.syncStatus)
    : null;

  return (
    <Card className={`p-4 ${className}`}>
      <h3 className="mb-3 font-semibold text-gray-900">
        {t('assistant.chatPage.assistantInfo')}
      </h3>
      <div className="space-y-3 text-sm">
        {/* Instruction */}
        <div>
          <div className="font-medium text-gray-700">
            {t('assistant.chatPage.instruction')}
          </div>
          <div className="mt-1 text-gray-600">{assistant.instruction}</div>
        </div>

        {/* Model */}
        <div>
          <div className="font-medium text-gray-700">Model</div>
          <div className="mt-1 text-gray-600">{assistant.modelId}</div>
        </div>

        {/* RAG Status */}
        {assistant.ragEnabled && (
          <>
            <div>
              <div className="font-medium text-gray-700">
                {t('assistant.chatPage.syncStatus')}
              </div>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${statusInfo?.color} ${statusInfo?.textColor}`}>
                  {statusInfo?.icon} {t(statusInfo?.labelKey || '')}
                </span>
              </div>
            </div>

            {/* Knowledge Sources */}
            {assistant.knowledgeSources &&
              assistant.knowledgeSources.length > 0 && (
                <div>
                  <div className="font-medium text-gray-700">
                    {t('assistant.knowledgeSources')}
                  </div>
                  <div className="mt-1 space-y-1">
                    {assistant.knowledgeSources.map((source, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
                        {source.name ||
                          source.displayName ||
                          `Source ${idx + 1}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* RAG Enabled Badge */}
            <div className="pt-2">
              <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                ✓ RAG Enabled
              </span>
            </div>
          </>
        )}

        {!assistant.ragEnabled && (
          <div className="pt-2">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              RAG Disabled
            </span>
          </div>
        )}
      </div>
    </Card>
  );
};

export default AssistantInfoPanel;
