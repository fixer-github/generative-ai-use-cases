import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PiArrowLeft, PiFloppyDisk, PiPlus, PiTrash } from 'react-icons/pi';
import useAssistantApi from '../hooks/useAssistantApi';
import type {
  CreateAssistantRequest,
  UpdateAssistantRequest,
} from 'generative-ai-use-cases';
import Button from '../components/Button';
import InputText from '../components/InputText';
import Textarea from '../components/Textarea';
import Card from '../components/Card';
import LoadingWave from '../components/LoadingWave';
import Switch from '../components/Switch';

const RagChatBotEditPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { botId: assistantId } = useParams<{ botId?: string }>();
  const { getAssistant, createAssistant, updateAssistant } = useAssistantApi();

  const isEditMode = !!assistantId;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState<
    CreateAssistantRequest & { assistantId?: string }
  >({
    name: '',
    description: '',
    instruction: '',
    modelId: 'anthropic.claude-v4-sonnet',
    ragEnabled: false,
    s3Urls: [],
  });

  const [newS3Url, setNewS3Url] = useState('');

  useEffect(() => {
    if (isEditMode) {
      fetchAssistant();
    }
  }, [assistantId]);

  const fetchAssistant = async () => {
    if (!assistantId) return;

    setLoading(true);
    try {
      const assistant = await getAssistant(assistantId);
      setFormData({
        assistantId: assistant.assistantId,
        name: assistant.name,
        description: assistant.description || '',
        instruction: assistant.instruction,
        modelId: assistant.modelId,
        ragEnabled: assistant.ragEnabled,
        s3Urls: assistant.s3Urls || [],
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

    setSaving(true);
    try {
      if (isEditMode && assistantId) {
        const updateData: UpdateAssistantRequest = {
          name: formData.name,
          description: formData.description,
          instruction: formData.instruction,
          modelId: formData.modelId,
          ragEnabled: formData.ragEnabled,
          s3Urls: formData.s3Urls,
        };
        await updateAssistant(assistantId, updateData);
      } else {
        const createData: CreateAssistantRequest = {
          name: formData.name,
          description: formData.description,
          instruction: formData.instruction,
          modelId: formData.modelId,
          ragEnabled: formData.ragEnabled,
          s3Urls: formData.s3Urls,
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

  const addS3Url = () => {
    if (newS3Url) {
      setFormData(
        (prev: CreateAssistantRequest & { assistantId?: string }) => ({
          ...prev,
          s3Urls: [...(prev.s3Urls || []), newS3Url],
        })
      );
      setNewS3Url('');
    }
  };

  const removeS3Url = (index: number) => {
    setFormData(
      (prev: CreateAssistantRequest & { assistantId?: string }) => ({
        ...prev,
        s3Urls: prev.s3Urls?.filter((_: string, i: number) => i !== index) || [],
      })
    );
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
              <option value="anthropic.claude-v4-sonnet">
                Claude 4 Sonnet
              </option>
              <option value="anthropic.claude-v3-5-sonnet">
                Claude 3.5 Sonnet
              </option>
              <option value="anthropic.claude-v3-opus">Claude 3 Opus</option>
              <option value="anthropic.claude-v3-haiku">Claude 3 Haiku</option>
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
            {t('ragChatBot.edit.knowledge')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">
                {t('ragChatBot.edit.s3Urls', 'S3 URLs')}
              </label>
              <div className="mb-2 flex gap-2">
                <InputText
                  value={newS3Url}
                  onChange={setNewS3Url}
                  placeholder="s3://bucket/path/to/file"
                  className="flex-1"
                />
                <Button
                  onClick={addS3Url}
                  outlined
                  className="flex items-center gap-1">
                  <PiPlus />
                  {t('ragChatBot.edit.add')}
                </Button>
              </div>
              <div className="space-y-1">
                {formData.s3Urls?.map((url: string, index: number) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-mono text-xs">{url}</span>
                    <Button
                      outlined
                      className="text-sm"
                      onClick={() => removeS3Url(index)}>
                      <PiTrash />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
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
