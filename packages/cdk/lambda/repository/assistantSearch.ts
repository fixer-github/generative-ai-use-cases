import { OpenSearchVectorStore } from '@langchain/community/vectorstores/opensearch';
import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { Document } from '@langchain/core/documents';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

let vectorStore: OpenSearchVectorStore | null = null;

/**
 * Initialize the OpenSearch vector store with AWS credentials
 */
async function initVectorStore(): Promise<OpenSearchVectorStore> {
  if (vectorStore) {
    return vectorStore;
  }

  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  const indexName = process.env.OPENSEARCH_INDEX || 'assistant-docs';
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  // Create OpenSearch client with AWS Sigv4 authentication
  const client = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'aoss',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: endpoint,
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

  return vectorStore;
}

/**
 * Index documents for an assistant
 * @param assistantId The assistant ID
 * @param documents The documents to index
 */
export async function indexDocuments(
  assistantId: string,
  documents: Document[]
): Promise<void> {
  try {
    const store = await initVectorStore();

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
 * @param k The number of results to return
 * @returns Array of relevant documents
 */
export async function similaritySearch(
  assistantId: string,
  query: string,
  k: number = 5
): Promise<Document[]> {
  try {
    const store = await initVectorStore();

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
 */
export async function deleteAssistantDocuments(
  assistantId: string
): Promise<void> {
  try {
    const store = await initVectorStore();
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
