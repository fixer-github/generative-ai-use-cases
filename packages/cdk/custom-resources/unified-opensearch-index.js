const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

const updateStatus = async (event, status, reason, physicalResourceId) => {
  const body = JSON.stringify({
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {},
  });

  const res = await fetch(event.ResponseURL, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': '',
      'Content-Length': body.length.toString(),
    },
  });

  // For recording failures
  console.log(res);
  console.log(await res.text());
};

/**
 * Custom resource handler for creating OpenSearch indexes in managed OpenSearch domains.
 * This is used for the unified OpenSearch domain that supports both:
 * - Bedrock Knowledge Base (vector search)
 * - Assistant RAG documents (vector search)
 */
exports.handler = async (event, context) => {
  // For debugging
  console.log(
    'UnifiedOpenSearchIndex - Event:',
    JSON.stringify(event, null, 2)
  );

  const props = event.ResourceProperties;
  const domainEndpoint = props.domainEndpoint;
  const vectorIndexName = props.vectorIndexName;
  const region = process.env.AWS_DEFAULT_REGION;

  // Create OpenSearch client with SigV4 authentication
  // Use 'es' service for managed OpenSearch (not 'aoss' which is for Serverless)
  const client = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es', // Managed OpenSearch uses 'es' service
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: domainEndpoint,
  });

  const physicalResourceId = `unified-os-index-${vectorIndexName}`;

  try {
    switch (event.RequestType) {
      case 'Create':
        // Parse number/boolean props
        const vectorDimension = Number(props.vectorDimension);
        const ragKnowledgeBaseBinaryVector =
          String(props.ragKnowledgeBaseBinaryVector).toLowerCase() === 'true';

        console.log(
          `Creating index ${vectorIndexName} with dimension ${vectorDimension}, binary: ${ragKnowledgeBaseBinaryVector}`
        );

        // Check if index already exists
        const indexExists = await client.indices.exists({
          index: vectorIndexName,
        });

        if (indexExists.body) {
          console.log(
            `Index ${vectorIndexName} already exists, skipping creation`
          );
          await updateStatus(
            event,
            'SUCCESS',
            'Index already exists',
            physicalResourceId
          );
          return;
        }

        // Determine metadata field mapping based on index type
        // For assistant-docs (metadataField = 'metadata'), use object type with nested fields
        // For Bedrock KB (metadataField = 'AMAZON_BEDROCK_METADATA'), use text type
        const isAssistantDocsIndex = props.metadataField === 'metadata';

        const metadataMapping = isAssistantDocsIndex
          ? {
              type: 'object',
              properties: {
                assistantId: { type: 'keyword' },
                tenantId: { type: 'keyword' },
              },
              dynamic: true, // Allow additional metadata fields
            }
          : {
              type: 'text',
              index: false,
            };

        // Create the index with knn enabled and Japanese analyzer
        await client.indices.create({
          index: vectorIndexName,
          body: {
            mappings: {
              properties: {
                [props.metadataField]: metadataMapping,
                [props.textField]: {
                  type: 'text',
                  analyzer: 'custom_kuromoji_analyzer',
                },
                [props.vectorField]: {
                  type: 'knn_vector',
                  dimension: vectorDimension,
                  ...(ragKnowledgeBaseBinaryVector
                    ? { data_type: 'binary' }
                    : {}),
                  method: {
                    engine: 'faiss',
                    space_type: ragKnowledgeBaseBinaryVector ? 'hamming' : 'l2',
                    name: 'hnsw',
                    parameters: {},
                  },
                },
              },
            },
            settings: {
              index: {
                knn: true,
                'knn.algo_param.ef_search': 100,
                analysis: {
                  analyzer: {
                    custom_kuromoji_analyzer: {
                      type: 'custom',
                      tokenizer: 'kuromoji_tokenizer',
                      filter: [
                        'kuromoji_baseform',
                        'kuromoji_part_of_speech',
                        'kuromoji_stemmer',
                        'lowercase',
                        'ja_stop',
                      ],
                      char_filter: [
                        'kuromoji_iteration_mark',
                        'icu_normalizer',
                        'html_strip',
                      ],
                    },
                  },
                },
              },
            },
          },
        });

        console.log(`Index ${vectorIndexName} created successfully`);

        // Wait for index to be ready with polling instead of fixed sleep
        const maxRetries = 10;
        const pollIntervalMs = 3000;
        for (let i = 0; i < maxRetries; i++) {
          try {
            const health = await client.cluster.health({
              index: vectorIndexName,
              wait_for_status: 'yellow',
              timeout: '5s',
            });
            if (
              health.body.status === 'green' ||
              health.body.status === 'yellow'
            ) {
              console.log(
                `Index ${vectorIndexName} is ready (status: ${health.body.status})`
              );
              break;
            }
          } catch (healthError) {
            console.log(
              `Waiting for index ${vectorIndexName} to be ready... (attempt ${i + 1}/${maxRetries})`
            );
          }
          if (i < maxRetries - 1) {
            await sleep(pollIntervalMs);
          }
        }

        await updateStatus(
          event,
          'SUCCESS',
          'Successfully created index',
          physicalResourceId
        );
        break;

      case 'Update':
        console.log(
          `Update requested for index ${vectorIndexName} - no action taken`
        );
        await updateStatus(
          event,
          'SUCCESS',
          'Update operation is not supported for indexes',
          physicalResourceId
        );
        break;

      case 'Delete':
        const indexName =
          vectorIndexName ||
          event.PhysicalResourceId.replace('unified-os-index-', '');
        console.log(`Deleting index ${indexName}`);

        try {
          // Check if index exists before deleting
          const exists = await client.indices.exists({
            index: indexName,
          });

          if (exists.body) {
            await client.indices.delete({
              index: indexName,
            });
            console.log(`Index ${indexName} deleted successfully`);
          } else {
            console.log(`Index ${indexName} does not exist, skipping deletion`);
          }
        } catch (deleteError) {
          // If the index doesn't exist, that's fine
          if (deleteError.meta?.statusCode === 404) {
            console.log(`Index ${indexName} not found, skipping deletion`);
          } else {
            throw deleteError;
          }
        }

        await updateStatus(
          event,
          'SUCCESS',
          'Successfully deleted',
          physicalResourceId
        );
        break;

      default:
        throw new Error(`Unsupported request type: ${event.RequestType}`);
    }
  } catch (e) {
    console.error('---- Error');
    console.error(e);

    await updateStatus(
      event,
      'FAILED',
      e.message || 'Unknown error',
      physicalResourceId
    );
  }
};
