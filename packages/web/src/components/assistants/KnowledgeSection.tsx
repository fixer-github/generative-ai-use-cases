import React from 'react';
import { useTranslation } from 'react-i18next';
import { PiPlus, PiTrash, PiGlobe, PiFile } from 'react-icons/pi';
import { KnowledgeSource } from 'generative-ai-use-cases';
import Button from '../Button';
import InputText from '../InputText';
import FileUploader from '../FileUploader';
import Alert from '../Alert';
import { UploadError } from '../../hooks/useAssistantForm';
import { ASSISTANT_LIMITS } from '../../constants/assistant';

export type KnowledgeSectionProps = {
  ragEnabled: boolean;
  knowledgeSources: KnowledgeSource[];
  newUrl: string;
  uploadingFiles: boolean;
  uploadError?: UploadError;
  saveError?: string | null;
  onClearUploadError?: () => void;
  onClearSaveError?: () => void;
  onNewUrlChange: (url: string) => void;
  onAddUrl: () => void;
  onRemoveSource: (index: number) => void;
  onFileUpload: (files: FileList) => Promise<void>;
  onDeleteFile: (sourceId: string) => void;
  disabled?: boolean;
};

const KnowledgeSection: React.FC<KnowledgeSectionProps> = ({
  ragEnabled,
  knowledgeSources,
  newUrl,
  uploadingFiles,
  uploadError,
  saveError,
  onClearUploadError,
  onClearSaveError,
  onNewUrlChange,
  onAddUrl,
  onRemoveSource,
  onFileUpload,
  onDeleteFile,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const maxSources = ASSISTANT_LIMITS.MAX_KNOWLEDGE_SOURCES;
  const currentSources = knowledgeSources.length;
  const limitReached = currentSources >= maxSources;
  const limitExceeded = currentSources > maxSources;
  const uploadErrorMessage = uploadError
    ? uploadError.messageKey === 'assistant.edit.uploadErrorCombined'
      ? t('assistant.edit.uploadErrorCombined', {
          sizeMessage: t('assistant.edit.uploadErrorSizeExceeded', {
            maxSize: uploadError.messageParams?.maxSize,
          }),
          limitMessage: t('assistant.edit.uploadErrorLimitExceeded', {
            max: uploadError.messageParams?.max,
          }),
        })
      : t(uploadError.messageKey, uploadError.messageParams)
    : '';

  if (!ragEnabled) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {t('assistant.edit.knowledgeSourcesCount', {
            current: currentSources,
            max: maxSources,
          })}
        </span>
        {limitReached && (
          <span className={limitExceeded ? 'text-red-600' : 'text-gray-500'}>
            {t('assistant.edit.knowledgeSourcesLimitReached', {
              max: maxSources,
            })}
          </span>
        )}
      </div>

      {saveError && (
        <Alert
          severity="error"
          onDissmiss={disabled ? undefined : onClearSaveError}>
          <div>{saveError}</div>
        </Alert>
      )}

      {uploadError && (
        <Alert
          severity="error"
          onDissmiss={disabled ? undefined : onClearUploadError}>
          <div>
            <span>{uploadErrorMessage}</span>
            {uploadError.files && uploadError.files.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {uploadError.files.map((file, index) => (
                  <li key={index}>
                    <span className="font-bold">{file.name}</span>
                    {file.size && (
                      <span className="ml-1 text-gray-600">({file.size})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Alert>
      )}

      <div>
        <label className="mb-2 text-sm font-medium">
          {t('assistant.edit.sourceUrls')}
        </label>
        {!disabled && (
          <div className="mb-2 flex gap-2">
            <InputText
              value={newUrl}
              onChange={onNewUrlChange}
              placeholder="https://example.com"
              className="flex-1"
              disabled={disabled || limitReached}
            />
            <Button
              onClick={onAddUrl}
              outlined
              disabled={disabled || limitReached}
              className="flex items-center gap-1">
              <PiPlus />
              {t('assistant.edit.add')}
            </Button>
          </div>
        )}
        <div className="space-y-1">
          {knowledgeSources
            .filter((ks) => ks.sourceType === 'url')
            .map((source) => {
              const actualIndex = knowledgeSources.indexOf(source);
              return (
                <div
                  key={actualIndex}
                  className="flex items-center gap-2 text-sm">
                  <PiGlobe className="text-gray-500" />
                  <span className="flex-1">
                    {source.sourceUrl || source.url || source.name}
                  </span>
                  {!disabled && (
                    <Button
                      outlined
                      className="text-sm"
                      onClick={() => onRemoveSource(actualIndex)}>
                      <PiTrash />
                    </Button>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <div>
        <label className="mb-2 text-sm font-medium">
          {t('assistant.edit.uploadFiles')}
        </label>
        {!disabled && (
          <>
            <FileUploader
              onFileSelect={onFileUpload}
              accept=".pdf,.txt,.md,.html,.json,.csv"
              multiple
              disabled={disabled || uploadingFiles || limitReached}
            />
            {uploadingFiles && (
              <p className="mt-2 text-sm text-blue-600">
                {t('assistant.edit.uploadingFiles')}
              </p>
            )}
          </>
        )}
        <div className="mt-2 space-y-1">
          {knowledgeSources
            .filter((ks) => ks.sourceType === 'file' || ks.type === 'file')
            .map((source) => {
              return (
                <div
                  key={source.id}
                  className="flex items-center gap-2 text-sm">
                  <PiFile className="text-gray-500" />
                  <span className="flex-1">
                    {source.displayName || source.name}
                  </span>
                  {source.status && (
                    <span
                      className={`text-xs ${
                        source.status === 'SUCCEEDED'
                          ? 'text-green-600'
                          : source.status === 'FAILED'
                            ? 'text-red-600'
                            : source.status === 'SYNCING'
                              ? 'text-blue-600'
                              : 'text-gray-600'
                      }`}>
                      {source.status}
                    </span>
                  )}
                  {!disabled && (
                    <Button
                      outlined
                      className="text-sm"
                      onClick={() => onDeleteFile(source.id!)}>
                      <PiTrash />
                    </Button>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeSection;
