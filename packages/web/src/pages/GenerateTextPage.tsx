import React, { useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
import useChat from '@/hooks/useChat';
import useTyping from '@/hooks/useTyping';
import { create } from 'zustand';
import { GenerateTextPageQueryParams } from '@/@types/navigate';
import { MODELS } from '@/hooks/useModel';
import { getPrompter } from '@/prompts';
import queryString from 'query-string';
import PageContainer from '@/components/layout/PageContainer';
import ActionButtonGroup from '@/components/ui/ActionButtonGroup';
import ResultDisplay from '@/components/feature/result/ResultDisplay';

type StateType = {
  information: string;
  setInformation: (s: string) => void;
  context: string;
  setContext: (s: string) => void;
  text: string;
  setText: (s: string) => void;
  clear: () => void;
};

const useGenerateTextPageState = create<StateType>((set) => {
  const INIT_STATE = {
    information: '',
    context: '',
    text: '',
  };
  return {
    ...INIT_STATE,
    setInformation: (s: string) => {
      set(() => ({
        information: s,
      }));
    },
    setContext: (s: string) => {
      set(() => ({
        context: s,
      }));
    },
    setText: (s: string) => {
      set(() => ({
        text: s,
      }));
    },
    clear: () => {
      set(INIT_STATE);
    },
  };
});

const GenerateTextPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    information,
    setInformation,
    context,
    setContext,
    text,
    setText,
    clear,
  } = useGenerateTextPageState();
  const { pathname, search } = useLocation();
  const {
    getModelId,
    setModelId,
    loading,
    messages,
    postChat,
    continueGeneration,
    clear: clearChat,
    updateSystemContextByModel,
    getStopReason,
  } = useChat(pathname);
  const { setTypingTextInput, typingTextOutput } = useTyping(loading);
  const { modelIds: availableModels, modelDisplayName } = MODELS;
  const modelId = getModelId();
  const prompter = useMemo(() => {
    return getPrompter(modelId);
  }, [modelId]);
  const stopReason = getStopReason();

  useEffect(() => {
    updateSystemContextByModel();
    // eslint-disable-next-line  react-hooks/exhaustive-deps
  }, [prompter]);

  const disabledExec = useMemo(() => {
    return information === '' || loading;
  }, [information, loading]);

  useEffect(() => {
    const _modelId = !modelId ? availableModels[0] : modelId;
    if (search !== '') {
      const params = queryString.parse(search) as GenerateTextPageQueryParams;
      setInformation(params.information ?? '');
      setContext(params.context ?? '');

      setModelId(
        availableModels.includes(params.modelId ?? '')
          ? params.modelId!
          : _modelId
      );
    } else {
      setModelId(_modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setInformation, setContext, modelId, availableModels, search]);

  useEffect(() => {
    setTypingTextInput(text);
  }, [text, setTypingTextInput]);

  const getGeneratedText = (information: string, context: string) => {
    postChat(
      prompter.generateTextPrompt({
        information,
        context,
      }),
      true
    );
  };

  // Display the response in real time
  useEffect(() => {
    if (messages.length === 0) return;
    const _lastMessage = messages[messages.length - 1];
    if (_lastMessage.role !== 'assistant') return;
    const _response = messages[messages.length - 1].content;
    setText(_response.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Execute summary
  const onClickExec = useCallback(() => {
    if (loading) return;
    getGeneratedText(information, context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [information, context, loading]);

  // Reset
  const onClickClear = useCallback(() => {
    clear();
    clearChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageContainer title={t('generateText.title')}>
      <Card label={t('generateText.source_info')}>
        <div className="mb-2 flex w-full">
          <Select
            value={modelId}
            onChange={setModelId}
            options={availableModels.map((m) => {
              return { value: m, label: modelDisplayName(m) };
            })}
          />
        </div>

        <Textarea
          placeholder={t('generateText.input_placeholder')}
          value={information}
          onChange={setInformation}
          maxHeight={-1}
        />

        <Textarea
          placeholder={t('generateText.format_placeholder')}
          value={context}
          onChange={setContext}
        />

        <div className="flex justify-end gap-3">
          {stopReason === 'max_tokens' && (
            <Button onClick={continueGeneration}>
              {t('generateText.continue_output')}
            </Button>
          )}
          <ActionButtonGroup
            onExecute={onClickExec}
            onClear={onClickClear}
            disabled={disabledExec}
            clearLabel={t('generateText.clear')}
            executeLabel={t('generateText.execute')}
            className="flex-1"
          />
        </div>

        <ResultDisplay
          content={typingTextOutput}
          loading={loading}
          placeholder={t('generateText.result_placeholder')}
          interUseCasesKey="text"
        />
      </Card>
    </PageContainer>
  );
};

export default GenerateTextPage;
