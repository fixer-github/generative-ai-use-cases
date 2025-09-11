import {
  Flex,
  Button,
  CheckboxField,
  DropZone,
  Heading,
  SelectField,
  Text as AmplifyText,
  TextAreaField,
  TextField,
  VisuallyHidden,
  Fieldset as AmplifyFieldset,
  View,
} from '@aws-amplify/ui-react';
import React, { useMemo } from 'react';
import { MODELS } from '../hooks/useModel';
import { useNavigate } from 'react-router-dom';
import {
  BotCreateRequest,
  BotCreateRequestKnouledgeFile,
} from 'generative-ai-use-cases';
import useBot from '../hooks/useBotApi';
import useBotState from '../hooks/useBotState';
import {
  NOLABEL,
  extractPlaceholdersFromPromptTemplate,
  getItemsFromPlaceholders,
  getTextFormItemsFromItems,
} from '../utils/UseCaseBuilderUtils';
import { PiPlus, PiTrash } from 'react-icons/pi';
import { produce } from 'immer';

type InputFieldDescriptionProps = {
  children: React.ReactNode;
};

const InputFieldDescription: React.FC<InputFieldDescriptionProps> = ({
  children,
  ...props
}) => {
  return (
    <AmplifyText variation="secondary" fontSize="0.75rem" {...props}>
      {children}
    </AmplifyText>
  );
};

type FieldsetProps = {
  legend: string;
  children: React.ReactNode;
};

const Fieldset: React.FC<FieldsetProps> = ({ legend, children, ...props }) => {
  return (
    <AmplifyFieldset legend={legend} variation="outlined" {...props}>
      {children}
    </AmplifyFieldset>
  );
};

const BotKbEditPage: React.FC = () => {
  const navigate = useNavigate();

  const { modelIds } = MODELS;

  const { createBot } = useBot();

  const {
    title,
    setTitle,

    description,
    setDescription,

    promptTemplate,
    setPromptTemplate,

    publicInOrg,
    setPublicInOrg,

    inputExamples,
    pushInputExample,
    removeInputExample,
    setInputExample,

    useFixedModel,
    setUseFixedModel,

    modelId,
    setModelId,

    enableAttachFile,
    setEnableAttachFile,

    files,
    setFiles,
  } = useBotState();

  const hiddenInput = React.useRef<HTMLInputElement>(null);

  const onFilePickerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (!files || files.length === 0) {
      return;
    }
    setFiles(Array.from(files));
  };

  // const acceptedFileTypes = ['image/png', 'image/jpeg'];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    // デフォルトのリロードをキャンセル
    event.preventDefault();

    // Validation
    if (!title) {
      console.error('ボットのタイトルは必要です');
      return;
    }
    if (!promptTemplate) {
      console.error('プロンプトテンプレートは必須です');
      return;
    }

    const convertFile = (
      file: File
    ): Promise<BotCreateRequestKnouledgeFile> => {
      return new Promise((resolve, reject) => {
        const name = file.name;
        const contentType = file.type;

        const reader = new FileReader();

        reader.readAsDataURL(file);
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const content = reader.result;
            resolve({ name, contentType, content });
          } else {
            reject(new Error('Failed to convert file to Base64'));
          }
        };
        reader.onerror = (error) => reject(error);
      });
    };

    const knouledgeFiles = await Promise.all(
      files.map((file) => convertFile(file))
    );

    const request: BotCreateRequest = {
      title: title,
      description: description,
      promptTemplate: promptTemplate,
      publicInOrg: publicInOrg,
      inputExamples: inputExamples,
      useFixedModel: useFixedModel,
      modelId: modelId,
      fileAttachEnabled: enableAttachFile,
      knouledgeFiles: knouledgeFiles,
    };

    const result = await createBot(request);

    console.log(JSON.stringify(result));

    navigate(`/bot`, { replace: true });
  };

  // Placeholders in the prompt template
  const placeholders = useMemo(() => {
    return extractPlaceholdersFromPromptTemplate(promptTemplate);
  }, [promptTemplate]);

  // Convert placeholders to an Object
  const items = useMemo(() => {
    return getItemsFromPlaceholders(placeholders);
  }, [placeholders]);

  const textFormItems = useMemo(() => {
    return getTextFormItemsFromItems(items);
  }, [items]);

  return (
    <>
      <Heading level={1}>新規作成</Heading>

      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="large" margin="large">
          <Fieldset legend="基本設定">
            <TextField
              id="title"
              label="タイトル"
              placeholder="入力してください"
              required
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
            <TextField
              id="description"
              label="説明"
              placeholder="入力してください"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
            <TextAreaField
              label="プロンプトテンプレート"
              placeholder="プロンプトテンプレートの書き方については、「ヘルプ」か「サンプル集」をご覧ください。"
              rows={5}
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.currentTarget.value)}
              required
            />
            <InputFieldDescription>
              ユーザーの入力を受け付けないユースケースは作成できません。プロンプトテンプレートにPlaceholderを定義するか、ファイル添付をONにしてください。
            </InputFieldDescription>
            <CheckboxField
              id="publicInOrg"
              name="publicInOrg"
              label="組織内で公開する"
              checked={publicInOrg}
              onChange={(e) => setPublicInOrg(e.currentTarget.checked)}
            />
            <InputFieldDescription>
              チェックをいれると、組織内の全員がBotを使用できるようになります。
            </InputFieldDescription>
          </Fieldset>

          <Fieldset legend="入力例">
            <Flex direction="column" gap={12}>
              {inputExamples.map((inputExample, idx) => (
                <View key={idx}>
                  <Flex direction="row" position="relative" gap={6}>
                    <TextField
                      label="タイトル"
                      value={inputExample.title}
                      onChange={(e) => {
                        setInputExample(idx, {
                          ...inputExample,
                          title: e.currentTarget.value,
                        });
                        // setIsDisabledUpdate(false);
                      }}
                      grow={1}
                      required
                    />

                    <Button
                      variation="destructive"
                      padding={0}
                      width={24}
                      height={24}
                      top={-1}
                      right={-1}
                      position="absolute"
                      onClick={() => {
                        removeInputExample(idx);
                      }}>
                      <PiTrash />
                    </Button>
                  </Flex>

                  {textFormItems.map((item, itemIndex) => (
                    <TextAreaField
                      key={itemIndex}
                      label={item.label !== NOLABEL ? item.label : undefined}
                      rows={item.inputType === 'text' ? 2 : 1}
                      value={inputExample.examples[item.label] ?? ''}
                      onChange={(e) => {
                        setInputExample(idx, {
                          title: inputExample.title,
                          examples: produce(inputExample.examples, (draft) => {
                            draft[item.label] = e.currentTarget.value;
                          }),
                        });
                        // setIsDisabledUpdate(false);
                      }}
                    />
                  ))}
                </View>
              ))}
              <Button
                size="small"
                alignSelf="end"
                onClick={() => {
                  const examples: Record<string, string> = {};
                  items.forEach((item) => {
                    examples[item.label] = '';
                  });
                  pushInputExample({
                    title: '',
                    examples,
                  });
                }}>
                <PiPlus className="pr-2 text-xl" />
                追加
              </Button>
            </Flex>
          </Fieldset>

          <Fieldset legend="モデル選択">
            <CheckboxField
              id="useFixedModel"
              name="useFixedModel"
              label="使用するモデルを固定する"
              checked={useFixedModel}
              onChange={(e) => setUseFixedModel(e.currentTarget.checked)}
            />
            <InputFieldDescription>
              モデルを固定するとモデル選択のUIが表示されないため、ユーザーは生成AIの存在を意識せずにユースケースを利用できます。
            </InputFieldDescription>
            {useFixedModel && (
              <SelectField
                id="model"
                label="モデルを選択"
                labelHidden
                value={modelId}
                onChange={(e) => setModelId(e.currentTarget.value)}>
                {modelIds.map((model) => (
                  <option value={model}>{model}</option>
                ))}
              </SelectField>
            )}
          </Fieldset>

          <Fieldset legend="ファイル添付">
            <CheckboxField
              id="attachFile"
              name="attachFile"
              label="ファイルを添付可能にする"
              checked={enableAttachFile}
              onChange={(e) => setEnableAttachFile(e.currentTarget.checked)}
            />
            <InputFieldDescription>
              添付可能なファイルはモデルによって異なります
            </InputFieldDescription>
          </Fieldset>

          <Fieldset legend="参考資料">
            <AmplifyText variation="secondary" fontSize="0.75rem">
              参考文献として使用する資料を追加することができます
            </AmplifyText>
            <DropZone
              // acceptedFileTypes={acceptedFileTypes}
              onDropComplete={({ acceptedFiles }) => {
                setFiles(acceptedFiles);
              }}>
              <Flex direction="column" alignItems="center">
                <AmplifyText>ここにファイルをドラッグできます</AmplifyText>
                <Button
                  size="small"
                  onClick={() => hiddenInput.current?.click()}>
                  参照
                </Button>
              </Flex>
              <VisuallyHidden>
                <input
                  type="file"
                  tabIndex={-1}
                  ref={hiddenInput}
                  onChange={onFilePickerChange}
                  multiple={true}
                  // accept={acceptedFileTypes.join(',')}
                />
              </VisuallyHidden>
            </DropZone>
            {files.map((file) => (
              <AmplifyText key={file.name}>{file.name}</AmplifyText>
            ))}
          </Fieldset>

          <div className="flex flex-row justify-between">
            <Button onClick={() => navigate('/bot')}>戻る</Button>{' '}
            <Button type="submit" variation="primary">
              作成
            </Button>
          </div>
        </Flex>
      </form>
    </>
  );
};

export default BotKbEditPage;
