import React, { useState } from 'react';
import { AssistantMessageSource } from 'generative-ai-use-cases';
import { PiFileText, PiGlobe, PiCaretDown, PiCaretUp } from 'react-icons/pi';
import { useTranslation } from 'react-i18next';

type Props = {
  sources: AssistantMessageSource[];
};

const SourceDisplay: React.FC<Props> = ({ sources }) => {
  const { t } = useTranslation();
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  if (!sources || sources.length === 0) {
    return null;
  }

  const toggleSource = (uniqueKey: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(uniqueKey)) {
        console.log(`Collapsing source: ${uniqueKey}`);
        next.delete(uniqueKey);
      } else {
        console.log(`Expanding source: ${uniqueKey}`);
        next.add(uniqueKey);
      }
      console.log('Expanded sources after toggle:', Array.from(next));
      return next;
    });
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 text-xs font-semibold text-gray-500">
        {t('assistant.sources')} ({sources.length})
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, idx) => {
          // Use combination of sourceId and index to ensure uniqueness
          const uniqueKey = `${source.sourceId || 'source'}-${idx}`;
          const isExpanded = expandedSources.has(uniqueKey);
          const icon =
            source.sourceType === 'web' || source.contentType === 'url' ? (
              <PiGlobe className="shrink-0" />
            ) : (
              <PiFileText className="shrink-0" />
            );

          return (
            <div key={idx} className="w-full">
              <button
                onClick={() => toggleSource(uniqueKey)}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50">
                {icon}
                <span className="flex-1 truncate font-medium text-gray-700">
                  {source.name || source.sourceUrl || `Source ${idx + 1}`}
                </span>
                {isExpanded ? (
                  <PiCaretUp className="shrink-0 text-gray-400" />
                ) : (
                  <PiCaretDown className="shrink-0 text-gray-400" />
                )}
              </button>

              {isExpanded && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  {source.sourceUrl && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold text-gray-500">
                        URL:
                      </span>
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs text-blue-600 hover:underline">
                        {source.sourceUrl}
                      </a>
                    </div>
                  )}
                  {source.excerpt && (
                    <div>
                      <span className="text-xs font-semibold text-gray-500">
                        {t('assistant.excerpt')}:
                      </span>
                      <div className="mt-1 text-xs text-gray-700">
                        "{source.excerpt}"
                      </div>
                    </div>
                  )}
                  {!source.excerpt && source.content && (
                    <div>
                      <span className="text-xs font-semibold text-gray-500">
                        {t('assistant.content')}:
                      </span>
                      <div className="mt-1 max-h-32 overflow-y-auto text-xs text-gray-700">
                        {source.content}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SourceDisplay;
