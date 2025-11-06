import React from 'react';
import { BaseProps } from '@/@types/common';
import Markdown from '@/components/utility/Markdown';
import ButtonCopy from '@/components/feature/feedback/ButtonCopy';
import Spinner from '@/components/ui/loading/Spinner';

type Props = BaseProps & {
  content: string;
  loading?: boolean;
  placeholder?: string;
  copyable?: boolean;
  interUseCasesKey?: string;
};

const ResultDisplay: React.FC<Props> = ({
  content,
  loading = false,
  placeholder,
  copyable = true,
  interUseCasesKey,
  className,
}) => {
  return (
    <div className={`mt-5 rounded-md border border-gray-200 bg-white p-3 ${className ?? ''}`}>
      {content && <Markdown>{content}</Markdown>}

      {!loading && !content && placeholder && (
        <div className="text-gray-500">{placeholder}</div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <Spinner />
        </div>
      )}

      {copyable && content && !loading && (
        <div className="flex w-full justify-end">
          <ButtonCopy text={content} interUseCasesKey={interUseCasesKey} />
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;
