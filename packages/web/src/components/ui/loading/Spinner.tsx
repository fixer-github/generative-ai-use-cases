import React from 'react';
import { BaseProps } from '@/@types/common';

type Props = BaseProps & {
  size?: 'sm' | 'md' | 'lg';
};

const sizeClasses = {
  sm: 'size-4 border-2',
  md: 'size-5 border-4',
  lg: 'size-8 border-4',
};

const Spinner: React.FC<Props> = ({ size = 'md', className }) => {
  return (
    <div
      className={`${className ?? ''} ${sizeClasses[size]} animate-spin rounded-full border-primary border-t-transparent`}
    />
  );
};

export default Spinner;
