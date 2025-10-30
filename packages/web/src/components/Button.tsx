import React from 'react';
import { BaseProps } from '../@types/common';
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
          ? 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed'
          : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed'
      } inline-flex items-center justify-center gap-2 font-medium rounded-lg px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        props.disabled || props.loading ? 'opacity-50' : ''
      }`}
      title={props.title}
      onClick={props.disabled || props.loading ? undefined : props.onClick}
      disabled={props.disabled || props.loading}>
      {props.loading && <PiSpinnerGap className="animate-spin" size={16} />}
      {props.children}
    </button>
  );
};

export default Button;
