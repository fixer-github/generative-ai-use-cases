import React, { useCallback } from 'react';
import { BaseProps } from '@/@types/common';
import { PiSpinnerGap } from 'react-icons/pi';

type Props = BaseProps & {
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
};

const ButtonIcon: React.FC<Props> = (props) => {
  const onClick = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      props.onClick();
    },
    [props]
  );

  return (
    <button
      className={`${
        props.className ?? ''
      } inline-flex items-center justify-center rounded-full p-1.5 text-xl transition-colors hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
        props.disabled || props.loading ? 'pointer-events-none opacity-50' : ''
      }`}
      onClick={onClick}
      disabled={props.disabled}
      title={props.title}>
      {props.loading ? (
        <PiSpinnerGap className="animate-spin" />
      ) : (
        props.children
      )}
    </button>
  );
};

export default ButtonIcon;
