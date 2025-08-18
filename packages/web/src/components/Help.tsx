import React from 'react';
import { PiQuestionFill } from 'react-icons/pi';
import { BaseProps } from '../@types/common';
import Tooltip from './Tooltip';

type Props = BaseProps & {
  message: string;
  position?: 'left' | 'right' | 'center';
};

const Help: React.FC<Props> = (props) => {
  return (
    <Tooltip {...props}>
      <PiQuestionFill />
    </Tooltip>
  );
};

export default Help;
