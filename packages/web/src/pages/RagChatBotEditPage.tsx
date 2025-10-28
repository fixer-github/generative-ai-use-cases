import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PiArrowLeft,
  PiFloppyDisk,
  PiPlus,
  PiTrash,
  PiUploadSimple,
  PiFile,
  PiGlobe,
} from 'react-icons/pi';
import useAssistantApi from '../hooks/useAssistantApi';
import { MODELS } from '../hooks/useModel';
import type {
  CreateAssistantRequest,
  UpdateAssistantRequest,
  KnowledgeSource,
} from 'generative-ai-use-cases';
import Button from '../components/Button';
import InputText from '../components/InputText';
import Textarea from '../components/Textarea';
import Card from '../components/Card';
import LoadingWave from '../components/LoadingWave';
import Switch from '../components/Switch';
import axios from 'axios';

const ALLOWED_FILE_TYPES = [
  'text/plain',
  'text/html',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const StatusBadge: React.FC<{
  status: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED';
}> = ({ status }) => {
  const colors = {
    QUEUED: 'bg-gray-500',
    SYNCING: 'bg-blue-500',
    SUCCEEDED: 'bg-green-500',
    FAILED: 'bg-red-500',
  };

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-white ${colors[status]}`}>
      {status}
    </span>
  );
};

const RagChatBotEditPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { botId: assistantId } = useParams<{ botId?: string }>();
  const { getAssistant, createAssistant, updateAssistant, requestUploadUrl } =
    useAssistantApi();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditMode = !!assistantId;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [formData, setFormData] = useState<
    CreateAssistantRequest & { assistantId?: string }
  >({
    name: '',
    description: '',
    instruction: '',
    modelId: MODELS.textModels[0]?.modelId || '',
    ragEnabled: false,
    knowledgeSources: [],
  });

  const [legacyS3Urls, setLegacyS3Urls] = useState<string[]>([]);
  const [newWebUrl, setNewWebUrl] = useState('');
  const [knowledgeSourcesModified, setKnowledgeSourcesModified] = useState(false);

  useEffect(() => {
    if (isEditMode) {
      fetchAssistant();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId]);

  const fetchAssistant = async () => {
    if (!assistantId) return;

    setLoading(true);
    try {
      const assistant = await getAssistant(assistantId);

      // Store legacy s3Urls separately - don't convert to knowledgeSources
      // to prevent data loss on re-indexing
      setLegacyS3Urls(assistant.s3Urls || []);

      setFormData({
        assistantId: assistant.assistantId,
        name: assistant.name,
        description: assistant.description || '',
        instruction: assistant.instruction,
        modelId: assistant.modelId,
        ragEnabled: assistant.ragEnabled,
        knowledgeSources: assistant.knowledgeSources || [],
      });
    } catch (error) {
      console.error('Failed to fetch assistant:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.instruction) {
      alert(t('ragChatBot.edit.requiredFields'));
      return;
    }

    // Clean knowledgeSources to remove undefined optional fields
    const cleanKnowledgeSource = (source: KnowledgeSource) => {
      const cleaned: any = {
        id: source.id,
        type: source.type,
        displayName: source.displayName,
        status: source.status,
      };
      if (source.storageKey) cleaned.storageKey = source.storageKey;
      if (source.sourceUrl) cleaned.sourceUrl = source.sourceUrl;
      if (source.error) cleaned.error = source.error;
      return cleaned;
    };

    setSaving(true);
    try {
      if (isEditMode && assistantId) {
        const updateData: UpdateAssistantRequest = {
          name: formData.name,
          description: formData.description,
          instruction: formData.instruction,
          modelId: formData.modelId,
          ragEnabled: formData.ragEnabled,
          // Include knowledgeSources if:
          // 1. User modified the field (even if empty - allows removing last source)
          // 2. OR there are actual sources (for initial non-empty state)
          // Don't send if unmodified and empty (preserves legacy s3Urls-only assistants)
          ...(knowledgeSourcesModified || (formData.knowledgeSources?.length ?? 0) > 0
            ? {
                knowledgeSources: (formData.knowledgeSources || []).map(
                  cleanKnowledgeSource
                ),
              }
            : {}),
          // Preserve legacy s3Urls for backward compatibility (only if not empty)
          ...(legacyS3Urls.length > 0 && { s3Urls: legacyS3Urls }),
        };
        await updateAssistant(assistantId, updateData);
      } else {
        const createData: CreateAssistantRequest = {
          name: formData.name,
          description: formData.description,
          instruction: formData.instruction,
          modelId: formData.modelId,
          ragEnabled: formData.ragEnabled,
          knowledgeSources: (formData.knowledgeSources || []).map(
            cleanKnowledgeSource
          ),
        };
        await createAssistant(createData);
      }
      navigate('/rag-chat-bot');
    } catch (error) {
      console.error('Failed to save assistant:', error);
      alert(t('ragChatBot.edit.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      alert(
        `Invalid file type. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`
      );
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      alert(`File size exceeds 10MB limit`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Step 1: Request pre-signed URL
      const { uploadUrl, storageKey } = await requestUploadUrl(
        file.name,
        file.size,
        file.type
      );

      // Step 2: Upload file to S3
      await axios.put(uploadUrl, file, {
        headers: {
          'Content-Type': file.type,
        },
        onUploadProgress: (progressEvent) => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0;
          setUploadProgress(progress);
        },
      });

      // Step 3: Add to knowledge sources
      const newSource: KnowledgeSource = {
        id: crypto.randomUUID(),
        type: 'file',
        displayName: file.name,
        storageKey,
        status: 'QUEUED',
      };

      setFormData((prev) => ({
        ...prev,
        knowledgeSources: [...(prev.knowledgeSources || []), newSource],
      }));
      setKnowledgeSourcesModified(true);
    } catch (error) {
      console.error('File upload failed:', error);
      alert('File upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const addWebUrl = () => {
    if (!newWebUrl) return;

    // Validate URL format
    if (!newWebUrl.startsWith('http://') && !newWebUrl.startsWith('https://')) {
      alert('URL must start with http:// or https://');
      return;
    }

    const newSource: KnowledgeSource = {
      id: crypto.randomUUID(),
      type: 'web',
      displayName: newWebUrl,
      sourceUrl: newWebUrl,
      status: 'QUEUED',
    };

    setFormData((prev) => ({
      ...prev,
      knowledgeSources: [...(prev.knowledgeSources || []), newSource],
    }));
    setKnowledgeSourcesModified(true);
    setNewWebUrl('');
  };

  const removeKnowledgeSource = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      knowledgeSources:
        prev.knowledgeSources?.filter((source) => source.id !== id) || [],
    }));
    setKnowledgeSourcesModified(true);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingWave />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4">
        <Button
          outlined
          onClick={() => navigate('/rag-chat-bot')}
          className="flex items-center gap-1">
          <PiArrowLeft />
          {t('ragChatBot.edit.back')}
        </Button>
        <h1 className="flex-1 text-2xl font-bold">
          {isEditMode
            ? t('ragChatBot.edit.editTitle')
            : t('ragChatBot.edit.createTitle')}
        </h1>
      </div>

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-semibold">
          {t('ragChatBot.edit.basicInfo')}
        </h2>

        <div className="space-y-4">
          <InputText
            label={t('ragChatBot.edit.title')}
            value={formData.name}
            onChange={(value) => setFormData({ ...formData, name: value })}
            required
          />

          <Textarea
            label={t('ragChatBot.edit.description')}
            value={formData.description || ''}
            onChange={(value) =>
              setFormData({ ...formData, description: value })
            }
            rows={3}
          />

          <Textarea
            label={t('ragChatBot.edit.instruction')}
            value={formData.instruction}
            onChange={(value) =>
              setFormData({ ...formData, instruction: value })
            }
            rows={6}
            required
          />

          <div>
            <label className="mb-2 block text-sm font-medium">
              {t('ragChatBot.edit.model', 'Model')}
            </label>
            <select
              value={formData.modelId}
              onChange={(e) =>
                setFormData({ ...formData, modelId: e.target.value })
              }
              className="w-full rounded border border-black/30 p-2 outline-none">
              {MODELS.textModels.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {MODELS.modelDisplayName(model.modelId)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Switch
              checked={formData.ragEnabled}
              onSwitch={(checked) =>
                setFormData({ ...formData, ragEnabled: checked })
              }
              label={t('ragChatBot.edit.ragEnabled', 'Enable RAG')}
            />
          </div>
        </div>
      </Card>

      {formData.ragEnabled && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold">
            {t('ragChatBot.edit.knowledge', 'Knowledge Sources')}
          </h2>

          <div className="space-y-6">
            {/* File Upload Section */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                Upload File
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.html,.md,.csv,.json,.pdf"
                onChange={handleFileSelect}
                disabled={uploading}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                outlined
                className="flex items-center gap-2">
                <PiUploadSimple />
                {uploading
                  ? `Uploading... ${uploadProgress}%`
                  : 'Choose File'}
              </Button>
              <p className="mt-1 text-xs text-gray-500">
                Supported: .txt, .html, .md, .csv, .json, .pdf (max 10MB)
              </p>
            </div>

            {/* Web URL Section */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                Add Web URL
              </label>
              <div className="flex gap-2">
                <InputText
                  value={newWebUrl}
                  onChange={setNewWebUrl}
                  placeholder="https://example.com/page"
                  className="flex-1"
                />
                <Button
                  onClick={addWebUrl}
                  outlined
                  className="flex items-center gap-1">
                  <PiPlus />
                  Add
                </Button>
              </div>
            </div>

            {/* Knowledge Sources Table */}
            {((formData.knowledgeSources?.length ?? 0) > 0 ||
              legacyS3Urls.length > 0) && (
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Current Knowledge Sources
                </h3>
                <div className="overflow-hidden rounded border border-black/30">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Type
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Name
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Status
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {/* New knowledge sources */}
                      {(formData.knowledgeSources || []).map((source) => (
                        <tr key={source.id}>
                          <td className="px-4 py-3">
                            {source.type === 'file' ? (
                              <PiFile className="text-blue-600" size={20} />
                            ) : (
                              <PiGlobe className="text-green-600" size={20} />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="max-w-md">
                              <p className="truncate text-sm">
                                {source.displayName}
                              </p>
                              {source.error && (
                                <p className="text-xs text-red-600">
                                  {source.error}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={source.status} />
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              outlined
                              className="text-sm"
                              onClick={() =>
                                removeKnowledgeSource(source.id)
                              }>
                              <PiTrash />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {/* Legacy s3Urls - read-only */}
                      {legacyS3Urls.map((url, index) => (
                        <tr
                          key={`legacy-${index}`}
                          className="bg-yellow-50">
                          <td className="px-4 py-3">
                            <PiFile className="text-orange-600" size={20} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="max-w-md">
                              <p className="truncate text-sm font-mono text-xs">
                                {url}
                              </p>
                              <p className="text-xs text-orange-600">
                                Legacy S3 URL (read-only)
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status="SUCCEEDED" />
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-500">
                              Read-only
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button outlined onClick={() => navigate('/rag-chat-bot')}>
          {t('ragChatBot.edit.cancel')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1">
          <PiFloppyDisk />
          {saving ? t('ragChatBot.edit.saving') : t('ragChatBot.edit.save')}
        </Button>
      </div>
    </div>
  );
};

export default RagChatBotEditPage;
