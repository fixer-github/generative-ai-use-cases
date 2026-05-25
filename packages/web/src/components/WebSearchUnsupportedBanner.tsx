import React from 'react';
import { PiInfoFill } from 'react-icons/pi';
import { supportsToolUse } from '../utils/toolUseSupport';

type Props = {
  modelId: string;
};

const WebSearchUnsupportedBanner: React.FC<Props> = ({ modelId }) => {
  if (!modelId || supportsToolUse(modelId)) return null;
  return (
    <div className="mx-auto my-2 flex w-fit max-w-3xl items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
      <PiInfoFill className="shrink-0" />
      <span>
        このモデルは Web 検索ツールに対応していません。最新情報が必要な場合は対応モデルに切り替えてください。
      </span>
    </div>
  );
};

export default WebSearchUnsupportedBanner;
