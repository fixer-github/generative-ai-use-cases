const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

/**
 * Send response to CloudFormation with retry logic
 */
const updateStatus = async (
  event,
  status,
  reason,
  physicalResourceId,
  retries = 3
) => {
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

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(event.ResponseURL, {
        method: 'PUT',
        body,
        headers: {
          'Content-Type': '',
          'Content-Length': body.length.toString(),
        },
      });

      console.log('CloudFormation response:', res.status);

      if (!res.ok) {
        const responseText = await res.text();
        console.error(
          `CloudFormation response failed: ${res.status} - ${responseText}`
        );
        if (i < retries - 1) {
          await sleep(1000 * (i + 1)); // Exponential backoff
          continue;
        }
      }
      return;
    } catch (e) {
      console.error(
        `Failed to send CloudFormation response (attempt ${i + 1}):`,
        e
      );
      if (i < retries - 1) {
        await sleep(1000 * (i + 1));
      }
    }
  }
  console.error('All retries exhausted for CloudFormation response');
};

/**
 * Wait for index to be ready using cluster health API
 */
const waitForIndexReady = async (client, indexName, maxRetries = 10) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const health = await client.cluster.health({
        index: indexName,
        wait_for_status: 'yellow',
        timeout: '5s',
      });
      if (health.body.status !== 'red') {
        console.log(
          `Index ${indexName} is ready with status: ${health.body.status}`
        );
        return;
      }
    } catch (e) {
      console.log(
        `Waiting for index ${indexName} to be ready... (${i + 1}/${maxRetries})`
      );
    }
    await sleep(3000);
  }
  throw new Error(`Index ${indexName} did not become ready within timeout`);
};

/**
 * Creates the kuromoji analyzer settings for Japanese text analysis
 */
const getAnalyzerSettings = () => ({
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
});

/**
 * Creates the Knowledge Base index for Bedrock
 */
const createKnowledgeBaseIndex = async (client, props) => {
  const vectorDimension = Number(props.vectorDimension);
  const binaryVector = props.binaryVector?.toLowerCase() === 'true';

  console.log(`Creating Knowledge Base index: ${props.knowledgeBaseIndexName}`);
  console.log(`Vector dimension: ${vectorDimension}, Binary: ${binaryVector}`);

  await client.indices.create({
    index: props.knowledgeBaseIndexName,
    body: {
      mappings: {
        properties: {
          [props.metadataField]: {
            type: 'text',
            index: false,
          },
          [props.textField]: {
            type: 'text',
            analyzer: 'custom_kuromoji_analyzer',
          },
          [props.vectorField]: {
            type: 'knn_vector',
            dimension: vectorDimension,
            ...(binaryVector ? { data_type: 'binary' } : {}),
            method: {
              engine: 'faiss',
              space_type: binaryVector ? 'hamming' : 'l2',
              name: 'hnsw',
              parameters: {},
            },
          },
        },
      },
      settings: {
        index: {
          knn: true,
        },
        ...getAnalyzerSettings(),
      },
    },
  });

  console.log(`Knowledge Base index created: ${props.knowledgeBaseIndexName}`);
};

/**
 * Creates the Assistant docs index for tenant RAG
 */
const createAssistantIndex = async (client, props) => {
  const vectorDimension = Number(props.vectorDimension);

  console.log(`Creating Assistant index: ${props.assistantIndexName}`);

  await client.indices.create({
    index: props.assistantIndexName,
    body: {
      mappings: {
        properties: {
          text: {
            type: 'text',
            analyzer: 'custom_kuromoji_analyzer',
          },
          embedding: {
            type: 'knn_vector',
            dimension: vectorDimension,
            method: {
              engine: 'faiss',
              space_type: 'l2',
              name: 'hnsw',
              parameters: {},
            },
          },
          metadata: {
            type: 'object',
            properties: {
              assistantId: {
                type: 'keyword',
              },
              source: {
                type: 'keyword',
              },
              tenantId: {
                type: 'keyword',
              },
              fileName: {
                type: 'keyword',
              },
              fileType: {
                type: 'keyword',
              },
            },
          },
        },
      },
      settings: {
        index: {
          knn: true,
        },
        ...getAnalyzerSettings(),
      },
    },
  });

  console.log(`Assistant index created: ${props.assistantIndexName}`);
};

/**
 * Checks if an index exists
 */
const indexExists = async (client, indexName) => {
  try {
    const result = await client.indices.exists({ index: indexName });
    return result.body === true;
  } catch (e) {
    return false;
  }
};

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;
  const domainEndpoint = props.domainEndpoint;
  const region = process.env.AWS_DEFAULT_REGION;

  // Create OpenSearch client for Managed OpenSearch (service: 'es')
  const client = new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es', // 'es' for managed OpenSearch, 'aoss' for serverless
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: `https://${domainEndpoint}`,
  });

  const physicalResourceId = `unified-opensearch-indices-${props.knowledgeBaseIndexName}-${props.assistantIndexName}`;

  try {
    switch (event.RequestType) {
      case 'Create':
        // Create Knowledge Base index
        const kbExists = await indexExists(
          client,
          props.knowledgeBaseIndexName
        );
        if (!kbExists) {
          await createKnowledgeBaseIndex(client, props);
          // Wait for Knowledge Base index to be ready
          await waitForIndexReady(client, props.knowledgeBaseIndexName);
        } else {
          console.log(
            `Knowledge Base index already exists: ${props.knowledgeBaseIndexName}`
          );
        }

        // Create Assistant index
        const assistantExists = await indexExists(
          client,
          props.assistantIndexName
        );
        if (!assistantExists) {
          await createAssistantIndex(client, props);
          // Wait for Assistant index to be ready
          await waitForIndexReady(client, props.assistantIndexName);
        } else {
          console.log(
            `Assistant index already exists: ${props.assistantIndexName}`
          );
        }

        await updateStatus(
          event,
          'SUCCESS',
          'Successfully created indices',
          physicalResourceId
        );
        break;

      case 'Update':
        // For updates, we just verify indices exist
        // We don't modify existing indices to avoid data loss
        const kbExistsUpdate = await indexExists(
          client,
          props.knowledgeBaseIndexName
        );
        const assistantExistsUpdate = await indexExists(
          client,
          props.assistantIndexName
        );

        if (!kbExistsUpdate) {
          await createKnowledgeBaseIndex(client, props);
        }
        if (!assistantExistsUpdate) {
          await createAssistantIndex(client, props);
        }

        await updateStatus(
          event,
          'SUCCESS',
          'Successfully verified/updated indices',
          physicalResourceId
        );
        break;

      case 'Delete':
        // Delete indices
        try {
          const kbExistsDelete = await indexExists(
            client,
            props.knowledgeBaseIndexName
          );
          if (kbExistsDelete) {
            await client.indices.delete({
              index: props.knowledgeBaseIndexName,
            });
            console.log(
              `Deleted Knowledge Base index: ${props.knowledgeBaseIndexName}`
            );
          }
        } catch (e) {
          console.log(`Error deleting KB index: ${e.message}`);
        }

        try {
          const assistantExistsDelete = await indexExists(
            client,
            props.assistantIndexName
          );
          if (assistantExistsDelete) {
            await client.indices.delete({ index: props.assistantIndexName });
            console.log(`Deleted Assistant index: ${props.assistantIndexName}`);
          }
        } catch (e) {
          console.log(`Error deleting Assistant index: ${e.message}`);
        }

        await updateStatus(
          event,
          'SUCCESS',
          'Successfully deleted indices',
          physicalResourceId
        );
        break;
    }
  } catch (e) {
    console.error('Error:', e);
    await updateStatus(event, 'FAILED', e.message, physicalResourceId);
  }
};
