import React from 'react';
import { BaseProps } from '../@types/common';

type Props = BaseProps & {
  checked: boolean;
  onSwitch: (newValue: boolean) => void;
  label: string;
};

const Switch: React.FC<Props> = (props) => {
  return (
    <div className={`${props.className ?? ''} flex`}>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          value=""
          className="peer sr-only"
          checked={props.checked}
          onChange={() => {
            props.onSwitch(!props.checked);
          }}
        />
        <div className="peer-checked:bg-blue-600 peer relative h-6 w-11 min-w-11 rounded-full bg-gray-200 transition-colors peer-focus:ring-2 peer-focus:ring-blue-500 peer-focus:ring-offset-2">
          <span
            className={`absolute inset-y-[2px] left-[2px] size-5 rounded-full border border-gray-300 bg-white transition-all ${props.checked ? 'translate-x-5 border-white' : ''}`}></span>
        </div>
        <span className="ml-2 break-words text-sm font-medium text-gray-900">
          {props.label}
        </span>
      </label>
    </div>
  );
};

export default Switch;
