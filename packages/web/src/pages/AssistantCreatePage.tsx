import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  PiArrowLeft,
  PiPlus,
  PiTrash,
  PiGlobe,
  PiFile,
} from 'react-icons/pi';
import useBedrockChatApi, {
  BedrockChatBotInput,
} from '@/hooks/useBedrockChatApi';
import Button from '@/components/ui/Button';
import InputText from '@/components/ui/InputText';
import Textarea from '@/components/ui/Textarea';
import FileUploader from '@/components/feature/file/FileUploader';
import PageContainer from '@/components/layout/PageContainer';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/loading/Spinner';

const AssistantCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    createBot,
    getBotPresignedUrl,
    deleteBotUploadedFile,
  } = useBedrockChatApi();

  const tempBotId = useMemo(() => uuidv4(), []);
  const [saving, setSaving] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  const [formData, setFormData] = useState<BedrockChatBotInput>({
    id: tempBotId,
    title: '',
    description: '',
    instruction: '',
    generationParams: {
      maxTokens: 63991,
      temperature: 0.1,
      topP: 0.5,
      topK: 50,
    },
    knowledge: {
      sourceUrls: [],
      sitemapUrls: [],
      filenames: [],
      s3Urls: [],
    },
    displayRetrievedChunks: false,
    promptCachingEnabled: true,
    conversationQuickStarters: [],
  });

  const [newUrl, setNewUrl] = useState('');

  const handleSave = async () => {
    if (!formData.title || !formData.instruction) {
      alert('名前とカスタム指示は必須項目です');
      return;
    }

    setSaving(true);
    try {
      await createBot(formData);
      navigate('/chat/assistants');
    } catch (error) {
      console.error('Failed to save assistant:', error);
      alert('アシスタントの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { url } = await getBotPresignedUrl(
          tempBotId,
          file.name,
          file.type
        );

        await fetch(url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        setUploadedFiles((prev) => [...prev, file.name]);
        setFormData((prev) => ({
          ...prev,
          knowledge: {
            ...prev.knowledge!,
            filenames: [...prev.knowledge!.filenames, file.name],
          },
        }));
      } catch (error) {
        console.error('Failed to upload file:', error);
      }
    }
  };

  const handleDeleteFile = async (filename: string) => {
    try {
      await deleteBotUploadedFile(tempBotId, filename);
    } catch (error) {
      console.error('Failed to delete file:', error);
    }

    setUploadedFiles((prev) => prev.filter((f) => f !== filename));
    setFormData((prev) => ({
      ...prev,
      knowledge: {
        ...prev.knowledge!,
        filenames: prev.knowledge!.filenames.filter((f) => f !== filename),
      },
    }));
  };

  const addSourceUrl = () => {
    if (newUrl && formData.knowledge) {
      setFormData((prev) => ({
        ...prev,
        knowledge: {
          ...prev.knowledge!,
          sourceUrls: [...prev.knowledge!.sourceUrls, newUrl],
        },
      }));
      setNewUrl('');
    }
  };

  const removeSourceUrl = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      knowledge: {
        ...prev.knowledge!,
        sourceUrls: prev.knowledge!.sourceUrls.filter((_, i) => i !== index),
      },
    }));
  };

  return (
    <PageContainer>
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => navigate('/chat/assistants')}
            className="flex items-center gap-1 text-gray-500 transition-colors hover:text-gray-900">
            <PiArrowLeft className="text-xl" />
          </button>
          <h1 className="flex-1 text-2xl font-bold">
            アシスタントを作成
          </h1>
          <Button
            onClick={handleSave}
            disabled={saving}
            loading={saving}
            className="flex items-center gap-2">
            {saving ? (
              <>
                <Spinner size="sm" />
                保存中...
              </>
            ) : (
              '保存'
            )}
          </Button>
        </div>

        {/* Basic Info Section */}
        <Card label="基本情報" className="mb-4">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">
                名前 <span className="text-red-500">*</span>
              </label>
              <InputText
                value={formData.title}
                onChange={(value) =>
                  setFormData({ ...formData, title: value })
                }
                placeholder="社内規則QA"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                説明
              </label>
              <Textarea
                value={formData.description || ''}
                onChange={(value) =>
                  setFormData({ ...formData, description: value })
                }
                placeholder="社内規則に関する質問に答えます"
                rows={3}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                カスタム指示 <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={formData.instruction}
                onChange={(value) =>
                  setFormData({ ...formData, instruction: value })
                }
                placeholder="社内規則に関する質問に対して正確に回答します"
                rows={6}
                required
              />
            </div>
          </div>
        </Card>

        {/* Knowledge Section */}
        <Card label="ナレッジ" className="mb-4">
          <div className="space-y-6">
            {/* URL Input */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                URL
              </label>
              <div className="mb-2 flex gap-2">
                <InputText
                  value={newUrl}
                  onChange={setNewUrl}
                  placeholder="https://example.com"
                  className="flex-1"
                />
                <Button
                  onClick={addSourceUrl}
                  outlined
                  className="flex items-center gap-1">
                  <PiPlus />
                  追加
                </Button>
              </div>
              <div className="space-y-1">
                {formData.knowledge?.sourceUrls.map((url, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                    <PiGlobe className="text-gray-500" />
                    <span className="flex-1 truncate">{url}</span>
                    <button
                      onClick={() => removeSourceUrl(index)}
                      className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-500">
                      <PiTrash />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* File Upload */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                ファイルアップロード
              </label>
              <FileUploader
                onFileSelect={handleFileUpload}
                accept=".pdf,.txt,.doc,.docx,.md"
                multiple
              />
              <div className="mt-2 space-y-1">
                {uploadedFiles.map((filename) => (
                  <div
                    key={filename}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                    <PiFile className="text-gray-500" />
                    <span className="flex-1 truncate">{filename}</span>
                    <button
                      onClick={() => handleDeleteFile(filename)}
                      className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-500">
                      <PiTrash />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
};

export default AssistantCreatePage;
