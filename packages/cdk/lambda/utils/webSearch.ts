import {
  BraveSearchResult,
  TavilySearchResult,
} from 'generative-ai-use-cases';

export type SearchResult = {
  title: string;
  content: string;
  url: string;
  extraSnippets?: string[];
};

export const searchUsingBrave = async (
  keyword: string
): Promise<SearchResult[]> => {
  // https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
  const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(keyword)}&count=3&text_decorations=0`;
  const searchApiKey = process.env.SEARCH_API_KEY || '';
  const response = await fetch(searchUrl, {
    headers: {
      'X-Subscription-Token': searchApiKey,
    },
  });
  const data = await response.json();
  console.log(JSON.stringify(data));

  return data.web.results.map(
    (result: BraveSearchResult): SearchResult => ({
      title: result.title,
      content: result.description,
      url: result.url,
      extraSnippets: result.extra_snippets,
    })
  );
};

export const searchUsingTavily = async (
  keyword: string
): Promise<SearchResult[]> => {
  const searchUrl = 'https://api.tavily.com/search';
  const searchApiKey = process.env.SEARCH_API_KEY || '';

  // https://docs.tavily.com/documentation/api-reference/endpoint/search
  const response = await fetch(searchUrl, {
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
      include_raw_content: true,
      max_results: 3,
    }),
  });

  const data = await response.json();
  console.log(JSON.stringify(data));

  return data.results.map((result: TavilySearchResult) => ({
    title: result.title,
    content: result.raw_content ?? result.content,
    url: result.url,
  }));
};

export const search = async (
  keyword: string,
  engine: 'Brave' | 'Tavily'
): Promise<SearchResult[]> => {
  if (engine === 'Brave') {
    return searchUsingBrave(keyword);
  } else {
    return searchUsingTavily(keyword);
  }
};
