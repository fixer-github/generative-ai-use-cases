import { BraveSearchResult, TavilySearchResult } from 'generative-ai-use-cases';
import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// API key resolution: prefer SSM SecureString when SEARCH_API_KEY_SSM_PARAM is set,
// fall back to plain SEARCH_API_KEY env var. The resolved value is cached in the
// module scope so warm invocations skip the SSM round-trip.
let cachedApiKey: string | undefined;
let cachedApiKeyExpiresAt = 0;
const SSM_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let ssmClient: SSMClient | undefined;
const getSsmClient = (): SSMClient => {
  if (!ssmClient) ssmClient = new SSMClient({});
  return ssmClient;
};

const resolveApiKey = async (): Promise<string> => {
  const now = Date.now();
  if (cachedApiKey !== undefined && now < cachedApiKeyExpiresAt) {
    return cachedApiKey;
  }
  const ssmParam = process.env.SEARCH_API_KEY_SSM_PARAM;
  if (ssmParam && ssmParam.length > 0) {
    try {
      const res = await getSsmClient().send(
        new GetParameterCommand({ Name: ssmParam, WithDecryption: true })
      );
      const value = res.Parameter?.Value ?? '';
      cachedApiKey = value;
      cachedApiKeyExpiresAt = now + SSM_CACHE_TTL_MS;
      return value;
    } catch (e) {
      console.error('Failed to fetch search API key from SSM', e);
      // Fall through to env var fallback
    }
  }
  const envKey = process.env.SEARCH_API_KEY ?? '';
  cachedApiKey = envKey;
  cachedApiKeyExpiresAt = now + SSM_CACHE_TTL_MS;
  return envKey;
};

export type WebSearchHit = {
  url: string;
  title: string;
  snippet: string;
};

export type WebSearchError =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'unauthorized'
  | 'unknown';

export type WebSearchResult =
  | { ok: true; results: WebSearchHit[] }
  | { ok: false; error: WebSearchError; message: string };

// Converse tool spec
export const webSearchToolSpec: Tool = {
  toolSpec: {
    name: 'web_search',
    description:
      'ウェブを検索して最新情報や事実を取得する。固有名詞・最新ニュース・統計など、訓練データに含まれない可能性がある情報が必要なときに使う。',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '検索クエリ。日本語または英語の自然な検索キーワード。',
          },
        },
        required: ['keyword'],
      },
    },
  },
};

const MAX_RESULTS = 3;
const MAX_SNIPPET_CHARS = 500;

const truncate = (s: string, max: number): string => {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const searchUsingBrave = async (keyword: string): Promise<WebSearchResult> => {
  const searchApiKey = await resolveApiKey();
  const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    keyword
  )}&count=${MAX_RESULTS}&text_decorations=0`;

  // Retry up to 2 times on 429 (1s -> 2s backoff)
  const backoffs = [1000, 2000];
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    let response: Response;
    try {
      response = await fetch(searchUrl, {
        headers: {
          'X-Subscription-Token': searchApiKey,
          Accept: 'application/json',
        },
      });
    } catch (e) {
      console.error('Brave search network error', e);
      return { ok: false, error: 'unknown', message: '検索 API への接続に失敗しました。' };
    }

    if (response.status === 429) {
      if (attempt < backoffs.length) {
        await sleep(backoffs[attempt]);
        continue;
      }
      return {
        ok: false,
        error: 'rate_limit',
        message: '検索 API のレート制限に達しました。',
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: 'unauthorized',
        message: '検索 API の認証に失敗しました。',
      };
    }

    if (response.status === 422) {
      return {
        ok: false,
        error: 'quota_exceeded',
        message: '今月の検索クォータを使い切りました。',
      };
    }

    if (!response.ok) {
      console.error('Brave search HTTP error', response.status);
      return { ok: false, error: 'unknown', message: '検索 API でエラーが発生しました。' };
    }

    let data: { web?: { results?: BraveSearchResult[] } };
    try {
      data = await response.json();
    } catch (e) {
      console.error('Brave search JSON parse error', e);
      return { ok: false, error: 'unknown', message: '検索結果の解析に失敗しました。' };
    }

    const rawResults = data.web?.results ?? [];
    const results: WebSearchHit[] = rawResults.slice(0, MAX_RESULTS).map((r) => {
      const extra =
        r.extra_snippets && r.extra_snippets.length > 0
          ? '\n' + r.extra_snippets.join('\n')
          : '';
      return {
        url: r.url,
        title: r.title,
        snippet: truncate((r.description || '') + extra, MAX_SNIPPET_CHARS),
      };
    });
    return { ok: true, results };
  }

  return { ok: false, error: 'unknown', message: '検索 API でエラーが発生しました。' };
};

const searchUsingTavily = async (keyword: string): Promise<WebSearchResult> => {
  const searchApiKey = await resolveApiKey();
  const searchUrl = 'https://api.tavily.com/search';

  let response: Response;
  try {
    response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${searchApiKey}`,
      },
      body: JSON.stringify({
        query: keyword,
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: MAX_RESULTS,
      }),
    });
  } catch (e) {
    console.error('Tavily search network error', e);
    return { ok: false, error: 'unknown', message: '検索 API への接続に失敗しました。' };
  }

  if (response.status === 429) {
    return {
      ok: false,
      error: 'rate_limit',
      message: '検索 API のレート制限に達しました。',
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: 'unauthorized',
      message: '検索 API の認証に失敗しました。',
    };
  }
  if (!response.ok) {
    console.error('Tavily search HTTP error', response.status);
    return { ok: false, error: 'unknown', message: '検索 API でエラーが発生しました。' };
  }

  let data: { results?: TavilySearchResult[] };
  try {
    data = await response.json();
  } catch (e) {
    console.error('Tavily search JSON parse error', e);
    return { ok: false, error: 'unknown', message: '検索結果の解析に失敗しました。' };
  }

  const rawResults = data.results ?? [];
  const results: WebSearchHit[] = rawResults.slice(0, MAX_RESULTS).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: truncate(r.content || '', MAX_SNIPPET_CHARS),
  }));
  return { ok: true, results };
};

export const executeWebSearch = async (
  keyword: string
): Promise<WebSearchResult> => {
  const engine = process.env.SEARCH_ENGINE || 'Brave';
  const apiKey = await resolveApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'unauthorized',
      message: '検索 API キーが設定されていません。',
    };
  }
  if (engine === 'Tavily') {
    return searchUsingTavily(keyword);
  }
  return searchUsingBrave(keyword);
};
