import { Tool, ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime';
import {
  BraveSearchResult,
  TavilySearchResult,
  WebSearchResult,
} from 'generative-ai-use-cases';

// Web検索ツールの定義
export const WEB_SEARCH_TOOL: Tool = {
  toolSpec: {
    name: 'web_search',
    description:
      'Search the web for current information. Use this when asked about recent events, current data, or topics requiring up-to-date information. You can call this tool multiple times with different queries to gather comprehensive information.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query keywords',
          },
          num_results: {
            type: 'number',
            description: 'Number of results to return (default: 3, max: 5)',
          },
        },
        required: ['query'],
      },
    },
  },
};

// URL本文取得ツールの定義
export const FETCH_URL_TOOL: Tool = {
  toolSpec: {
    name: 'fetch_url',
    description:
      'Fetch full content from a URL. Use this to get detailed information from a specific web page when the search snippet is not enough.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to fetch content from',
          },
        },
        required: ['url'],
      },
    },
  },
};

// 全てのWeb検索関連ツール
export const WEB_SEARCH_TOOLS: Tool[] = [WEB_SEARCH_TOOL, FETCH_URL_TOOL];

// 内部用の検索結果型
type InternalSearchResult = {
  title: string;
  content: string;
  url: string;
  extraSnippets?: string[];
};

// Brave Search APIを使用した検索
export const searchUsingBrave = async (
  query: string,
  numResults: number = 3,
  apiKey?: string
): Promise<InternalSearchResult[]> => {
  const searchApiKey = apiKey || process.env.SEARCH_API_KEY || '';

  if (!searchApiKey) {
    throw new Error('SEARCH_API_KEY is not configured');
  }

  const count = Math.min(Math.max(numResults, 1), 5);
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${count}&text_decorations=0`;

  const response = await fetch(searchUrl, {
    headers: {
      'X-Subscription-Token': searchApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status}`);
  }

  const data = await response.json();
  console.log('Brave Search response:', JSON.stringify(data));

  if (!data.web?.results) {
    return [];
  }

  return data.web.results.map(
    (result: BraveSearchResult): InternalSearchResult => ({
      title: result.title,
      content: result.description,
      url: result.url,
      extraSnippets: result.extra_snippets,
    })
  );
};

// Tavily APIを使用した検索
export const searchUsingTavily = async (
  query: string,
  numResults: number = 3,
  apiKey?: string
): Promise<InternalSearchResult[]> => {
  const searchApiKey = apiKey || process.env.SEARCH_API_KEY || '';

  if (!searchApiKey) {
    throw new Error('SEARCH_API_KEY is not configured');
  }

  const maxResults = Math.min(Math.max(numResults, 1), 5);
  const searchUrl = 'https://api.tavily.com/search';

  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${searchApiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      include_answer: false,
      include_images: false,
      include_raw_content: true,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status}`);
  }

  const data = await response.json();
  console.log('Tavily Search response:', JSON.stringify(data));

  if (!data.results) {
    return [];
  }

  return data.results.map(
    (result: TavilySearchResult): InternalSearchResult => ({
      title: result.title,
      content: result.raw_content ?? result.content,
      url: result.url,
    })
  );
};

// 検索エンジンに応じた検索実行
export type SearchEngine = 'Brave' | 'Tavily';

export const executeWebSearch = async (
  query: string,
  numResults: number = 3,
  searchEngine?: SearchEngine,
  apiKey?: string
): Promise<WebSearchResult[]> => {
  const engine = searchEngine || (process.env.SEARCH_ENGINE as SearchEngine);

  if (!engine) {
    throw new Error('SEARCH_ENGINE is not configured');
  }

  const internalResults =
    engine === 'Brave'
      ? await searchUsingBrave(query, numResults, apiKey)
      : await searchUsingTavily(query, numResults, apiKey);

  // WebSearchResult型に変換
  return internalResults.map((result) => ({
    title: result.title,
    url: result.url,
    snippet:
      result.content.substring(0, 500) +
      (result.content.length > 500 ? '...' : ''),
    content: result.content,
  }));
};

// ツール実行結果をToolResultContentBlockに変換
export const createToolResultContent = (
  results: WebSearchResult[]
): ToolResultContentBlock[] => {
  return [
    {
      json: {
        results: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          content: r.content ?? '',
        })),
      },
    },
  ];
};

// ツール実行エラーをToolResultContentBlockに変換
export const createToolErrorContent = (
  error: string
): ToolResultContentBlock[] => {
  return [
    {
      text: `Error: ${error}`,
    },
  ];
};
