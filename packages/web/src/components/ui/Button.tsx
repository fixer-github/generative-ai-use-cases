import React from 'react';
import { BaseProps } from '@/@types/common';
import { PiSpinnerGap } from 'react-icons/pi';

type Props = BaseProps & {
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  outlined?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

const Button: React.FC<Props> = (props) => {
  return (
    <button
      className={`${props.className ?? ''} ${
        props.outlined
          ? 'border border-gray-200 bg-white text-gray-900 hover:bg-blue-50 hover:text-blue-800'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      } inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
        props.disabled || props.loading
          ? 'pointer-events-none opacity-50'
          : ''
      }`}
      title={props.title}
      onClick={props.disabled || props.loading ? undefined : props.onClick}
      disabled={props.disabled || props.loading}>
      {props.loading && <PiSpinnerGap className="mr-2 animate-spin" />}
      {props.children}
    </button>
  );
};

export default Button;
