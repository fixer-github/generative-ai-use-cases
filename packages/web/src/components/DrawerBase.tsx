import React, { ReactNode } from 'react';
import { BaseProps } from '../@types/common';

type Props = BaseProps & {
  children: ReactNode;
  width?: 'narrow' | 'wide';
};

const DrawerBase: React.FC<Props> = (props) => {
  const widthClass = props.width === 'wide' ? 'w-64' : 'w-24';

  return (
    <nav
      className={`bg-aws-squid-ink flex h-screen flex-col text-sm text-white print:hidden ${widthClass} ${props.className ?? ''}`}>
      {props.children}
    </nav>
  );
};

export default DrawerBase;
