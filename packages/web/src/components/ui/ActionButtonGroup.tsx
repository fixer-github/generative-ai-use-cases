import React from 'react';
import { BaseProps } from '@/@types/common';
import Button from '@/components/ui/Button';
import { useTranslation } from 'react-i18next';

type Props = BaseProps & {
  onExecute: () => void;
  onClear: () => void;
  disabled?: boolean;
  loading?: boolean;
  executeLabel?: string;
  clearLabel?: string;
};

const ActionButtonGroup: React.FC<Props> = ({
  onExecute,
  onClear,
  disabled = false,
  loading = false,
  executeLabel,
  clearLabel,
  className,
}) => {
  const { t } = useTranslation();

  return (
    <div className={`flex justify-end gap-3 ${className ?? ''}`}>
      <Button outlined onClick={onClear} disabled={disabled || loading}>
        {clearLabel || t('common.clear')}
      </Button>
      <Button disabled={disabled} loading={loading} onClick={onExecute}>
        {executeLabel || t('common.execute')}
      </Button>
    </div>
  );
};

export default ActionButtonGroup;
