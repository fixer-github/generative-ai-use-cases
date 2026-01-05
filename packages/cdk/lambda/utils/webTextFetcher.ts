import { parse } from 'node-html-parser';
import sanitizeHtml from 'sanitize-html';
import { URL } from 'url';
import dns from 'dns';
import { promisify } from 'util';
import { ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime';

const dnsLookup = promisify(dns.lookup);

// フェッチ結果の型
export type FetchResult = {
  url: string;
  title?: string;
  content?: string;
  success: boolean;
  error?: string;
};

// フェッチオプション
export type FetchOptions = {
  maxLength?: number; // デフォルト: 10000
  timeoutMs?: number; // デフォルト: 30000
};

const DEFAULT_MAX_LENGTH = 10000;
const DEFAULT_TIMEOUT_MS = 30000;

// IPアドレスを数値に変換
const ipToLong = (ip: string): number => {
  return (
    ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0
  );
};

// ブロックするIPアドレス範囲
const BLOCKED_RANGES = [
  // ループバックアドレス
  { start: '127.0.0.0', end: '127.255.255.255' },
  // リンクローカルアドレス
  { start: '169.254.0.0', end: '169.254.255.255' },
  // プライベートネットワークアドレス
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  // AWSメタデータサービス
  { start: '169.254.169.254', end: '169.254.169.254' },
  // localhost
  { start: '0.0.0.0', end: '0.255.255.255' },
];

// ブロックするホスト名
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', 'loopback', 'internal'];

/**
 * IPアドレスがプライベートIPかどうかを判定
 */
export function isPrivateIP(ip: string): boolean {
  const ipLong = ipToLong(ip);
  return BLOCKED_RANGES.some((range) => {
    const startLong = ipToLong(range.start);
    const endLong = ipToLong(range.end);
    return ipLong >= startLong && ipLong <= endLong;
  });
}

/**
 * URLの安全性を検証
 */
export async function validateUrl(
  urlString: string
): Promise<{ valid: boolean; message?: string }> {
  try {
    const url = new URL(urlString);

    // HTTPおよびHTTPSスキームのみ許可
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        valid: false,
        message: 'Unauthorized URL scheme. Only HTTP or HTTPS is allowed.',
      };
    }

    // IPv4アドレスが直接指定されている場合の検証
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    if (ipv4Regex.test(url.hostname)) {
      if (isPrivateIP(url.hostname)) {
        return {
          valid: false,
          message: 'Access to internal networks is not allowed.',
        };
      }
    } else {
      // ドメイン名の場合、DNS解決後のIPをチェック
      try {
        const { address } = await dnsLookup(url.hostname);
        if (isPrivateIP(address)) {
          return {
            valid: false,
            message:
              'Access to domains resolving to internal networks is not allowed.',
          };
        }
      } catch (error) {
        console.error(`DNS lookup error: ${error}`);
        return {
          valid: false,
          message: 'Failed to resolve the specified domain.',
        };
      }
    }

    // localhostに関連するホスト名をブロック
    const hostname = url.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.some((blocked) => hostname.includes(blocked))) {
      return {
        valid: false,
        message: 'Access to internal networks is not allowed.',
      };
    }

    return { valid: true };
  } catch (error) {
    console.error(`URL validation error: ${error}`);
    return { valid: false, message: 'Invalid URL format.' };
  }
}

/**
 * HTMLからタイトルを抽出
 */
function extractTitle(html: string): string | undefined {
  try {
    const root = parse(html);
    const titleElement = root.querySelector('title');
    return titleElement?.text?.trim();
  } catch {
    return undefined;
  }
}

/**
 * HTMLからテキストを抽出
 */
function extractText(html: string, maxLength: number): string {
  // 不正なタグを修正
  const cleanHtml = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'body', 'html'],
  });

  const root = parse(cleanHtml, {
    comment: false,
    blockTextElements: {
      script: false,
      noScript: false,
      style: false,
      pre: false,
    },
  });

  const text = root?.querySelector('body')?.removeWhitespace().text || '';

  // 最大長に切り詰め
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }
  return text;
}

/**
 * タイムアウト付きフェッチ
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; GenAI-UseCases-Bot/1.0; +https://github.com/aws-samples/generative-ai-use-cases-jp)',
      },
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 単一URLからテキストを取得
 */
export async function fetchWebText(
  url: string,
  options?: FetchOptions
): Promise<FetchResult> {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    // URL検証
    const validation = await validateUrl(url);
    if (!validation.valid) {
      return {
        url,
        success: false,
        error: validation.message || 'URL validation failed',
      };
    }

    // コンテンツ取得
    const response = await fetchWithTimeout(url, timeoutMs);

    if (!response.ok) {
      return {
        url,
        success: false,
        error: `HTTP error: ${response.status}`,
      };
    }

    const html = await response.text();
    const title = extractTitle(html);
    const content = extractText(html, maxLength);

    return {
      url,
      title,
      content,
      success: true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error fetching ${url}: ${errorMessage}`);
    return {
      url,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 複数URLから並列でテキストを取得
 */
export async function fetchMultipleWebTexts(
  urls: string[],
  options?: FetchOptions
): Promise<FetchResult[]> {
  // 最大5URLに制限
  const limitedUrls = urls.slice(0, 5);

  const results = await Promise.allSettled(
    limitedUrls.map((url) => fetchWebText(url, options))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        url: limitedUrls[index],
        success: false,
        error: result.reason?.message || 'Unknown error',
      };
    }
  });
}

/**
 * フェッチ結果をToolResultContentBlockに変換
 */
export const createFetchResultContent = (
  result: FetchResult
): ToolResultContentBlock[] => {
  if (result.success) {
    return [
      {
        json: {
          url: result.url,
          title: result.title || '',
          content: result.content || '',
          success: true,
        },
      },
    ];
  } else {
    return [
      {
        text: `Error fetching ${result.url}: ${result.error}`,
      },
    ];
  }
};
