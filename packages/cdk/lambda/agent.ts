import {
  AgentInput,
  AgentOutput,
  BraveSearchResult,
  TavilySearchResult,
} from 'generative-ai-use-cases';
import { StackInput } from '../lib/stack-input';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

type SearchResult = {
  title: string;
  content: string;
  url: string;
  extraSnippets?: string[];
};

// Direct API key (deprecated - for backward compatibility)
const SEARCH_API_KEY_DIRECT = process.env.SEARCH_API_KEY || '';
// Secrets Manager ARN (recommended)
const SEARCH_API_KEY_SECRET_ARN = process.env.SEARCH_API_KEY_SECRET_ARN || '';

// Secrets Manager client
const secretsManagerClient = new SecretsManagerClient({});

// Cache for the API key to avoid repeated Secrets Manager calls
let cachedApiKey: string | null = null;

/**
 * Retrieves the Search API key from Secrets Manager or falls back to direct environment variable.
 * The key is cached to minimize Secrets Manager API calls.
 */
const getSearchApiKey = async (): Promise<string> => {
  // Return cached key if available
  if (cachedApiKey) {
    return cachedApiKey;
  }

  // If using Secrets Manager (recommended)
  if (SEARCH_API_KEY_SECRET_ARN) {
    try {
      const command = new GetSecretValueCommand({
        SecretId: SEARCH_API_KEY_SECRET_ARN,
      });
      const response = await secretsManagerClient.send(command);

      if (response.SecretString) {
        // Try to parse as JSON first (in case it's stored as {"apiKey": "value"})
        try {
          const parsed = JSON.parse(response.SecretString);
          cachedApiKey = parsed.apiKey || parsed.SEARCH_API_KEY || response.SecretString;
        } catch {
          // If not JSON, use the raw string
          cachedApiKey = response.SecretString;
        }
        return cachedApiKey;
      }
      throw new Error('Secret value is empty');
    } catch (error) {
      console.error('Failed to retrieve Search API key from Secrets Manager:', error);
      throw error;
    }
  }

  // Fallback to direct API key (deprecated)
  if (SEARCH_API_KEY_DIRECT) {
    console.warn(
      'WARNING: Using SEARCH_API_KEY environment variable directly is deprecated. ' +
        'Please migrate to SEARCH_API_KEY_SECRET_ARN for improved security.'
    );
    cachedApiKey = SEARCH_API_KEY_DIRECT;
    return cachedApiKey;
  }

  throw new Error(
    'Search API key not configured. Please set either SEARCH_API_KEY_SECRET_ARN or SEARCH_API_KEY.'
  );
};

const searchUsingBrave = async (keyword: string): Promise<SearchResult[]> => {
  // https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
  const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${keyword}&count=3&text_decorations=0`;
  const searchApiKey = await getSearchApiKey();
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

const searchUsingTavily = async (keyword: string): Promise<SearchResult[]> => {
  const searchUrl = 'https://api.tavily.com/search';
  const searchApiKey = await getSearchApiKey();

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

export const handler = async (event: AgentInput): Promise<AgentOutput> => {
  try {
    // Params
    const props = event.requestBody.content['application/json'].properties;
    let keyword = '';
    for (const prop of props) {
      if (prop.name === 'keyword') {
        keyword = prop.value;
      }
    }

    const searchEngine = process.env
      .SEARCH_ENGINE as StackInput['searchEngine'];

    const results =
      searchEngine === 'Brave'
        ? await searchUsingBrave(keyword)
        : await searchUsingTavily(keyword);

    // Create Response Object
    const response_body = {
      'application/json': {
        body: `<search_results>${JSON.stringify(results)}</search_results>`,
      },
    };
    const action_response = {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: 200,
      responseBody: response_body,
    };
    const api_response = {
      messageVersion: '1.0',
      response: action_response,
    };

    return api_response;
  } catch (error: unknown) {
    console.log(error);
    const action_response = {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: 500,
      responseBody: {
        'application/json': {
          body: 'Internal Server Error',
        },
      },
    };
    const api_response = {
      messageVersion: '1.0',
      response: action_response,
    };
    return api_response;
  }
};
