import React from 'react';
import { BaseProps } from '../@types/common';

type Props = BaseProps & {
  onSwitch: () => void;
  icon: React.ReactNode;
  isEnabled: boolean;
};

const ButtonToggle: React.FC<Props> = (props) => {
  return (
    <button
      className={`${
        props.className ?? ''
      } flex items-center justify-center rounded-xl border p-2 text-xl ${
        props.isEnabled
          ? 'bg-aws-smile border-aws-smile text-white'
          : 'border-gray-400 bg-white text-gray-400'
      }`}
      onClick={props.onSwitch}>
      {props.icon}
    </button>
  );
};

export default ButtonToggle;
