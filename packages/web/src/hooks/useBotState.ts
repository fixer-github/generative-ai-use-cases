import { BotInputExample } from 'generative-ai-use-cases';
import { produce } from 'immer';
import { create } from 'zustand';

type StateType = {
  botId: string | null;
  setBotId: (s: string | null) => void;

  title: string;
  setTitle: (s: string) => void;

  description: string;
  setDescription: (s: string) => void;

  promptTemplate: string;
  setPromptTemplate: (s: string) => void;

  publicInOrg: boolean;
  setPublicInOrg: (s: boolean) => void;

  inputExamples: BotInputExample[];
  pushInputExample: (inputExample: BotInputExample) => void;
  removeInputExample: (index: number) => void;
  setInputExample: (index: number, inputExample: BotInputExample) => void;
  setInputExamples: (inputExamples: BotInputExample[]) => void;

  useFixedModel: boolean;
  setUseFixedModel: (s: boolean) => void;

  modelId: string;
  setModelId: (s: string) => void;

  enableAttachFile: boolean;
  setEnableAttachFile: (s: boolean) => void;

  files: File[];
  pushFile: (file: File) => void;
  removeFile: (index: number) => void;
  setFile: (index: number, file: File) => void;
  setFiles: (file: File[]) => void;

  clear: () => void;
};

const useBotState = create<StateType>((set, get) => {
  const INIT_STATE = {
    title: '',
    description: '',
    promptTemplate: '',
    publicInOrg: false,
    inputExamples: [],
    useFixedModel: false,
    modelId: '',
    enableAttachFile: false,
    files: [],
  };

  return {
    ...INIT_STATE,
    botId: null,
    setBotId: (s) => set(() => ({ botId: s })),
    setTitle: (s) => set(() => ({ title: s })),
    setDescription: (s) => set(() => ({ description: s })),
    setPromptTemplate: (s) => set(() => ({ promptTemplate: s })),
    setPublicInOrg: (s) => set(() => ({ publicInOrg: s })),

    pushInputExample: (inputExample) =>
      set(() => ({
        inputExamples: produce(get().inputExamples, (draft) => {
          draft.push(inputExample);
        }),
      })),
    removeInputExample: (index) =>
      set(() => ({
        inputExamples: produce(get().inputExamples, (draft) => {
          draft.splice(index, 1);
        }),
      })),
    setInputExample: (index, inputExample) =>
      set(() => ({
        inputExamples: produce(get().inputExamples, (draft) => {
          draft[index] = inputExample;
        }),
      })),
    setInputExamples: (inputExamples) =>
      set(() => ({
        inputExamples: inputExamples,
      })),

    setUseFixedModel: (s) => set(() => ({ useFixedModel: s })),
    setModelId: (s) => set(() => ({ modelId: s })),
    setEnableAttachFile: (s) => set(() => ({ enableAttachFile: s })),

    pushFile: (file) =>
      set(() => ({
        files: produce(get().files, (draft) => {
          draft.push(file);
        }),
      })),
    removeFile: (index) =>
      set(() => ({
        files: produce(get().files, (draft) => {
          draft.splice(index, 1);
        }),
      })),
    setFile: (index, file) =>
      set(() => ({
        files: produce(get().files, (draft) => {
          draft[index] = file;
        }),
      })),
    setFiles: (files) =>
      set(() => ({
        files: files,
      })),

    clear: () => set(INIT_STATE),
  };
});

export default useBotState;
