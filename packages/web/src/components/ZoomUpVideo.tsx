import React, { useState } from 'react';
import { BaseProps } from '../@types/common';
import ButtonIcon from './ButtonIcon';
import { PiSpinnerGap, PiX } from 'react-icons/pi';

type Props = BaseProps & {
  src?: string;
  loading?: boolean;
  deleting?: boolean;
  size: 's' | 'm';
  error?: boolean;
  onDelete?: () => void;
};

const ZoomUpVideo: React.FC<Props> = (props) => {
  const [zoom, setZoom] = useState(false);

  return (
    <div className={props.className}>
      <div className="group relative cursor-pointer">
        <video
          className={`${
            props.error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-100'
          } rounded-lg border object-cover object-center transition-all hover:border-gray-400 hover:shadow-md ${
            props.size === 's' ? 'size-24' : 'size-32'
          }`}
          src={props.src}
          controls
          onClick={() => {
            setZoom(true);
          }}
        />
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

      {zoom && (
        <div
          className="fixed left-0 top-0 z-[100] h-screen w-screen bg-gray-900/90"
          onClick={() => {
            setZoom(false);
          }}
        />
      )}
      {zoom && (
        <div
          className="fixed left-1/2 top-1/2 z-[110] -translate-x-1/2 -translate-y-1/2"
          onClick={() => {
            setZoom(false);
          }}>
          <video src={props.src} controls className="max-h-[90vh]" />
        </div>
      )}
    </div>
  );
};

export default ZoomUpVideo;
