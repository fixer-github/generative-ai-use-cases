import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import Card from '@/components/ui/Card';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
import Markdown from '@/components/utility/Markdown';
import ButtonCopy from '@/components/feature/feedback/ButtonCopy';
import useOptimizePrompt from '@/hooks/useOptimizePrompt';
import { MODELS } from '@/hooks/useModel';
import PageContainer from '@/components/layout/PageContainer';
import ActionButtonGroup from '@/components/ui/ActionButtonGroup';
import Spinner from '@/components/ui/loading/Spinner';

type StateType = {
  prompt: string;
  setPrompt: (s: string) => void;
  modelId: string;
  setModelId: (s: string) => void;
  optimizedPrompt: string;
  setOptimizedPrompt: (s: string) => void;
  clear: () => void;
};

const useOptimizePromptState = create<StateType>((set, get) => {
  const INIT_STATE = {
    prompt: '',
    modelId: '',
    optimizedPrompt: '',
  };

  return {
    ...INIT_STATE,
    setPrompt: (p: string) => {
      set(() => ({
        prompt: p,
      }));
    },
    setModelId: (m: string) => {
      set(() => ({
        modelId: m,
      }));
    },
    setOptimizedPrompt: (p: string) => {
      set(() => ({
        optimizedPrompt: p,
      }));
    },
    clear: () => {
      set({
        ...INIT_STATE,
        modelId: get().modelId,
      });
    },
  };
});

const OptimizePromptPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    prompt,
    setPrompt,
    modelId,
    setModelId,
    optimizedPrompt,
    setOptimizedPrompt,
    clear,
  } = useOptimizePromptState();
  const { supportedModelIds, optimizePrompt } = useOptimizePrompt();
  const [loading, setLoading] = useState(false);
  const { modelDisplayName } = MODELS;

  useEffect(() => {
    // If supportedModelIds is 0, this page will be disabled
    // index out of range will not occur
    setModelId(supportedModelIds[0]);
  }, [supportedModelIds, setModelId]);

  const onClickExec = useCallback(async () => {
    if (loading) return;

    setLoading(true);

    try {
      const stream = optimizePrompt({ prompt, targetModelId: modelId });

      let tmpOptimizedPrompt = '';

      for await (const chunk of stream) {
        tmpOptimizedPrompt += chunk;
      }

      tmpOptimizedPrompt = JSON.parse(tmpOptimizedPrompt);

      setOptimizedPrompt(tmpOptimizedPrompt);
    } catch (e) {
      console.error(e);

      setOptimizedPrompt(`${e}`);
    } finally {
      setLoading(false);
    }
  }, [
    loading,
    setLoading,
    optimizePrompt,
    prompt,
    modelId,
    setOptimizedPrompt,
  ]);

  const disabledExec = useMemo(() => {
    return prompt === '' || loading;
  }, [prompt, loading]);

  return (
    <PageContainer title={t('optimizePrompt.title')}>
      <Card>
          <Select
            value={modelId}
            onChange={setModelId}
            options={supportedModelIds.map((m) => {
              return { value: m, label: modelDisplayName(m) };
            })}
          />
          <div className="flex w-full flex-col lg:flex-row">
            <div className="w-full lg:w-1/2">
              <Textarea
                placeholder={t('optimizePrompt.input_placeholder')}
                value={prompt}
                onChange={setPrompt}
                maxHeight={-1}
                rows={5}
              />
            </div>
            <div className="w-full lg:ml-2 lg:w-1/2">
              <div className="rounded-md border border-gray-200 bg-white p-1.5">
                <Markdown>{optimizedPrompt}</Markdown>
                {loading && (
                  <div className="flex items-center justify-center py-4">
                    <Spinner />
                  </div>
                )}
                {!loading && optimizedPrompt === '' && (
                  <div className="text-gray-500">
                    {t('optimizePrompt.result_placeholder')}
                  </div>
                )}
                <div className="flex w-full justify-end">
                  <ButtonCopy
                    text={optimizedPrompt}
                    interUseCasesKey="optimizePrompt"></ButtonCopy>
                </div>
              </div>

              <ActionButtonGroup
                onExecute={onClickExec}
                onClear={clear}
                disabled={disabledExec}
                loading={loading}
                executeLabel={t('optimizePrompt.execute')}
                clearLabel={t('optimizePrompt.clear')}
                className="mt-3"
              />
            </div>
          </div>
        </Card>
    </PageContainer>
  );
};

export default OptimizePromptPage;
