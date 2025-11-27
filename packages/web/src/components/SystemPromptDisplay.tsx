import React from 'react';
import { useTranslation } from 'react-i18next';
import ExpandableField from './ExpandableField';

type Props = {
  systemPrompt: string | undefined;
  className?: string;
};

const SystemPromptDisplay: React.FC<Props> = ({ systemPrompt, className }) => {
  const { t } = useTranslation();

  if (!systemPrompt || systemPrompt.trim() === '') {
    return null;
  }

  return (
    <ExpandableField
      label={t('chat.system_prompt')}
      className={className}
      defaultOpened={false}
      notItem>
      <div className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-700">
        {systemPrompt}
      </div>
    </ExpandableField>
  );
};

export default SystemPromptDisplay;
