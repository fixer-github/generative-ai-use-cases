import * as cdk from 'aws-cdk-lib';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ProcessedStackInput } from '../../stack-input';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';

// Embedding models supported by Bedrock
const MODEL_VECTOR_MAPPING: { [key: string]: string } = {
  'amazon.titan-embed-text-v1': '1536',
  'amazon.titan-embed-text-v2:0': '1024',
  'cohere.embed-multilingual-v3': '1024',
  'cohere.embed-english-v3': '1024',
};

const UUID = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';

interface UnifiedOpenSearchIndexProps {
  readonly domainEndpoint: string;
  readonly domainArn: string;
  readonly vectorIndexName: string;
  readonly vectorField: string;
  readonly metadataField: string;
  readonly textField: string;
  readonly vectorDimension: string;
  readonly ragKnowledgeBaseBinaryVector: boolean;
}

class UnifiedOpenSearchIndex extends Construct {
  public readonly customResourceHandler: lambda.IFunction;
  public readonly customResource: cdk.CustomResource;

  constructor(
    scope: Construct,
    id: string,
    props: UnifiedOpenSearchIndexProps
  ) {
    super(scope, id);

    const customResourceHandler = new lambda.SingletonFunction(
      this,
      'UnifiedOpenSearchIndex',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        code: lambda.Code.fromAsset('custom-resources'),
        handler: 'unified-opensearch-index.handler',
        uuid: UUID,
        lambdaPurpose: 'UnifiedOpenSearchIndex',
        timeout: cdk.Duration.minutes(15),
      }
    );

    const customResource = new cdk.CustomResource(this, 'CustomResource', {
      serviceToken: customResourceHandler.functionArn,
      resourceType: 'Custom::UnifiedOsIndex',
      properties: props,
    });

    this.customResourceHandler = customResourceHandler;
    this.customResource = customResource;
  }
}

export interface UnifiedOpenSearchStackProps extends cdk.StackProps {
  params: ProcessedStackInput;
  domainName?: string;
  bedrockKnowledgeBaseIndexName?: string;
  assistantDocsIndexName?: string;
  vectorField?: string;
  metadataField?: string;
  textField?: string;
}

/**
 * Stack that creates a unified managed OpenSearch domain with public endpoint
 * for both Bedrock Knowledge Base and tenant assistant RAG functionality.
 *
 * Key features:
 * - Public endpoint (required for Bedrock Knowledge Base integration)
 * - IAM-based access control (Fine-Grained Access Control)
 * - SigV4 authentication
 * - Two indexes: one for Bedrock KB, one for assistant docs
 */
export class UnifiedOpenSearchStack extends cdk.Stack {
  /**
   * The OpenSearch domain created by this stack
   */
  public readonly domain: opensearch.Domain;

  /**
   * The domain endpoint
   */
  public readonly domainEndpoint: string;

  /**
   * The domain ARN
   */
  public readonly domainArn: string;

  /**
   * IAM role for Bedrock Knowledge Base access
   */
  public readonly knowledgeBaseRole: iam.Role;

  /**
   * IAM role for OpenSearch master user (FGAC admin)
   */
  public readonly openSearchAdminRole: iam.Role;

  /**
   * Index name for Bedrock Knowledge Base
   */
  public readonly bedrockKnowledgeBaseIndexName: string;

  /**
   * Index name for assistant documents
   */
  public readonly assistantDocsIndexName: string;

  /**
   * Vector field name
   */
  public readonly vectorField: string;

  /**
   * Metadata field name
   */
  public readonly metadataField: string;

  /**
   * Text field name
   */
  public readonly textField: string;

  constructor(
    scope: Construct,
    id: string,
    props: UnifiedOpenSearchStackProps
  ) {
    super(scope, id, props);

    const { env, embeddingModelId, ragKnowledgeBaseBinaryVector } =
      props.params;

    // Default values
    const domainName =
      props.domainName ?? `genu-unified-os-${env.toLowerCase()}`;
    this.bedrockKnowledgeBaseIndexName =
      props.bedrockKnowledgeBaseIndexName ?? 'bedrock-knowledge-base-default';
    this.assistantDocsIndexName =
      props.assistantDocsIndexName ?? 'assistant-docs';
    this.vectorField =
      props.vectorField ?? 'bedrock-knowledge-base-default-vector';
    this.metadataField = props.metadataField ?? 'AMAZON_BEDROCK_METADATA';
    this.textField = props.textField ?? 'AMAZON_BEDROCK_TEXT_CHUNK';

    // Validate embedding model
    if (
      typeof embeddingModelId !== 'string' ||
      !MODEL_VECTOR_MAPPING[embeddingModelId]
    ) {
      throw new Error(
        `Invalid embeddingModelId: ${embeddingModelId}. Valid models: ${Object.keys(MODEL_VECTOR_MAPPING).join(', ')}`
      );
    }

    // Create IAM role for OpenSearch admin (FGAC master user)
    // This role can be assumed by Lambda functions that need to manage indexes
    this.openSearchAdminRole = new iam.Role(this, 'OpenSearchAdminRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.AccountRootPrincipal()
      ),
      description:
        'Admin role for OpenSearch FGAC - can be assumed by Lambda and account principals',
    });

    // Create IAM role for Bedrock Knowledge Base
    this.knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description:
        'Role for Bedrock Knowledge Base to access unified OpenSearch domain',
    });

    // Grant Bedrock InvokeModel permissions
    this.knowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ['*'],
        actions: ['bedrock:InvokeModel'],
      })
    );

    // Create OpenSearch domain with public endpoint
    // Note: Bedrock Knowledge Base requires public access - VPC endpoints are not supported
    this.domain = new opensearch.Domain(this, 'UnifiedOpenSearchDomain', {
      version: opensearch.EngineVersion.OPENSEARCH_2_19,
      domainName,
      // Cost-optimized capacity: t3.small.search x 2 nodes
      capacity: {
        dataNodeInstanceType: 't3.small.search',
        dataNodes: 2,
        multiAzWithStandbyEnabled: false,
      },
      ebs: {
        enabled: true,
        volumeSize: 20,
        volumeType: cdk.aws_ec2.EbsDeviceVolumeType.GP3,
      },
      // Zone awareness for high availability
      zoneAwareness: {
        enabled: true,
        availabilityZoneCount: 2,
      },
      // Security settings
      encryptionAtRest: {
        enabled: true,
      },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      // Fine-Grained Access Control with IAM
      // Use dedicated admin role as master user for proper FGAC management
      fineGrainedAccessControl: {
        masterUserArn: this.openSearchAdminRole.roleArn,
      },
      // Logging
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
      },
      // Removal policy
      removalPolicy: props.params.enableAutoDelete
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    // Store domain endpoint and ARN
    this.domainEndpoint = this.domain.domainEndpoint;
    this.domainArn = this.domain.domainArn;

    // Grant OpenSearch access to admin role (for index management)
    this.openSearchAdminRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`${this.domain.domainArn}/*`],
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
      })
    );

    // Grant OpenSearch access to Knowledge Base role
    this.knowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`${this.domain.domainArn}/*`],
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
      })
    );

    // Create access policy for the domain
    // Allow access from:
    // 1. OpenSearch admin role (FGAC master user)
    // 2. Bedrock Knowledge Base service role
    // 3. Account root (for Lambda functions with appropriate IAM policies)
    const accessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [
        this.openSearchAdminRole,
        this.knowledgeBaseRole,
        new iam.ServicePrincipal('bedrock.amazonaws.com'),
        new iam.AccountRootPrincipal(),
      ],
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'es:ESHttpHead',
      ],
      resources: [`${this.domain.domainArn}/*`],
    });

    this.domain.addAccessPolicies(accessPolicy);

    // Add DescribeDomain permission for Bedrock Knowledge Base validation
    const describeDomainPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
      actions: ['es:DescribeDomain'],
      resources: [this.domain.domainArn],
    });

    this.domain.addAccessPolicies(describeDomainPolicy);

    // Create indexes using custom resource
    const vectorDimension = MODEL_VECTOR_MAPPING[embeddingModelId];

    // Create Bedrock Knowledge Base index
    const bedrockIndex = new UnifiedOpenSearchIndex(this, 'BedrockKBIndex', {
      domainEndpoint: `https://${this.domain.domainEndpoint}`,
      domainArn: this.domain.domainArn,
      vectorIndexName: this.bedrockKnowledgeBaseIndexName,
      vectorField: this.vectorField,
      metadataField: this.metadataField,
      textField: this.textField,
      vectorDimension,
      ragKnowledgeBaseBinaryVector,
    });

    // Grant OpenSearch access to index creation Lambda
    bedrockIndex.customResourceHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`${this.domain.domainArn}/*`],
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
      })
    );

    bedrockIndex.customResource.node.addDependency(this.domain);

    // Create assistant docs index
    const assistantIndex = new UnifiedOpenSearchIndex(
      this,
      'AssistantDocsIndex',
      {
        domainEndpoint: `https://${this.domain.domainEndpoint}`,
        domainArn: this.domain.domainArn,
        vectorIndexName: this.assistantDocsIndexName,
        vectorField: 'embedding', // Different field name for assistant docs
        metadataField: 'metadata',
        textField: 'text',
        vectorDimension,
        ragKnowledgeBaseBinaryVector: false, // Assistant docs don't use binary vectors
      }
    );

    assistantIndex.customResourceHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`${this.domain.domainArn}/*`],
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
      })
    );

    assistantIndex.customResource.node.addDependency(this.domain);
    assistantIndex.customResource.node.addDependency(
      bedrockIndex.customResource
    );

    // Export outputs
    new cdk.CfnOutput(this, 'DomainEndpoint', {
      value: `https://${this.domainEndpoint}`,
      description: 'Unified OpenSearch domain endpoint',
      exportName: `${this.stackName}-DomainEndpoint`,
    });

    new cdk.CfnOutput(this, 'DomainArn', {
      value: this.domainArn,
      description: 'Unified OpenSearch domain ARN',
      exportName: `${this.stackName}-DomainArn`,
    });

    new cdk.CfnOutput(this, 'DomainName', {
      value: this.domain.domainName,
      description: 'Unified OpenSearch domain name',
      exportName: `${this.stackName}-DomainName`,
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseRoleArn', {
      value: this.knowledgeBaseRole.roleArn,
      description: 'IAM role ARN for Bedrock Knowledge Base',
      exportName: `${this.stackName}-KnowledgeBaseRoleArn`,
    });

    new cdk.CfnOutput(this, 'BedrockKnowledgeBaseIndexName', {
      value: this.bedrockKnowledgeBaseIndexName,
      description: 'Index name for Bedrock Knowledge Base',
      exportName: `${this.stackName}-BedrockKBIndexName`,
    });

    new cdk.CfnOutput(this, 'AssistantDocsIndexName', {
      value: this.assistantDocsIndexName,
      description: 'Index name for assistant documents',
      exportName: `${this.stackName}-AssistantDocsIndexName`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Purpose', 'UnifiedOpenSearch');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Set stack description
    this.templateOptions.description =
      'Creates unified managed OpenSearch domain for Bedrock Knowledge Base and tenant assistant RAG';
  }

  /**
   * Grant read permissions to a principal
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return this.domain.grantRead(grantee);
  }

  /**
   * Grant write permissions to a principal
   */
  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    return this.domain.grantWrite(grantee);
  }

  /**
   * Grant read/write permissions to a principal
   */
  public grantReadWrite(grantee: iam.IGrantable): iam.Grant {
    return this.domain.grantReadWrite(grantee);
  }

  /**
   * Grant index permissions to a principal
   */
  public grantIndexRead(indexName: string, grantee: iam.IGrantable): iam.Grant {
    return this.domain.grantIndexRead(indexName, grantee);
  }

  /**
   * Grant index write permissions to a principal
   */
  public grantIndexWrite(
    indexName: string,
    grantee: iam.IGrantable
  ): iam.Grant {
    return this.domain.grantIndexWrite(indexName, grantee);
  }

  /**
   * Grant index read/write permissions to a principal
   */
  public grantIndexReadWrite(
    indexName: string,
    grantee: iam.IGrantable
  ): iam.Grant {
    return this.domain.grantIndexReadWrite(indexName, grantee);
  }
}
