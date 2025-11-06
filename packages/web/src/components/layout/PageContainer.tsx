import React from 'react';
import { BaseProps } from '@/@types/common';

type Props = BaseProps & {
  title?: string;
  children: React.ReactNode;
};

const PageContainer: React.FC<Props> = ({ title, children, className }) => {
  return (
    <div className={`grid grid-cols-12 ${className ?? ''}`}>
      {title && (
        <div className="invisible col-span-12 my-0 flex h-0 items-center justify-center text-xl font-semibold lg:visible lg:my-5 lg:h-min print:visible print:my-5 print:h-min">
          {title}
        </div>
      )}
      <div className="col-span-12 col-start-1 mx-2 lg:col-span-10 lg:col-start-2 xl:col-span-10 xl:col-start-2">
        {children}
      </div>
    </div>
  );
};

export default PageContainer;
