import { useState, useCallback } from 'react';
import { KnowledgeSource } from 'generative-ai-use-cases';
import useAssistantApi from './useAssistantApi';
import { MODELS } from './useModel';
import { ASSISTANT_LIMITS } from '../constants/assistant';

export type AssistantFormData = {
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
  visibility: 'private' | 'public';
  knowledgeSources: KnowledgeSource[];
};

export type UseAssistantFormOptions = {
  initialData?: Partial<AssistantFormData>;
};

export type UploadErrorFile = {
  name: string;
  size: string;
};

export type UploadError = {
  type: 'size_exceeded' | 'limit_exceeded' | 'upload_failed';
  messageKey: string;
  messageParams?: Record<string, string | number>;
  files?: UploadErrorFile[];
} | null;

export type UseAssistantFormReturn = {
  formData: AssistantFormData;
  setFormData: React.Dispatch<React.SetStateAction<AssistantFormData>>;
  newUrl: string;
  setNewUrl: React.Dispatch<React.SetStateAction<string>>;
  uploadingFiles: boolean;
  uploadError: UploadError;
  clearUploadError: () => void;
  addKnowledgeUrl: () => void;
  removeKnowledgeSource: (index: number) => void;
  handleFileUpload: (files: FileList) => Promise<void>;
  deleteFile: (s3Url: string) => void;
  isValid: () => boolean;
  resetForm: () => void;
};

const getInitialFormData = (
  initialData?: Partial<AssistantFormData>
): AssistantFormData => ({
  name: initialData?.name || '',
  description: initialData?.description || '',
  instruction: initialData?.instruction || '',
  modelId:
    initialData?.modelId ||
    MODELS.modelIds[0] ||
    'anthropic.claude-3-5-sonnet-20241022-v2:0',
  ragEnabled: initialData?.ragEnabled || false,
  visibility: initialData?.visibility || 'private',
  knowledgeSources: initialData?.knowledgeSources || [],
});

/**
 * Get the correct MIME type for a file based on extension.
 * Browsers don't always correctly detect MIME types for text files like .md
 */
const getContentType = (file: File): string => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    md: 'text/markdown',
    txt: 'text/plain',
    pdf: 'application/pdf',
    html: 'text/html',
    json: 'application/json',
    csv: 'text/csv',
  };

  if (extension && mimeTypes[extension]) {
    return mimeTypes[extension];
  }

  if (file.type) return file.type;

  return 'application/octet-stream';
};

const useAssistantForm = (
  options: UseAssistantFormOptions = {}
): UseAssistantFormReturn => {
  const { requestUploadUrl } = useAssistantApi();
  const [formData, setFormData] = useState<AssistantFormData>(() =>
    getInitialFormData(options.initialData)
  );
  const [newUrl, setNewUrl] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<UploadError>(null);

  const clearUploadError = useCallback(() => {
    setUploadError(null);
  }, []);

  const addKnowledgeUrl = useCallback(() => {
    if (newUrl.trim()) {
      const maxSources = ASSISTANT_LIMITS.MAX_KNOWLEDGE_SOURCES;
      if (formData.knowledgeSources.length >= maxSources) {
        setUploadError({
          type: 'limit_exceeded',
          messageKey: 'assistant.edit.knowledgeSourcesOverLimit',
          messageParams: { max: maxSources },
        });
        return;
      }

      const newSource: KnowledgeSource = {
        id: crypto.randomUUID(),
        type: 'web',
        sourceType: 'url',
        name: newUrl,
        displayName: newUrl,
        sourceUrl: newUrl,
      };
      setFormData((prev) => ({
        ...prev,
        knowledgeSources: [...prev.knowledgeSources, newSource],
      }));
      setNewUrl('');
      setUploadError(null);
    }
  }, [newUrl, formData.knowledgeSources.length]);

  const removeKnowledgeSource = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      knowledgeSources: prev.knowledgeSources.filter((_, i) => i !== index),
    }));
  }, []);

  const handleFileUpload = useCallback(
    async (files: FileList) => {
      // エラーをクリア
      setUploadError(null);

      // ファイルサイズの上限チェック（サイズ超過ファイルとアップロード可能ファイルを分類）
      const maxSizeMB = ASSISTANT_LIMITS.MAX_FILE_SIZE / (1024 * 1024);
      const maxSources = ASSISTANT_LIMITS.MAX_KNOWLEDGE_SOURCES;
      const currentSources = formData.knowledgeSources.length;
      const availableSlots = Math.max(0, maxSources - currentSources);

      if (availableSlots === 0) {
        setUploadError({
          type: 'limit_exceeded',
          messageKey: 'assistant.edit.knowledgeSourcesOverLimit',
          messageParams: { max: maxSources },
        });
        return;
      }

      const oversizedFiles: UploadErrorFile[] = [];
      const exceededFiles: UploadErrorFile[] = [];
      const validFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        if (files[i].size > ASSISTANT_LIMITS.MAX_FILE_SIZE) {
          oversizedFiles.push({
            name: files[i].name,
            size: `${(files[i].size / (1024 * 1024)).toFixed(1)}MB`,
          });
        } else if (validFiles.length < availableSlots) {
          validFiles.push(files[i]);
        } else {
          exceededFiles.push({
            name: files[i].name,
            size: '件数上限超過',
          });
        }
      }

      // サイズ超過ファイルがある場合はエラーを設定
      if (oversizedFiles.length > 0 || exceededFiles.length > 0) {
        setUploadError({
          type: exceededFiles.length > 0 ? 'limit_exceeded' : 'size_exceeded',
          messageKey:
            oversizedFiles.length > 0 && exceededFiles.length > 0
              ? 'assistant.edit.uploadErrorCombined'
              : oversizedFiles.length > 0
                ? 'assistant.edit.uploadErrorSizeExceeded'
                : 'assistant.edit.uploadErrorLimitExceeded',
          messageParams: {
            maxSize: maxSizeMB,
            max: maxSources,
          },
          files: [...oversizedFiles, ...exceededFiles],
        });
      }

      // アップロード可能なファイルがない場合は終了
      if (validFiles.length === 0) {
        return;
      }

      setUploadingFiles(true);
      try {
        for (const file of validFiles) {
          try {
            const contentType = getContentType(file);

            // Request upload URL
            const { uploadUrl, fileKey } = await requestUploadUrl({
              fileName: file.name,
              fileSize: file.size,
              contentType,
            });

            // Upload file to S3
            await fetch(uploadUrl, {
              method: 'PUT',
              body: file,
              headers: {
                'Content-Type': contentType,
              },
            });

            // Add file to knowledge sources with proper structure
            const newSource: KnowledgeSource = {
              id: crypto.randomUUID(),
              type: 'file',
              sourceType: 'file',
              name: file.name,
              displayName: file.name,
              storageKey: fileKey,
            };

            setFormData((prev) => ({
              ...prev,
              knowledgeSources: [...prev.knowledgeSources, newSource],
            }));
          } catch (error) {
            console.error('Failed to upload file:', error);
            setUploadError({
              type: 'upload_failed',
              messageKey: 'assistant.edit.uploadFailed',
              files: [{ name: file.name, size: '' }],
            });
          }
        }
      } finally {
        setUploadingFiles(false);
      }
    },
    [requestUploadUrl, formData.knowledgeSources.length]
  );

  const deleteFile = useCallback((sourceId: string) => {
    setFormData((prev) => ({
      ...prev,
      knowledgeSources: prev.knowledgeSources.filter(
        (ks) => ks.id !== sourceId
      ),
    }));
  }, []);

  const isValid = useCallback(() => {
    return !!formData.name.trim() && !!formData.instruction.trim();
  }, [formData.name, formData.instruction]);

  const resetForm = useCallback(() => {
    setFormData(getInitialFormData(options.initialData));
    setNewUrl('');
  }, [options.initialData]);

  return {
    formData,
    setFormData,
    newUrl,
    setNewUrl,
    uploadingFiles,
    uploadError,
    clearUploadError,
    addKnowledgeUrl,
    removeKnowledgeSource,
    handleFileUpload,
    deleteFile,
    isValid,
    resetForm,
  };
};

export default useAssistantForm;
