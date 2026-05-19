import React, { useCallback } from 'react';
import { PiX } from 'react-icons/pi';
import { CustomAppConfiguration } from 'generative-ai-use-cases';

type Props = {
  apps: CustomAppConfiguration[];
  activeAppId: string | null;
  isPanelOpen: boolean;
  appStatuses: Map<string, string>;
  onClose: () => void;
  onSwitchApp: (appId: string) => void;
  registerIframeRef: (appId: string, el: HTMLIFrameElement | null) => void;
};

const AppFramePanel: React.FC<Props> = ({
  apps,
  activeAppId,
  isPanelOpen,
  appStatuses,
  onClose,
  onSwitchApp,
  registerIframeRef,
}) => {
  const iframeRefCallback = useCallback(
    (appId: string) => (el: HTMLIFrameElement | null) => {
      registerIframeRef(appId, el);
    },
    [registerIframeRef]
  );

  if (apps.length === 0) return null;

  return (
    <div
      className={`fixed right-0 top-0 z-10 flex h-screen flex-col border-l border-gray-300 bg-white transition-all duration-300 ${
        isPanelOpen
          ? 'w-[calc(50vw_-_8rem)] min-w-[400px]'
          : 'w-0 overflow-hidden'
      }`}>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-3">
        {/* App tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {apps.map((app) => (
            <button
              key={app.id}
              className={`whitespace-nowrap rounded px-3 py-1 text-sm transition-colors ${
                activeAppId === app.id
                  ? 'bg-aws-smile/10 text-aws-smile font-semibold'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              onClick={() => onSwitchApp(app.id)}>
              {app.displayName}
            </button>
          ))}
        </div>

        {/* Close button */}
        <button
          className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
          onClick={onClose}>
          <PiX size={18} />
        </button>
      </div>

      {/* iframe container */}
      <div className="relative flex-1">
        {apps.map((app) => {
          const status = appStatuses.get(app.id);
          const isActive = activeAppId === app.id;

          return (
            <div
              key={app.id}
              className={`absolute inset-0 ${isActive ? 'visible' : 'invisible'}`}>
              {/* Loading overlay */}
              {status !== 'initialized' && isActive && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                    <span className="text-sm text-gray-500">
                      {status === 'error'
                        ? 'Connection error'
                        : 'Loading app...'}
                    </span>
                  </div>
                </div>
              )}
              <iframe
                ref={iframeRefCallback(app.id)}
                src={app.url}
                sandbox="allow-scripts allow-same-origin allow-forms"
                className="h-full w-full border-0"
                title={app.displayName}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AppFramePanel;
