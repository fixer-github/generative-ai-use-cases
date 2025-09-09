import {
  Flex,
  Button,
  CheckboxField,
  DropZone,
  Fieldset,
  Heading,
  SelectField,
  Text,
  TextAreaField,
  TextField,
  VisuallyHidden,
} from '@aws-amplify/ui-react';
import React, { useState } from 'react';
import { MODELS } from '../hooks/useModel';
import { useNavigate } from 'react-router-dom';

const BotKbEditPage: React.FC = () => {
  const navigate = useNavigate();

  const { modelIds } = MODELS;

  const [botTitle, setBotTitle] = useState('');
  const [botDescription, setBotDescription] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [publicInOrg, setPublicInOrg] = useState(false);
  const [useFixedModel, setUseFixedModel] = useState(false);
  const [model, setModel] = useState(modelIds[0]);
  const [attachFile, setAttachFile] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const hiddenInput = React.useRef<HTMLInputElement>(null);

  const onFilePickerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (!files || files.length === 0) {
      return;
    }
    setFiles(Array.from(files));
  };

  // const acceptedFileTypes = ['image/png', 'image/jpeg'];

  return (
    <>
      <Heading level={1}>新規作成</Heading>

      <Flex direction="column" gap="large" margin="large">
        <Fieldset legend="基本設定" variation="outlined">
          <TextField
            id="title"
            label="タイトル"
            placeholder="入力してください"
            required
            value={botTitle}
            onChange={(e) => setBotTitle(e.currentTarget.value)}
          />
          <TextField
            id="description"
            label="説明"
            placeholder="入力してください"
            value={botDescription}
            onChange={(e) => setBotDescription(e.currentTarget.value)}
          />
          <TextAreaField
            label="プロンプトテンプレート"
            placeholder="プロンプトテンプレートの書き方については、「ヘルプ」か「サンプル集」をご覧ください。"
            rows={5}
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.currentTarget.value)}
            required
          />
          <Text variation="secondary" fontSize="0.75rem">
            ユーザーの入力を受け付けないユースケースは作成できません。プロンプトテンプレートにPlaceholderを定義するか、ファイル添付をONにしてください。
          </Text>
          <CheckboxField
            id="publicInOrg"
            name="publicInOrg"
            label="組織内で公開する"
            checked={publicInOrg}
            onChange={(e) => setPublicInOrg(e.currentTarget.checked)}
          />
          <Text variation="secondary" fontSize="0.75rem">
            チェックをいれると、組織内の全員がBotを使用できるようになります。
          </Text>
        </Fieldset>

        <Fieldset legend="入力例">
          <Text variation="error">TODO</Text>
        </Fieldset>

        <Fieldset legend="モデル選択">
          <CheckboxField
            id="useFixedModel"
            name="useFixedModel"
            label="使用するモデルを固定する"
            checked={useFixedModel}
            onChange={(e) => setUseFixedModel(e.currentTarget.checked)}
          />
          <Text variation="secondary" fontSize="0.75rem">
            モデルを固定するとモデル選択のUIが表示されないため、ユーザーは生成AIの存在を意識せずにユースケースを利用できます。
          </Text>
          {useFixedModel && (
            <SelectField
              id="model"
              label="モデルを選択"
              labelHidden
              value={model}
              onChange={(e) => setModel(e.currentTarget.value)}>
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
            checked={attachFile}
            onChange={(e) => setAttachFile(e.currentTarget.checked)}
          />
          <Text variation="secondary" fontSize="0.75rem">
            添付可能なファイルはモデルによって異なります
          </Text>
        </Fieldset>

        <Fieldset legend="参考資料">
          <Text variation="secondary" fontSize="0.75rem">
            参考文献として使用する資料を追加することができます
          </Text>
          <DropZone
            // acceptedFileTypes={acceptedFileTypes}
            onDropComplete={({ acceptedFiles }) => {
              setFiles(acceptedFiles);
            }}>
            <Flex direction="column" alignItems="center">
              <Text>ここにファイルをドラッグできます</Text>
              <Button size="small" onClick={() => hiddenInput.current?.click()}>
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
            <Text key={file.name}>{file.name}</Text>
          ))}
        </Fieldset>

        <div className="flex flex-row justify-between">
          <Button onClick={() => navigate('/bot')}>戻る</Button>{' '}
          <Button variation="primary">作成</Button>
        </div>
      </Flex>
    </>
  );
};

export default BotKbEditPage;
