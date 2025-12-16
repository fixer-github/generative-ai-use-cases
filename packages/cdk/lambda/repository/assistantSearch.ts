import { OpenSearchVectorStore } from '@langchain/community/vectorstores/opensearch';
import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { Document } from '@langchain/core/documents';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from '../utils/tenantCredentials';

// Cache for vector store per tenant to avoid credential leakage between tenants
// Key format: `${tenantId}:${endpoint}:${region}`
const vectorStoreCache = new Map<
  string,
  { store: OpenSearchVectorStore; createdAt: number }
>();

// Cache TTL in milliseconds (5 minutes - shorter than typical credential expiry)
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get the unified OpenSearch endpoint from environment variable.
 * All tenants share the same unified OpenSearch domain.
 */
function getUnifiedOpenSearchEndpoint(): string {
  const endpoint = process.env.UNIFIED_OPENSEARCH_ENDPOINT;

  if (!endpoint || endpoint.trim() === '') {
    throw new Error(
      'UNIFIED_OPENSEARCH_ENDPOINT environment variable is required and must not be empty. ' +
        'This should be set to the endpoint of the unified OpenSearch domain.'
    );
  }

  return endpoint.trim();
}

/**
 * Get the OpenSearch region from environment variable.
 * Defaults to AWS_REGION if UNIFIED_OPENSEARCH_REGION is not set.
 */
function getOpenSearchRegion(): string {
  return (
    process.env.UNIFIED_OPENSEARCH_REGION ||
    process.env.AWS_REGION ||
    'us-east-1'
  );
}

/**
 * Extract tenant ID from API Gateway event
 */
function getTenantIdFromEvent(event: APIGatewayProxyEvent): string {
  const tenantId =
    event.requestContext?.authorizer?.claims?.['custom:tenant_id'] ||
    event.requestContext?.authorizer?.['custom:tenant_id'] ||
    process.env.DEFAULT_TENANT_ID ||
    'default';

  if (!tenantId || tenantId === 'default') {
    console.warn('No tenant ID found in request, using default tenant');
  }

  return tenantId;
}

/**
 * Initialize the OpenSearch vector store with AWS credentials.
 * Uses the unified OpenSearch endpoint for all tenants.
 * Cache is tenant-aware to prevent credential leakage between tenants.
 *
 * @param event API Gateway event to extract tenant context
 */
async function initVectorStore(
  event: APIGatewayProxyEvent
): Promise<OpenSearchVectorStore> {
  const indexName = process.env.OPENSEARCH_INDEX || 'assistant-docs';
  const region = getOpenSearchRegion();
  const tenantId = getTenantIdFromEvent(event);

  // Get unified OpenSearch endpoint from environment
  const endpoint = getUnifiedOpenSearchEndpoint();

  // Create cache key based on tenant, endpoint, and region
  const cacheKey = `${tenantId}:${endpoint}:${region}`;

  // Check if we have a valid cached vector store for this tenant
  const cached = vectorStoreCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    console.log(
      `Using cached vector store for tenant ${tenantId} (unified OpenSearch)`
    );
    return cached.store;
  }

  // Remove expired cache entry if exists
  if (cached) {
    vectorStoreCache.delete(cacheKey);
    console.log(
      `Cache expired for tenant ${tenantId}, recreating vector store`
    );
  }

  console.log(
    `Creating new vector store for tenant ${tenantId} (unified OpenSearch: ${endpoint})`
  );

  // Ensure endpoint has https:// protocol
  const nodeUrl = endpoint.startsWith('http')
    ? endpoint
    : `https://${endpoint}`;

  // Get tenant credentials for OpenSearch access
  const { credentials } = await getTenantCredentials(event);

  if (!credentials.AccessKeyId || !credentials.SecretAccessKey) {
    throw new Error('Invalid tenant credentials for OpenSearch access');
  }

  // Create OpenSearch client with AWS Sigv4 authentication using tenant credentials
  // Note: Use 'es' service for managed OpenSearch (not 'aoss' for Serverless)
  const client = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es', // Managed OpenSearch uses 'es' service
      getCredentials: () =>
        Promise.resolve({
          accessKeyId: credentials.AccessKeyId!,
          secretAccessKey: credentials.SecretAccessKey!,
          sessionToken: credentials.SessionToken,
        }),
    }),
    node: nodeUrl,
  });

  // Initialize embeddings with Bedrock using tenant credentials
  const embeddings = new BedrockEmbeddings({
    region,
    model: 'amazon.titan-embed-text-v2:0',
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken,
    },
  });

  // Create vector store
  const newVectorStore = new OpenSearchVectorStore(embeddings, {
    client,
    indexName,
  });

  // Cache the vector store with timestamp for TTL management
  vectorStoreCache.set(cacheKey, {
    store: newVectorStore,
    createdAt: Date.now(),
  });

  return newVectorStore;
}

/**
 * Index documents for an assistant.
 * Documents are stored in the unified OpenSearch domain with assistantId metadata
 * for tenant/assistant-level data isolation.
 *
 * @param assistantId The assistant ID
 * @param documents The documents to index
 * @param event API Gateway event for tenant context
 */
export async function indexDocuments(
  assistantId: string,
  documents: Document[],
  event: APIGatewayProxyEvent
): Promise<void> {
  try {
    const store = await initVectorStore(event);
    const tenantId = getTenantIdFromEvent(event);

    // Add assistantId and tenantId to all document metadata for data isolation
    const docsWithMetadata = documents.map((doc) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        assistantId,
        tenantId, // Add tenantId for additional isolation if needed
      },
    }));

    // Add documents to vector store
    await store.addDocuments(docsWithMetadata);

    console.log(
      `Successfully indexed ${documents.length} documents for assistant ${assistantId} (tenant: ${tenantId})`
    );
  } catch (error) {
    console.error('Error indexing documents:', error);
    throw error;
  }
}

/**
 * Perform similarity search for relevant documents.
 * Filters by both assistantId and tenantId to ensure proper data isolation.
 *
 * @param assistantId The assistant ID to filter by
 * @param query The search query
 * @param event API Gateway event for tenant context
 * @param k The number of results to return
 * @returns Array of relevant documents
 */
export async function similaritySearch(
  assistantId: string,
  query: string,
  event: APIGatewayProxyEvent,
  k: number = 5
): Promise<Document[]> {
  try {
    const store = await initVectorStore(event);
    const tenantId = getTenantIdFromEvent(event);

    // Perform similarity search with metadata filter
    // Filter by both assistantId and tenantId for proper multi-tenant data isolation
    const results = await store.similaritySearch(query, k, {
      assistantId,
      tenantId, // Critical: Filter by tenantId to prevent cross-tenant data leakage
    });

    console.log(
      `Found ${results.length} relevant documents for assistant ${assistantId} (tenant: ${tenantId})`
    );

    return results;
  } catch (error) {
    console.error('Error performing similarity search:', error);
    throw error;
  }
}

/**
 * Delete all documents for an assistant.
 * Filters by both assistantId and tenantId to ensure proper data isolation.
 *
 * @param assistantId The assistant ID
 * @param event API Gateway event for tenant context
 */
export async function deleteAssistantDocuments(
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<void> {
  try {
    const store = await initVectorStore(event);
    const indexName = process.env.OPENSEARCH_INDEX || 'assistant-docs';
    const tenantId = getTenantIdFromEvent(event);

    // Get the OpenSearch client
    const client = (store as any).client as Client;

    // Delete by query - remove all documents with matching assistantId AND tenantId
    // Critical: Filter by both to prevent cross-tenant data deletion
    await client.deleteByQuery({
      index: indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { 'metadata.assistantId': assistantId } },
              { term: { 'metadata.tenantId': tenantId } },
            ],
          },
        },
      },
    });

    console.log(
      `Deleted all documents for assistant ${assistantId} (tenant: ${tenantId})`
    );
  } catch (error) {
    console.error('Error deleting assistant documents:', error);
    throw error;
  }
}
