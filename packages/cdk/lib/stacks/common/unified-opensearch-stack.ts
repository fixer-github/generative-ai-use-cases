import * as cdk from 'aws-cdk-lib';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { ProcessedStackInput } from '../../stack-input';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';

// Embedding models supported by Bedrock with their vector dimensions
const MODEL_VECTOR_MAPPING: { [key: string]: string } = {
  'amazon.titan-embed-text-v1': '1536',
  'amazon.titan-embed-text-v2:0': '1024',
  'cohere.embed-multilingual-v3': '1024',
  'cohere.embed-english-v3': '1024',
};

const UUID = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';

export interface UnifiedOpenSearchStackProps extends cdk.StackProps {
  params: ProcessedStackInput;

  /**
   * Domain name for the unified OpenSearch cluster
   * @default 'unified-opensearch'
   */
  domainName?: string;

  /**
   * ARNs of principals that need access to OpenSearch for assistant operations.
   * These will be added to the domain access policy.
   */
  assistantPrincipalArns?: string[];

  /**
   * Data node instance type
   * @default 't3.small.search'
   */
  dataNodeInstanceType?: string;

  /**
   * Number of data nodes
   * @default 2
   */
  dataNodes?: number;

  /**
   * Master node instance type (set to undefined to disable dedicated masters)
   */
  masterNodeInstanceType?: string;

  /**
   * Number of master nodes (0 to disable dedicated masters)
   * @default 0
   */
  masterNodes?: number;

  /**
   * EBS volume size per data node (in GiB)
   * @default 20
   */
  ebsVolumeSize?: number;

  /**
   * EBS volume type
   * @default GP3
   */
  ebsVolumeType?: ec2.EbsDeviceVolumeType;

  /**
   * Enable zone awareness across multiple AZs
   * @default true
   */
  zoneAwarenessEnabled?: boolean;

  /**
   * Number of availability zones (only used if zoneAwarenessEnabled is true)
   * @default 2
   */
  availabilityZoneCount?: number;

  /**
   * Knowledge Base index name
   * @default 'bedrock-knowledge-base-default'
   */
  knowledgeBaseIndexName?: string;

  /**
   * Assistant docs index name
   * @default 'assistant-docs'
   */
  assistantIndexName?: string;

  /**
   * Vector field name for Knowledge Base
   * @default 'bedrock-knowledge-base-default-vector'
   */
  vectorField?: string;

  /**
   * Text field name for Knowledge Base
   * @default 'AMAZON_BEDROCK_TEXT_CHUNK'
   */
  textField?: string;

  /**
   * Metadata field name for Knowledge Base
   * @default 'AMAZON_BEDROCK_METADATA'
   */
  metadataField?: string;

  /**
   * Use binary vectors for Knowledge Base
   * @default false
   */
  binaryVector?: boolean;
}

/**
 * Custom resource for creating OpenSearch indices
 */
class UnifiedOpenSearchIndex extends Construct {
  public readonly customResourceHandler: lambda.IFunction;
  public readonly customResource: cdk.CustomResource;

  constructor(
    scope: Construct,
    id: string,
    props: {
      domainEndpoint: string;
      knowledgeBaseIndexName: string;
      assistantIndexName: string;
      vectorField: string;
      textField: string;
      metadataField: string;
      vectorDimension: string;
      binaryVector: boolean;
    }
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
      resourceType: 'Custom::UnifiedOpenSearchIndex',
      properties: {
        domainEndpoint: props.domainEndpoint,
        knowledgeBaseIndexName: props.knowledgeBaseIndexName,
        assistantIndexName: props.assistantIndexName,
        vectorField: props.vectorField,
        textField: props.textField,
        metadataField: props.metadataField,
        vectorDimension: props.vectorDimension,
        binaryVector: props.binaryVector.toString(),
      },
    });

    this.customResourceHandler = customResourceHandler;
    this.customResource = customResource;
  }
}

/**
 * Stack that creates a unified public OpenSearch domain for both
 * Bedrock Knowledge Base and tenant assistant RAG functionality.
 *
 * This replaces:
 * - OpenSearch Serverless (rag-knowledge-base-stack.ts)
 * - VPC-based Managed OpenSearch (tenant-opensearch-stack.ts)
 *
 * Security is enforced via:
 * - IAM-based access control (SigV4 authentication required)
 * - Fine-Grained Access Control (FGAC) with IAM master user
 * - Resource-based access policies
 */
export class UnifiedOpenSearchStack extends cdk.Stack {
  /**
   * The OpenSearch domain
   */
  public readonly domain: opensearch.Domain;

  /**
   * The domain endpoint (without https://)
   */
  public readonly domainEndpoint: string;

  /**
   * The domain ARN
   */
  public readonly domainArn: string;

  /**
   * The domain name
   */
  public readonly domainName: string;

  /**
   * IAM role for Bedrock Knowledge Base access
   */
  public readonly knowledgeBaseRole: iam.Role;

  /**
   * Knowledge Base index name
   */
  public readonly knowledgeBaseIndexName: string;

  /**
   * Assistant docs index name
   */
  public readonly assistantIndexName: string;

  /**
   * Vector field name
   */
  public readonly vectorField: string;

  /**
   * Text field name
   */
  public readonly textField: string;

  /**
   * Metadata field name
   */
  public readonly metadataField: string;

  constructor(
    scope: Construct,
    id: string,
    props: UnifiedOpenSearchStackProps
  ) {
    super(scope, id, props);

    const { env, embeddingModelId, ragKnowledgeBaseBinaryVector } =
      props.params;

    // Validate embedding model
    if (typeof embeddingModelId !== 'string') {
      throw new Error('embeddingModelId is not specified');
    }

    if (!MODEL_VECTOR_MAPPING[embeddingModelId]) {
      throw new Error(
        `Invalid embeddingModelId: ${embeddingModelId}. Valid models: ${Object.keys(MODEL_VECTOR_MAPPING).join(', ')}`
      );
    }

    // Configuration defaults
    const domainName =
      props.domainName ?? `unified-opensearch-${env.toLowerCase()}`;
    const dataNodeInstanceType =
      props.dataNodeInstanceType ?? 't3.small.search';
    const dataNodes = props.dataNodes ?? 2;
    const masterNodes = props.masterNodes ?? 0;
    const ebsVolumeSize = props.ebsVolumeSize ?? 20;
    const ebsVolumeType = props.ebsVolumeType ?? ec2.EbsDeviceVolumeType.GP3;
    const zoneAwarenessEnabled = props.zoneAwarenessEnabled ?? true;
    const availabilityZoneCount = props.availabilityZoneCount ?? 2;

    // Index configuration
    this.knowledgeBaseIndexName =
      props.knowledgeBaseIndexName ?? 'bedrock-knowledge-base-default';
    this.assistantIndexName = props.assistantIndexName ?? 'assistant-docs';
    this.vectorField =
      props.vectorField ?? 'bedrock-knowledge-base-default-vector';
    this.textField = props.textField ?? 'AMAZON_BEDROCK_TEXT_CHUNK';
    this.metadataField = props.metadataField ?? 'AMAZON_BEDROCK_METADATA';
    const binaryVector =
      props.binaryVector ?? ragKnowledgeBaseBinaryVector ?? false;

    // Create IAM role for Bedrock Knowledge Base
    this.knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description:
        'Role for Bedrock Knowledge Base to access unified OpenSearch',
    });

    // Create the OpenSearch domain (PUBLIC - no VPC configuration)
    // Security is enforced via IAM and FGAC
    this.domain = new opensearch.Domain(this, 'UnifiedOpenSearchDomain', {
      version: opensearch.EngineVersion.OPENSEARCH_2_19,
      domainName,
      capacity: {
        dataNodeInstanceType,
        dataNodes,
        ...(masterNodes > 0 && props.masterNodeInstanceType
          ? {
              masterNodeInstanceType: props.masterNodeInstanceType,
              masterNodes,
            }
          : {}),
        multiAzWithStandbyEnabled: false,
      },
      ebs: {
        enabled: true,
        volumeSize: ebsVolumeSize,
        volumeType: ebsVolumeType,
      },
      zoneAwareness: {
        enabled: zoneAwarenessEnabled,
        availabilityZoneCount: zoneAwarenessEnabled
          ? availabilityZoneCount
          : undefined,
      },
      encryptionAtRest: {
        enabled: true,
      },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      // Fine-Grained Access Control with IAM master user
      fineGrainedAccessControl: {
        masterUserArn: this.knowledgeBaseRole.roleArn,
      },
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
      },
      // Use RETAIN for production environments to prevent accidental data loss
      removalPolicy: this.isProductionEnvironment(env)
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.domainEndpoint = this.domain.domainEndpoint;
    this.domainArn = this.domain.domainArn;
    this.domainName = domainName;

    // Grant Knowledge Base role permissions to access OpenSearch
    this.knowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      })
    );

    this.knowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        resources: [`${this.domain.domainArn}/*`],
      })
    );

    // Add domain access policy for Bedrock service and authenticated IAM principals
    const accessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [
        this.knowledgeBaseRole,
        new iam.ServicePrincipal('bedrock.amazonaws.com'),
      ],
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'es:ESHttpHead',
        'es:DescribeDomain',
      ],
      resources: [this.domain.domainArn, `${this.domain.domainArn}/*`],
    });

    this.domain.addAccessPolicies(accessPolicy);

    // Create custom resource for index creation
    const indexCreator = new UnifiedOpenSearchIndex(this, 'IndexCreator', {
      domainEndpoint: this.domain.domainEndpoint,
      knowledgeBaseIndexName: this.knowledgeBaseIndexName,
      assistantIndexName: this.assistantIndexName,
      vectorField: this.vectorField,
      textField: this.textField,
      metadataField: this.metadataField,
      vectorDimension: MODEL_VECTOR_MAPPING[embeddingModelId],
      binaryVector,
    });

    // Grant the index creator Lambda permission to access OpenSearch
    indexCreator.customResourceHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        resources: [`${this.domain.domainArn}/*`],
      })
    );

    // Add Lambda role to domain access policy
    const lambdaAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [
        new iam.ArnPrincipal(indexCreator.customResourceHandler.role!.roleArn),
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

    this.domain.addAccessPolicies(lambdaAccessPolicy);

    // Add assistant/tenant principal access if provided
    const assistantPrincipals = props.assistantPrincipalArns ?? [];
    if (assistantPrincipals.length > 0) {
      const assistantAccessPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: assistantPrincipals.map((arn) => new iam.ArnPrincipal(arn)),
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        resources: [`${this.domain.domainArn}/*`],
      });
      this.domain.addAccessPolicies(assistantAccessPolicy);
    }

    // Ensure index creation runs after domain is ready
    indexCreator.customResource.node.addDependency(this.domain);

    // Outputs
    new cdk.CfnOutput(this, 'DomainEndpoint', {
      value: this.domainEndpoint,
      description: 'Unified OpenSearch domain endpoint',
      exportName: `${this.stackName}-DomainEndpoint`,
    });

    new cdk.CfnOutput(this, 'DomainArn', {
      value: this.domainArn,
      description: 'Unified OpenSearch domain ARN',
      exportName: `${this.stackName}-DomainArn`,
    });

    new cdk.CfnOutput(this, 'DomainName', {
      value: this.domainName,
      description: 'Unified OpenSearch domain name',
      exportName: `${this.stackName}-DomainName`,
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseRoleArn', {
      value: this.knowledgeBaseRole.roleArn,
      description: 'IAM role ARN for Bedrock Knowledge Base',
      exportName: `${this.stackName}-KnowledgeBaseRoleArn`,
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseIndexName', {
      value: this.knowledgeBaseIndexName,
      description: 'Knowledge Base index name',
      exportName: `${this.stackName}-KnowledgeBaseIndexName`,
    });

    new cdk.CfnOutput(this, 'AssistantIndexName', {
      value: this.assistantIndexName,
      description: 'Assistant docs index name',
      exportName: `${this.stackName}-AssistantIndexName`,
    });

    // Tags
    cdk.Tags.of(this).add('Environment', env);
    cdk.Tags.of(this).add('Purpose', 'UnifiedOpenSearch');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    this.templateOptions.description =
      'Creates a unified public OpenSearch domain for Bedrock Knowledge Base and tenant assistant RAG';
  }

  /**
   * Grant a principal access to the OpenSearch domain for assistant operations
   */
  public grantAssistantAccess(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'es:ESHttpHead',
      ],
      resourceArns: [`${this.domain.domainArn}/*`],
    });
  }

  /**
   * Add a principal to the domain access policy
   */
  public addAccessPolicy(principal: iam.IPrincipal): void {
    const policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [principal],
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'es:ESHttpHead',
      ],
      resources: [`${this.domain.domainArn}/*`],
    });

    this.domain.addAccessPolicies(policy);
  }

  /**
   * Check if the environment is production
   */
  private isProductionEnvironment(env: string): boolean {
    const lowerEnv = env.toLowerCase();
    return lowerEnv === 'prod' || lowerEnv === 'production';
  }
}
