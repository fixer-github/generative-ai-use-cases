import React from 'react';
import { BaseProps } from '@/@types/common';
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
      {props.label && <span className="text-sm">{props.label}</span>}
      {props.required && (
        /* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */
        <span className="ml-2 text-xs font-bold text-gray-800">
          * {t('common.required')}
        </span>
      )}
      <input
        type="text"
        className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
