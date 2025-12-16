import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ProcessedStackInput } from '../../stack-input';

// Embedding models supported by Bedrock
const MODEL_VECTOR_MAPPING: { [key: string]: string } = {
  'amazon.titan-embed-text-v1': '1536',
  'amazon.titan-embed-text-v2:0': '1024',
  'cohere.embed-multilingual-v3': '1024',
  'cohere.embed-english-v3': '1024',
};

// The parsingConfiguration has a feature to read images, graphs, and tables embedded in PDF files.
// The prompt for reading can be defined arbitrarily. The following is defined as a const. By changing the prompt according to the environment, you can expect higher accuracy.
// https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking-parsing.html#kb-advanced-parsing
const PARSING_PROMPT = `Write the text from the image, graph, and table content in the document, and output it in Markdown syntax, not a code block. Follow the following steps:

1. Carefully examine the provided page.

2. Identify all elements on the page. This includes headings, body text, footnotes, tables, visualizations, captions, and page numbers.

3. Output using Markdown syntax:
- Headings: Use # for main headings, ## for sections, ### for sub-sections, etc.
- Lists: Use * or - for bullet points, and 1. 2. 3. for numbered lists.
- Avoid repetition.
- IMPORTANT:Output in same language as the document.

4. If the element is a Visualization:
- Provide a detailed description in natural language.
- Do not transcribe the text in the Visualization after providing the description.

5. If the element is a Table:
- Create a Markdown table with all rows having the same number of columns.
- Keep the cell placement as faithful as possible.
- Do not split the table into multiple tables.
- If a combined cell spans multiple rows or columns, place the text in the top-left cell and output ' ' for other cells.
- Use | for column separators and |-|-| for header row separators.
- If a cell contains multiple items, list them in separate rows.
- If a table has a sub-header, separate the sub-header from the header on a different row.

6. If the element is a Paragraph:
- Transcribe the text elements as they appear.

7. If the element is a Header, Footer, Footnote, or Page Number:
- Transcribe the text elements as they appear.

Output Example:

A bar chart showing annual sales with the Y-axis labeled "Sales ($million)" and the X-axis labeled "Year". The chart has bars for 2018 ($12M), 2019 ($18M), 2020 ($8M), and 2021 ($22M).
Figure 3: This chart shows annual sales in millions of dollars. 2020 was significantly reduced due to the COVID-19 pandemic.

Annual Report
Financial Highlights
Revenue: $40M
Profit: $12M
EPS: $1.25
| | 12/31 ended year | |

2021	2022
Cash Flow:		
Operating Activity	$ 46,327	$ 46,752
Investing Activity	(58,154)	(37,601)
Financial Activity	6,291	9,718`;

const EMBEDDING_MODELS = Object.keys(MODEL_VECTOR_MAPPING);

export interface RagKnowledgeBaseStackProps extends StackProps {
  params: ProcessedStackInput;

  /**
   * Unified OpenSearch domain ARN
   */
  unifiedOpenSearchDomainArn: string;

  /**
   * Unified OpenSearch domain endpoint (without https://)
   */
  unifiedOpenSearchDomainEndpoint: string;

  /**
   * Knowledge Base role ARN from UnifiedOpenSearchStack
   */
  knowledgeBaseRoleArn: string;

  /**
   * Collection/domain name for Knowledge Base
   */
  collectionName?: string;

  /**
   * Vector index name
   * @default 'bedrock-knowledge-base-default'
   */
  vectorIndexName?: string;

  /**
   * Vector field name
   * @default 'bedrock-knowledge-base-default-vector'
   */
  vectorField?: string;

  /**
   * Metadata field name
   * @default 'AMAZON_BEDROCK_METADATA'
   */
  metadataField?: string;

  /**
   * Text field name
   * @default 'AMAZON_BEDROCK_TEXT_CHUNK'
   */
  textField?: string;
}

export class RagKnowledgeBaseStack extends Stack {
  public readonly knowledgeBaseId: string;
  public readonly dataSourceBucketName: string;

  constructor(scope: Construct, id: string, props: RagKnowledgeBaseStackProps) {
    super(scope, id, props);

    const {
      env,
      embeddingModelId,
      ragKnowledgeBaseAdvancedParsing,
      ragKnowledgeBaseAdvancedParsingModelId,
      ragKnowledgeBaseBinaryVector,
      crossAccountBedrockRoleArn,
    } = props.params;

    if (typeof embeddingModelId !== 'string') {
      throw new Error(
        'Knowledge Base RAG is enabled, but embeddingModelId is not specified'
      );
    }

    if (!EMBEDDING_MODELS.includes(embeddingModelId)) {
      throw new Error(
        `embeddingModelId is invalid (valid embeddingModelId: ${EMBEDDING_MODELS})`
      );
    }

    if (crossAccountBedrockRoleArn) {
      throw new Error(
        'With `crossAccountBedrockRoleArn` specified, you must use an existing knowledge base. Create a knowledge base in your Bedrock account and provide its `knowledgeBaseId`.'
      );
    }

    const collectionName =
      props.collectionName ?? `generative-ai-use-cases-jp${env.toLowerCase()}`;
    const vectorIndexName =
      props.vectorIndexName ?? 'bedrock-knowledge-base-default';
    const vectorField =
      props.vectorField ?? 'bedrock-knowledge-base-default-vector';
    const textField = props.textField ?? 'AMAZON_BEDROCK_TEXT_CHUNK';
    const metadataField = props.metadataField ?? 'AMAZON_BEDROCK_METADATA';

    // Use the Knowledge Base role from UnifiedOpenSearchStack
    const knowledgeBaseRole = iam.Role.fromRoleArn(
      this,
      'KnowledgeBaseRole',
      props.knowledgeBaseRoleArn
    );

    if (
      ragKnowledgeBaseAdvancedParsing &&
      typeof ragKnowledgeBaseAdvancedParsingModelId !== 'string'
    ) {
      throw new Error(
        'Knowledge Base RAG Advanced Parsing is enabled, but ragKnowledgeBaseAdvancedParsingModelId is not specified or is not a string'
      );
    }

    // Note: OpenSearch Serverless resources have been removed.
    // The unified OpenSearch domain is created in UnifiedOpenSearchStack
    // and indices are created by the unified-opensearch-index custom resource.

    const accessLogsBucket = new s3.Bucket(this, 'DataSourceAccessLogsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
    });

    const dataSourceBucket = new s3.Bucket(this, 'DataSourceBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'AccessLogs/',
      enforceSSL: true,
    });

    // Grant S3 access to Knowledge Base role via bucket policy
    // Note: bedrock:InvokeModel and es:ESHttp* permissions are already granted in UnifiedOpenSearchStack
    dataSourceBucket.grantRead(knowledgeBaseRole);

    // Create Knowledge Base with Managed OpenSearch storage
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: collectionName,
      roleArn: props.knowledgeBaseRoleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/${embeddingModelId}`,
          ...(ragKnowledgeBaseBinaryVector
            ? {
                embeddingModelConfiguration: {
                  bedrockEmbeddingModelConfiguration: {
                    embeddingDataType: 'BINARY',
                  },
                },
              }
            : {}),
        },
      },
      // Use Managed OpenSearch cluster instead of Serverless
      storageConfiguration: {
        type: 'OPENSEARCH_MANAGED_CLUSTER',
        opensearchManagedClusterConfiguration: {
          domainArn: props.unifiedOpenSearchDomainArn,
          domainEndpoint: `https://${props.unifiedOpenSearchDomainEndpoint}`,
          fieldMapping: {
            metadataField,
            textField,
            vectorField,
          },
          vectorIndexName,
        },
      },
    });

    new bedrock.CfnDataSource(this, 'DataSource', {
      dataSourceConfiguration: {
        s3Configuration: {
          bucketArn: `arn:aws:s3:::${dataSourceBucket.bucketName}`,
          inclusionPrefixes: ['docs/'],
        },
        type: 'S3',
      },
      vectorIngestionConfiguration: {
        ...(ragKnowledgeBaseAdvancedParsing
          ? {
              // Enable Advanced Parsing only if it is enabled
              parsingConfiguration: {
                parsingStrategy: 'BEDROCK_FOUNDATION_MODEL',
                bedrockFoundationModelConfiguration: {
                  modelArn: `arn:aws:bedrock:${this.region}::foundation-model/${ragKnowledgeBaseAdvancedParsingModelId}`,
                  parsingPrompt: {
                    parsingPromptText: PARSING_PROMPT,
                  },
                },
              },
            }
          : {}),
        // If you want to change the chunking strategy, uncomment the following and adjust the various parameters to build an environment suitable for your needs.
        // The following 4 types of chunking strategies are available.
        // - Default (no specification)
        // - Semantic Chunk
        // - Hierarchical Chunk
        // - Standard Chunk
        // Please refer to the following Document for details.
        // https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking-parsing.html
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrock.CfnDataSource.ChunkingConfigurationProperty.html
        //
        // Semantic Chunk
        // chunkingConfiguration: {
        //   chunkingStrategy: 'SEMANTIC',
        //   semanticChunkingConfiguration: {
        //     maxTokens: 300,
        //     bufferSize: 0,
        //     breakpointPercentileThreshold: 95,
        //   },
        // },
        //
        // Hierarchical Chunk
        // chunkingConfiguration: {
        //   chunkingStrategy: 'HIERARCHICAL',
        //   hierarchicalChunkingConfiguration: {
        //     levelConfigurations: [
        //       {
        //         maxTokens: 1500, // Max Token size of the parent chunk
        //       },
        //       {
        //         maxTokens: 300, // Max Token size of the child chunk
        //       },
        //     ],
        //     overlapTokens: 60,
        //   },
        // },
        //
        // Standard Chunk
        // chunkingConfiguration: {
        //   chunkingStrategy: 'FIXED_SIZE',
        //   fixedSizeChunkingConfiguration: {
        //     maxTokens: 300,
        //     overlapPercentage: 10,
        //   },
        // },
      },
      knowledgeBaseId: knowledgeBase.ref,
      name: 's3-data-source',
    });

    // Note: Dependencies on OpenSearch Serverless collection and index have been removed.
    // The unified OpenSearch domain and indices are managed by UnifiedOpenSearchStack.

    new s3Deploy.BucketDeployment(this, 'DeployDocs', {
      sources: [s3Deploy.Source.asset('./rag-docs')],
      destinationBucket: dataSourceBucket,
      // There is a possibility that access logs are still in the same Bucket from the previous configuration, so this setting is left.
      exclude: ['AccessLogs/*', 'logs*'],
      prune: false,
      memoryLimit: 1024,
    });

    this.knowledgeBaseId = knowledgeBase.ref;
    this.dataSourceBucketName = dataSourceBucket.bucketName;
  }
}
