import React, { useCallback } from 'react';
import { BaseProps } from '../@types/common';
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
      } flex items-center justify-center rounded p-1.5 text-lg transition-colors hover:bg-gray-200 ${
        props.disabled || props.loading ? 'opacity-50 cursor-not-allowed' : ''
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
