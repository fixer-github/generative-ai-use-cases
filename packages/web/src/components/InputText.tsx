import React from 'react';
import { BaseProps } from '../@types/common';
import { useTranslation } from 'react-i18next';

type Props = BaseProps & {
  label?: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  onChange?: (value: string) => void;
};

const InputText: React.FC<Props> = (props) => {
  const { t } = useTranslation();

  return (
    <div className={props.className}>
      {props.label && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{props.label}</span>
          {props.required && (
            /* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */
            <span className="text-xs text-red-600">
              * {t('common.required')}
            </span>
          )}
        </div>
      )}
      <input
        type="text"
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
        value={props.value}
        placeholder={props.placeholder || t('common.enter_text')}
        onChange={(e) => {
          props.onChange ? props.onChange(e.target.value) : null;
        }}
      />
    </div>
  );
};

export default InputText;
