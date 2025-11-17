import React from 'react';
import { PiRobot } from 'react-icons/pi';

type Props = {
  assistantName: string;
  modelId: string;
  className?: string;
};

/**
 * AssistantModelDisplay - Read-only display of assistant name and model
 * Styled similarly to ModelSelector but not interactive
 */
const AssistantModelDisplay: React.FC<Props> = ({
  assistantName,
  modelId,
  className = '',
}) => {
  return (
    <div className={`relative ${className}`}>
      <div className="flex h-10 items-center rounded-lg bg-gray-50 px-4 py-2">
        <PiRobot className="mr-2 h-5 w-5 text-gray-500" />
        <div className="flex flex-1 flex-col">
          <span className="block truncate text-sm font-medium text-gray-900">
            {assistantName}
          </span>
          <span className="block truncate text-xs text-gray-500">
            {modelId}
          </span>
        </div>
        <span className="ml-2 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
          Assistant
        </span>
      </div>
    </div>
  );
};

export default AssistantModelDisplay;
