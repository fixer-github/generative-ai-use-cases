import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Cognito group that is allowed to manage manuals.
// The existing GenU User Pool already has this group (verified 2026-05-29).
export const ADMIN_GROUP = 'admin';

// Allowed upload formats (scope confirmed 2026-06-01: PDF / TXT / Markdown only).
export const ALLOWED_EXTENSIONS = ['pdf', 'txt', 'md'];

// Content-Type is an auxiliary check; extension is the primary check because some
// clients send application/octet-stream for txt / md uploads.
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/octet-stream',
  '',
];

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const ok = (body: unknown): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: JSON_HEADERS,
  body: JSON.stringify(body),
});

export const error = (
  statusCode: number,
  message: string
): APIGatewayProxyResult => ({
  statusCode,
  headers: JSON_HEADERS,
  body: JSON.stringify({ message }),
});

// The Cognito authorizer of API Gateway serializes cognito:groups inconsistently
// (e.g. "admin", "[admin]" or "[admin, user]"), so parse defensively.
export const parseGroups = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(/[\s,]+/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
};

export const isAdmin = (event: APIGatewayProxyEvent): boolean => {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    return false;
  }
  return parseGroups(claims['cognito:groups']).includes(ADMIN_GROUP);
};

// Extract a lowercase extension (without the dot) from a filename.
export const getExtension = (filename: string): string => {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
};

// Validate the upload format by extension (primary) and Content-Type (auxiliary).
export const validateUploadFormat = (
  filename: string,
  contentType: string | undefined
): { valid: boolean; ext: string; reason?: string } => {
  const ext = getExtension(filename);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      ext,
      reason: `Unsupported extension: .${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }
  const ct = (contentType ?? '').toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.includes(ct)) {
    return {
      valid: false,
      ext,
      reason: `Unsupported Content-Type: ${contentType}`,
    };
  }
  return { valid: true, ext };
};

// Strip the extension from a filename to build a default title.
export const stripExtension = (filename: string): string =>
  filename.replace(/\.[^/.]+$/, '');
