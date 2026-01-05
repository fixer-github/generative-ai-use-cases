import React, { useState } from 'react';
import { WebSearchMetadata, WebSearchQuery, WebSearchResult } from 'generative-ai-use-cases';
import { useTranslation } from 'react-i18next';
import { PiGlobeSimple, PiCaretDown, PiCaretRight, PiLink, PiCheck } from 'react-icons/pi';

type WebSearchResultCardProps = {
  result: WebSearchResult;
};

const WebSearchResultCard: React.FC<WebSearchResultCardProps> = ({ result }) => {
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border border-gray-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
    >
      <div className="flex items-start gap-2">
        <PiLink className="mt-1 size-4 shrink-0 text-gray-400 group-hover:text-blue-500" />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium text-gray-900 group-hover:text-blue-600">
            {result.title}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
            {result.snippet}
          </p>
          <p className="mt-1 truncate text-xs text-gray-400">
            {result.url}
          </p>
        </div>
        {result.isReferenced && (
          <span className="shrink-0 rounded-full bg-green-100 p-1">
            <PiCheck className="size-3 text-green-600" />
          </span>
        )}
      </div>
    </a>
  );
};

type WebSearchQuerySectionProps = {
  query: WebSearchQuery;
  index: number;
};

const WebSearchQuerySection: React.FC<WebSearchQuerySectionProps> = ({ query, index }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(index === 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <PiCaretDown className="size-4 text-gray-500" />
          ) : (
            <PiCaretRight className="size-4 text-gray-500" />
          )}
          <span className="text-sm font-medium text-gray-700">
            {t('chat.webSearch.query_label')}: {query.query}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {query.results.length} {t('chat.webSearch.results_label')}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 p-3">
          {query.results.length > 0 ? (
            <div className="grid gap-2">
              {query.results.map((result, idx) => (
                <WebSearchResultCard key={idx} result={result} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('chat.webSearch.no_results')}</p>
          )}
        </div>
      )}
    </div>
  );
};

type Props = {
  metadata: WebSearchMetadata;
  loading?: boolean;
};

const WebSearchTrace: React.FC<Props> = ({ metadata, loading }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!metadata.queries || metadata.queries.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <PiGlobeSimple className="size-5 text-blue-500" />
          <span className="text-sm font-medium text-blue-700">
            {t('chat.webSearch.trace_title')}
          </span>
          {loading && (
            <div className="size-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600"></div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-600">
            {t('chat.webSearch.summary', {
              referenced: metadata.referencedResultsCount,
              total: metadata.totalResultsCount,
            })}
          </span>
          {isExpanded ? (
            <PiCaretDown className="size-4 text-blue-500" />
          ) : (
            <PiCaretRight className="size-4 text-blue-500" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          {metadata.queries.map((query, idx) => (
            <WebSearchQuerySection key={idx} query={query} index={idx} />
          ))}
          {metadata.searchEngineUsed && (
            <p className="text-right text-xs text-gray-400">
              Powered by {metadata.searchEngineUsed}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default WebSearchTrace;
