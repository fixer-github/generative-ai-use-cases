import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { HiddenUseCases, HiddenUseCasesKeys } from 'generative-ai-use-cases';
import { getTenant, Tenant } from './tenantManager';
import { verifyToken } from './utils/auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

type TenantConfigResponse = {
  tenantId: string;
  tenantDisplayName: string;
  hiddenFeatures: HiddenUseCases;
};

const HIDDEN_FEATURE_KEYS: HiddenUseCasesKeys[] = [
  'generate',
  'summarize',
  'writer',
  'translate',
  'webContent',
  'image',
  'video',
  'videoAnalyzer',
  'diagram',
  'meetingMinutes',
  'voiceChat',
];

const buildErrorResponse = (
  statusCode: number,
  message: string
): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify({ message }),
});

const normalizeHiddenFeatures = (
  tenant: Tenant | null
): HiddenUseCases => {
  if (!tenant?.hiddenFeatures || typeof tenant.hiddenFeatures !== 'object') {
    return {};
  }

  const normalized: HiddenUseCases = {};
  for (const key of HIDDEN_FEATURE_KEYS) {
    const value = tenant.hiddenFeatures[key];
    if (typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  return normalized;
};

const extractDisplayName = (tenant: Tenant): string => {
  const displayNameCandidates = [
    tenant.metadata?.displayName,
    tenant.metadata?.name,
    tenant.metadata?.tenantDisplayName,
  ];

  for (const candidate of displayNameCandidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }

  return tenant.tenantId;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const token = event.headers?.Authorization || event.headers?.authorization;
    if (!token) {
      return buildErrorResponse(401, 'Missing authorization token');
    }

    const claims = await verifyToken(token);
    if (!claims) {
      return buildErrorResponse(401, 'Invalid token');
    }

    const tenantId =
      claims['custom:tenant_id'] ||
      claims['tenant_id'] ||
      claims['tenantId'];

    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      return buildErrorResponse(400, 'Tenant ID not found in token');
    }

    const tenant = await getTenant(tenantId);

    if (!tenant) {
      return buildErrorResponse(404, 'Tenant not found');
    }

    const response: TenantConfigResponse = {
      tenantId: tenant.tenantId,
      tenantDisplayName: extractDisplayName(tenant),
      hiddenFeatures: normalizeHiddenFeatures(tenant),
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Failed to fetch tenant configuration', error);
    return buildErrorResponse(500, 'Failed to fetch tenant configuration');
  }
};

