import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import useBot from '../hooks/useBot';
import {
  NOLABEL,
  extractPlaceholdersFromPromptTemplate,
  getItemsFromPlaceholders,
  getTextFormItemsFromItems,
} from '../utils/UseCaseBuilderUtils';
import { Alert, Heading, TextAreaField } from '@aws-amplify/ui-react';

const BotKbChatPage: React.FC = () => {
  const { botId } = useParams<{ botId: string }>();
  const { findBotById } = useBot();

  // TODO: Null系をどうにかする
  const { data: bot, isLoading, error } = findBotById(botId ?? '');

  const promptTemplate = bot?.promptTemplate ?? '';

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

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <Alert heading={error.name}>{error.message}</Alert>;
  }

  return (
    <div>
      <Heading level={2}>{bot?.title}</Heading>
      {textFormItems.map((item, index) => {
        return (
          <TextAreaField
            key={index}
            label={item.label !== NOLABEL ? item.label : undefined}
            rows={item.inputType === 'text' ? 2 : 1}
          />
        );
      })}
    </div>
  );
};

export default BotKbChatPage;
