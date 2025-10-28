import { OpenSearchVectorStore } from '@langchain/community/vectorstores/opensearch';
import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { Document } from '@langchain/core/documents';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';

let vectorStore: OpenSearchVectorStore | null = null;
let cachedEndpoint: string | null = null;
let cachedTenantId: string | null = null;

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION! });

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
 * Query tenants table for OpenSearch endpoint
 */
async function getOpenSearchEndpoint(tenantId: string): Promise<string> {
  // Return cached endpoint if tenant hasn't changed
  if (cachedEndpoint && cachedTenantId === tenantId) {
    return cachedEndpoint;
  }

  const tenantsTableName = process.env.TENANTS_TABLE_NAME;

  // Fallback to environment variable for backward compatibility
  if (!tenantsTableName) {
    const envEndpoint = process.env.OPENSEARCH_ENDPOINT;
    if (!envEndpoint) {
      throw new Error(
        'Neither TENANTS_TABLE_NAME nor OPENSEARCH_ENDPOINT environment variable is set'
      );
    }
    console.warn(
      'Using OPENSEARCH_ENDPOINT from environment variable (deprecated)'
    );
    return envEndpoint;
  }

  try {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: tenantsTableName,
        Key: {
          tenantId: { S: tenantId },
        },
      })
    );

    if (!response.Item) {
      throw new Error(`Tenant ${tenantId} not found in tenants table`);
    }

    const tenant = unmarshall(response.Item);
    const endpoint = tenant.openSearchEndpoint;

    if (!endpoint) {
      throw new Error(
        `OpenSearch endpoint not configured for tenant ${tenantId}`
      );
    }

    // Cache for subsequent calls
    cachedEndpoint = endpoint;
    cachedTenantId = tenantId;

    console.log(`Retrieved OpenSearch endpoint for tenant ${tenantId}`);
    return endpoint;
  } catch (error) {
    console.error('Error retrieving OpenSearch endpoint from tenants table:', error);
    throw error;
  }
}

/**
 * Initialize the OpenSearch vector store with AWS credentials
 * @param event API Gateway event to extract tenant context
 */
async function initVectorStore(
  event: APIGatewayProxyEvent
): Promise<OpenSearchVectorStore> {
  const tenantId = getTenantIdFromEvent(event);
  const indexName = process.env.OPENSEARCH_INDEX || 'assistant-docs';
  const region = process.env.AWS_REGION || 'us-east-1';

  // Get OpenSearch endpoint from tenants table
  const endpoint = await getOpenSearchEndpoint(tenantId);

  // If endpoint changed or no vector store exists, create new one
  if (!vectorStore || cachedTenantId !== tenantId) {
    // Ensure endpoint has https:// protocol
    const nodeUrl = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;

    // Create OpenSearch client with AWS Sigv4 authentication
    const client = new Client({
      ...AwsSigv4Signer({
        region,
        service: 'es', // Use 'es' for managed OpenSearch, 'aoss' for OpenSearch Serverless
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: nodeUrl,
    });

    // Initialize embeddings with Bedrock
    const embeddings = new BedrockEmbeddings({
      region,
      model: 'amazon.titan-embed-text-v2:0',
    });

    // Create vector store
    vectorStore = new OpenSearchVectorStore(embeddings, {
      client,
      indexName,
    });
  }

  return vectorStore;
}

/**
 * Index documents for an assistant
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

    // Add assistantId to all document metadata
    const docsWithAssistantId = documents.map((doc) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        assistantId,
      },
    }));

    // Add documents to vector store
    await store.addDocuments(docsWithAssistantId);

    console.log(
      `Successfully indexed ${documents.length} documents for assistant ${assistantId}`
    );
  } catch (error) {
    console.error('Error indexing documents:', error);
    throw error;
  }
}

/**
 * Perform similarity search for relevant documents
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

    // Perform similarity search with metadata filter
    const results = await store.similaritySearch(query, k, {
      assistantId,
    });

    console.log(
      `Found ${results.length} relevant documents for query: ${query.substring(0, 50)}...`
    );

    return results;
  } catch (error) {
    console.error('Error performing similarity search:', error);
    throw error;
  }
}

/**
 * Delete all documents for an assistant
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

    // Get the OpenSearch client
    const client = (store as any).client as Client;

    // Delete by query - remove all documents with matching assistantId
    await client.deleteByQuery({
      index: indexName,
      body: {
        query: {
          term: {
            'metadata.assistantId': assistantId,
          },
        },
      },
    });

    console.log(`Deleted all documents for assistant ${assistantId}`);
  } catch (error) {
    console.error('Error deleting assistant documents:', error);
    throw error;
  }
}
