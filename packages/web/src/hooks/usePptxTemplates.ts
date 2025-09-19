import { useState, useCallback } from 'react';
import useHttp from './useHttp';
import {
  PptxTemplate,
  PptxTemplateInput,
  PptxTemplateListResponse,
  PptxPresignedUrl,
} from '../@types/pptx';

export const usePptxTemplates = () => {
  const http = useHttp();
  const [templates, setTemplates] = useState<PptxTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(
    async (includePublic = true, userOnly = false): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await http.api.get<PptxTemplateListResponse>(
          `pptx/template?include_public=${includePublic}&user_only=${userOnly}&limit=100`
        );
        if (response.data?.templates) {
          setTemplates(response.data.templates);
        }
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to load templates');
      } finally {
        setIsLoading(false);
      }
    },
    [http]
  );

  const uploadTemplate = useCallback(
    async (file: File, templateData: PptxTemplateInput): Promise<boolean> => {
      setError(null);

      try {
        // Step 1: Get presigned URL for upload
        const urlResponse = await http.api.post<PptxPresignedUrl>(
          `pptx/template/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(file.type)}`,
          {}
        );

        const { upload_url, s3_key } = urlResponse.data;

        // Step 2: Upload file to S3
        const uploadResponse = await fetch(upload_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload file to S3');
        }

        // Step 3: Register template
        await http.api.post<PptxTemplate>(
          `pptx/template?s3_key=${encodeURIComponent(s3_key)}`,
          templateData
        );

        return true;
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to upload template');
        return false;
      }
    },
    [http]
  );

  const deleteTemplate = useCallback(
    async (templateId: string): Promise<boolean> => {
      setError(null);

      try {
        await http.api.delete(`pptx/template/${templateId}`);
        
        // Remove from local state
        setTemplates(prev => prev.filter(t => t.template_id !== templateId));
        
        return true;
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to delete template');
        return false;
      }
    },
    [http]
  );

  return {
    templates,
    loadTemplates,
    uploadTemplate,
    deleteTemplate,
    isLoading,
    error,
  };
};