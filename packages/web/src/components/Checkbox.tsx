import React from 'react';
import RowItem from './RowItem';
import { BaseProps } from '../@types/common';

type Props = BaseProps & {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

const Checkbox: React.FC<Props> = (props) => {
  return (
    <RowItem className="flex items-center">
      <input
        id="checkbox"
        type="checkbox"
        className="text-blue-600 size-4 rounded border-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        checked={props.value}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <label htmlFor="checkbox" className="ml-2 text-sm text-gray-700 cursor-pointer">
        {props.label}
      </label>
    </RowItem>
  );
};

export default Checkbox;
