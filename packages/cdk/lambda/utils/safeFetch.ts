import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import { parse as parseHtml, HTMLElement } from 'node-html-parser';

export type FetchUrlError =
  | 'blocked_url'
  | 'invalid_url'
  | 'not_found'
  | 'timeout'
  | 'too_large'
  | 'unsupported_content_type'
  | 'too_many_redirects'
  | 'unknown';

export type FetchUrlResult =
  | {
      ok: true;
      url: string;
      title: string;
      content_markdown: string;
      fetched_at: string;
      truncated: boolean;
    }
  | { ok: false; error: FetchUrlError; message: string };

export const fetchUrlToolSpec: Tool = {
  toolSpec: {
    name: 'fetch_url',
    description:
      '指定された URL のページ本文を取得して読み込む。web_search のスニペットだけでは情報が足りないときに使う。',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '取得する URL (https を推奨)',
          },
        },
        required: ['url'],
      },
    },
  },
};

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 3;
const MAX_CONTENT_CHARS = 8_000;
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/xhtml+xml',
];

// Check if an IPv4 address is in a private / reserved range.
const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255))
    return true; // Reject malformed
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. AWS metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true; // doc/test
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 224) return true; // multicast (some) - reject 224.0.0.0/4
  if (a >= 224) return true; // 224-255: multicast / reserved
  return false;
};

const isPrivateIPv6 = (ip: string): boolean => {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
};

const isPrivateIp = (ip: string): boolean => {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // Unknown
};

// Validate hostname resolves to a public address.
const isHostPublic = async (hostname: string): Promise<boolean> => {
  // If hostname is itself an IP literal, check directly.
  if (isIP(hostname)) {
    return !isPrivateIp(hostname);
  }
  // Reject obvious local names
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return false;
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) return false;
    for (const r of records) {
      if (isPrivateIp(r.address)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const validateUrl = (
  rawUrl: string
): { ok: true; url: URL } | { ok: false; error: FetchUrlError; message: string } => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      error: 'invalid_url',
      message: 'URL の形式が正しくありません。',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'blocked_url',
      message: 'http または https の URL のみ取得できます。',
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: 'blocked_url',
      message: '認証情報を含む URL は取得できません。',
    };
  }
  return { ok: true, url: parsed };
};

const parseContentType = (
  header: string | null
): { mime: string; charset?: string } => {
  if (!header) return { mime: '' };
  const parts = header.split(';').map((p) => p.trim());
  const mime = (parts[0] || '').toLowerCase();
  let charset: string | undefined;
  for (const p of parts.slice(1)) {
    const m = p.match(/^charset=(.+)$/i);
    if (m) charset = m[1].replace(/^["']|["']$/g, '').toLowerCase();
  }
  return { mime, charset };
};

const decodeBytes = (bytes: Uint8Array, charset?: string): string => {
  const cs = (charset || 'utf-8').toLowerCase();
  // Node TextDecoder supports utf-8, iso-8859-1/latin1, windows-1252, shift_jis, euc-jp, etc.
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return Buffer.from(bytes).toString('utf8');
    }
  }
};

// Detect charset from <meta> tag if Content-Type didn't specify one.
const detectCharsetFromHtml = (bytes: Uint8Array): string | undefined => {
  // Look at the first ~1KB as ascii
  const head = Buffer.from(bytes.slice(0, 1024)).toString('latin1');
  const m =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i) ||
    head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i);
  return m ? m[1].toLowerCase() : undefined;
};

// Lightweight readability-ish extraction using node-html-parser.
const extractMainContent = (
  html: string
): { title: string; markdown: string } => {
  const root = parseHtml(html, {
    blockTextElements: {
      script: false,
      noscript: false,
      style: false,
      pre: true,
    },
  });

  const title = (root.querySelector('title')?.text || '').trim();

  // Remove noise
  for (const sel of [
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'header',
    'footer',
    'nav',
    'aside',
    'form',
    'button',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '.advertisement',
    '.ads',
    '.sidebar',
  ]) {
    root.querySelectorAll(sel).forEach((el) => el.remove());
  }

  // Pick the densest container
  const candidates: HTMLElement[] = [
    ...(root.querySelectorAll('article') as HTMLElement[]),
    ...(root.querySelectorAll('main') as HTMLElement[]),
    ...(root.querySelectorAll('[role="main"]') as HTMLElement[]),
  ];
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const len = c.text.length;
    if (len > bestScore) {
      bestScore = len;
      best = c;
    }
  }
  const container = best ?? root.querySelector('body') ?? root;

  // Naive HTML -> markdown-ish text
  const lines: string[] = [];
  const walk = (el: HTMLElement) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag) {
      const txt = el.text.trim();
      if (txt) lines.push(txt);
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag.slice(1), 10);
      const txt = el.text.trim();
      if (txt) lines.push(`${'#'.repeat(level)} ${txt}`);
      return;
    }
    if (tag === 'li') {
      const txt = el.text.trim();
      if (txt) lines.push(`- ${txt}`);
      return;
    }
    if (tag === 'p' || tag === 'blockquote') {
      const txt = el.text.trim();
      if (txt) lines.push(tag === 'blockquote' ? `> ${txt}` : txt);
      return;
    }
    if (tag === 'pre' || tag === 'code') {
      const txt = el.text.trim();
      if (txt) lines.push('```\n' + txt + '\n```');
      return;
    }
    for (const child of el.childNodes as unknown as HTMLElement[]) {
      walk(child);
    }
  };
  walk(container as HTMLElement);

  let markdown = lines.join('\n\n');
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  return { title, markdown };
};

const truncateContent = (
  markdown: string,
  max: number
): { content: string; truncated: boolean } => {
  if (markdown.length <= max) return { content: markdown, truncated: false };
  return { content: markdown.slice(0, max) + '…', truncated: true };
};

const doFetch = async (
  url: URL,
  redirectsLeft: number,
  controller: AbortController
): Promise<
  | { ok: true; response: Response }
  | { ok: false; error: FetchUrlError; message: string }
> => {
  // Validate target host
  const allowed = await isHostPublic(url.hostname);
  if (!allowed) {
    return {
      ok: false,
      error: 'blocked_url',
      message: 'このアドレスは取得できません。',
    };
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; GenU-WebSearch/1.0; +https://aws.amazon.com/)',
        Accept:
          'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'ja,en;q=0.7',
      },
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      return {
        ok: false,
        error: 'timeout',
        message: 'ページの応答が時間内にありませんでした。',
      };
    }
    console.error('fetch error', err);
    return {
      ok: false,
      error: 'unknown',
      message: 'ページの取得に失敗しました。',
    };
  }

  // Handle redirects manually so we can re-validate each hop.
  if (response.status >= 300 && response.status < 400) {
    const loc = response.headers.get('location');
    if (!loc) {
      return {
        ok: false,
        error: 'unknown',
        message: 'リダイレクト先が不明です。',
      };
    }
    if (redirectsLeft <= 0) {
      return {
        ok: false,
        error: 'too_many_redirects',
        message: 'リダイレクト回数が多すぎます。',
      };
    }
    let next: URL;
    try {
      next = new URL(loc, url);
    } catch {
      return {
        ok: false,
        error: 'invalid_url',
        message: 'リダイレクト先 URL が不正です。',
      };
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      return {
        ok: false,
        error: 'blocked_url',
        message: '安全でないプロトコルへのリダイレクトのため取得できません。',
      };
    }
    return doFetch(next, redirectsLeft - 1, controller);
  }

  if (response.status === 404) {
    return { ok: false, error: 'not_found', message: 'ページが見つかりません。' };
  }
  if (!response.ok) {
    console.error('HTTP error', response.status, url.toString());
    return {
      ok: false,
      error: 'unknown',
      message: 'ページの取得に失敗しました。',
    };
  }

  return { ok: true, response };
};

export const executeFetchUrl = async (
  rawUrl: string
): Promise<FetchUrlResult> => {
  const v = validateUrl(rawUrl);
  if (!v.ok) return v;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fetched = await doFetch(v.url, MAX_REDIRECTS, controller);
    if (!fetched.ok) return fetched;
    const response = fetched.response;

    const { mime, charset } = parseContentType(
      response.headers.get('content-type')
    );
    if (mime && !ALLOWED_CONTENT_TYPES.includes(mime)) {
      return {
        ok: false,
        error: 'unsupported_content_type',
        message: 'このコンテンツ形式は読み取れません。',
      };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
      return {
        ok: false,
        error: 'too_large',
        message: 'ページが大きすぎて取得できませんでした。',
      };
    }

    // Read body with hard size cap.
    if (!response.body) {
      return {
        ok: false,
        error: 'unknown',
        message: 'ページ本文が空でした。',
      };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > MAX_BYTES) {
          try {
            await reader.cancel();
          } catch {
            /* noop */
          }
          return {
            ok: false,
            error: 'too_large',
            message: 'ページが大きすぎて取得できませんでした。',
          };
        }
        chunks.push(value);
      }
    } catch (e) {
      // The shared AbortController also aborts the body stream when TIMEOUT_MS
      // elapses after headers arrive, so reader.read() can throw AbortError here.
      const err = e as Error;
      if (err.name === 'AbortError') {
        return {
          ok: false,
          error: 'timeout',
          message: 'ページの応答が時間内にありませんでした。',
        };
      }
      console.error('body read error', err);
      return {
        ok: false,
        error: 'unknown',
        message: 'ページの取得に失敗しました。',
      };
    }

    const bytes = Buffer.concat(chunks);

    const detectedCharset = charset || detectCharsetFromHtml(bytes);
    const html = decodeBytes(bytes, detectedCharset);

    const { title, markdown } = extractMainContent(html);
    const { content, truncated } = truncateContent(markdown, MAX_CONTENT_CHARS);

    return {
      ok: true,
      url: v.url.toString(),
      title,
      content_markdown: content,
      fetched_at: new Date().toISOString(),
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
};
