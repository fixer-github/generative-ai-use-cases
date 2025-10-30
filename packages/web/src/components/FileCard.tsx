import React from 'react';
import { BaseProps } from '../@types/common';
import ButtonIcon from './ButtonIcon';
import { PiFile, PiSpinnerGap, PiX } from 'react-icons/pi';

type Props = BaseProps & {
  filename?: string;
  url?: string;
  loading?: boolean;
  deleting?: boolean;
  size: 's' | 'm';
  error?: boolean;
  onDelete?: () => void;
};

const FileCard: React.FC<Props> = (props) => {
  return (
    <div className={props.className}>
      <div className="group relative">
        <div
          className={`${
            props.error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-100'
          } max-w-36 break-all rounded-lg border p-2.5 transition-colors hover:border-gray-400 ${
            props.size === 's' ? 'max-h-24' : 'max-h-32'
          }`}>
          <div className="flex items-start gap-2">
            <PiFile className={`flex-shrink-0 size-4 ${props.error ? 'text-red-600' : 'text-gray-600'}`} />
            <div className="flex-1 min-w-0 text-xs">
              {props.url ? (
                <a href={props.url} className="text-blue-600 hover:underline">
                  {props.filename}
                </a>
              ) : (
                <span className={props.error ? 'text-red-700' : 'text-gray-900'}>
                  {props.filename}
                </span>
              )}
            </div>
          </div>
        </div>
        {(props.loading || props.deleting) && (
          <div className="bg-gray-900/50 absolute inset-0 flex items-center justify-center rounded-lg">
            <PiSpinnerGap className="animate-spin text-3xl text-white" />
          </div>
        )}
        {props.onDelete && !props.loading && (
          <ButtonIcon
            className={`invisible absolute -right-2 -top-2 border border-gray-300 bg-white shadow-sm text-sm group-hover:visible`}
            onClick={props.onDelete}>
            <PiX />
          </ButtonIcon>
        )}
      </div>
    </div>
  );
};

export default FileCard;
