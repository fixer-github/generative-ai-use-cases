import React, { useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import Card from '@/components/ui/Card';
import ExpandableField from '@/components/layout/ExpandableField';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
import useChat from '@/hooks/useChat';
import useTyping from '@/hooks/useTyping';
import { create } from 'zustand';
import { SummarizePageQueryParams } from '@/@types/navigate';
import { MODELS } from '@/hooks/useModel';
import { getPrompter } from '@/prompts';
import queryString from 'query-string';
import { useTranslation } from 'react-i18next';
import PageContainer from '@/components/layout/PageContainer';
import ActionButtonGroup from '@/components/ui/ActionButtonGroup';
import ResultDisplay from '@/components/feature/result/ResultDisplay';

type StateType = {
  sentence: string;
  setSentence: (s: string) => void;
  additionalContext: string;
  setAdditionalContext: (s: string) => void;
  summarizedSentence: string;
  setSummarizedSentence: (s: string) => void;
  clear: () => void;
};

const useSummarizePageState = create<StateType>((set) => {
  const INIT_STATE = {
    sentence: '',
    additionalContext: '',
    summarizedSentence: '',
  };
  return {
    ...INIT_STATE,
    setSentence: (s: string) => {
      set(() => ({
        sentence: s,
      }));
    },
    setAdditionalContext: (s: string) => {
      set(() => ({
        additionalContext: s,
      }));
    },
    setSummarizedSentence: (s: string) => {
      set(() => ({
        summarizedSentence: s,
      }));
    },
    clear: () => {
      set(INIT_STATE);
    },
  };
});

const SummarizePage: React.FC = () => {
  const { t } = useTranslation();
  const {
    sentence,
    setSentence,
    additionalContext,
    setAdditionalContext,
    summarizedSentence,
    setSummarizedSentence,
    clear,
  } = useSummarizePageState();
  const { pathname, search } = useLocation();
  const {
    getModelId,
    setModelId,
    loading,
    messages,
    postChat,
    clear: clearChat,
    updateSystemContextByModel,
  } = useChat(pathname);
  const { setTypingTextInput, typingTextOutput } = useTyping(loading);
  const { modelIds: availableModels, modelDisplayName } = MODELS;
  const modelId = getModelId();
  const prompter = useMemo(() => {
    return getPrompter(modelId);
  }, [modelId]);

  useEffect(() => {
    updateSystemContextByModel();
    // eslint-disable-next-line  react-hooks/exhaustive-deps
  }, [prompter]);

  const disabledExec = useMemo(() => {
    return sentence === '' || loading;
  }, [sentence, loading]);

  useEffect(() => {
    const _modelId = !modelId ? availableModels[0] : modelId;
    if (search !== '') {
      const params = queryString.parse(search) as SummarizePageQueryParams;
      setSentence(params.sentence ?? '');
      setAdditionalContext(params.additionalContext ?? '');
      setModelId(
        availableModels.includes(params.modelId ?? '')
          ? params.modelId!
          : _modelId
      );
    } else {
      setModelId(_modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSentence, setAdditionalContext, modelId, availableModels, search]);

  useEffect(() => {
    setTypingTextInput(summarizedSentence);
  }, [summarizedSentence, setTypingTextInput]);

  const getSummary = (sentence: string, context: string) => {
    postChat(
      prompter.summarizePrompt({
        sentence,
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
    setSummarizedSentence(_response.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Execute summary
  const onClickExec = useCallback(() => {
    if (loading) return;
    getSummary(sentence, additionalContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence, additionalContext, loading]);

  // Reset
  const onClickClear = useCallback(() => {
    clear();
    clearChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageContainer title={t('summarize.title')}>
      <Card label={t('summarize.text_to_summarize')}>
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
          placeholder={t('summarize.enter_text')}
          value={sentence}
          onChange={setSentence}
          maxHeight={-1}
        />

        <ExpandableField label={t('summarize.additional_context')} optional>
          <Textarea
            placeholder={t('summarize.additional_context_placeholder')}
            value={additionalContext}
            onChange={setAdditionalContext}
          />
        </ExpandableField>

        <ActionButtonGroup
          onExecute={onClickExec}
          onClear={onClickClear}
          disabled={disabledExec}
        />

        <ResultDisplay
          content={typingTextOutput}
          loading={loading}
          placeholder={t('summarize.result_placeholder')}
          interUseCasesKey="summarizedSentence"
        />
      </Card>
    </PageContainer>
  );
};

export default SummarizePage;
