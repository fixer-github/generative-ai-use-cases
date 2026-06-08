import * as cdk from 'aws-cdk-lib';
import { Stack, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
  ResponseType,
  EndpointType,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import {
  AnyPrincipal,
  Effect,
  PolicyDocument,
  PolicyStatement,
} from 'aws-cdk-lib/aws-iam';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  IBucket,
} from 'aws-cdk-lib/aws-s3';
import { Agent, AgentInfo, ModelConfiguration } from 'generative-ai-use-cases';
import {
  BEDROCK_IMAGE_GEN_MODELS,
  BEDROCK_VIDEO_GEN_MODELS,
  BEDROCK_RERANKING_MODELS,
  BEDROCK_TEXT_MODELS,
} from '@generative-ai-use-cases/common';
import { allowS3AccessWithSourceIpCondition } from '../utils/s3-access-policy';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import {
  BACKUP_PROTECTED_TAG,
  BACKUP_PROTECTED_METADATA_KEY,
  BACKUP_PROTECTED_METADATA_VALUE,
} from '../aspect/deletion-policy-setter';
import {
  InterfaceVpcEndpoint,
  IVpc,
  ISecurityGroup,
} from 'aws-cdk-lib/aws-ec2';

export interface BackendApiProps {
  // Context Params
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly videoBucketRegionMap: Record<string, string>;
  readonly endpointNames: ModelConfiguration[];
  readonly queryDecompositionEnabled: boolean;
  readonly rerankingModelId?: string | null;
  readonly customAgents: Agent[];
  readonly crossAccountBedrockRoleArn?: string | null;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly additionalS3Buckets?: IBucket[];
  // Web search (chat tool use)
  readonly searchApiKey?: string | null;
  readonly searchEngine?: 'Brave' | 'Tavily';
  // Name of an SSM SecureString parameter holding the search API key. When set, the
  // Lambda fetches the key at runtime; the plaintext never ends up in env vars.
  readonly searchApiKeySsmParameterName?: string | null;

  // Resource
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly userPoolClient: UserPoolClient;
  readonly table: Table;
  readonly statsTable: Table;
  readonly agentObservabilityTable: Table;
  readonly knowledgeBaseId?: string;
  readonly agents?: string;
  readonly guardrailIdentify?: string;
  readonly guardrailVersion?: string;

  // Closed network
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
  readonly apiGatewayVpcEndpoint?: InterfaceVpcEndpoint;
  readonly cognitoUserPoolProxyEndpoint?: string;
}

export class Api extends Construct {
  readonly api: RestApi;
  readonly predictStreamFunction: NodejsFunction;
  readonly invokeFlowFunction: NodejsFunction;
  readonly optimizePromptFunction: NodejsFunction;
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly endpointNames: ModelConfiguration[];
  readonly agents: AgentInfo[];
  readonly fileBucket: Bucket;
  readonly getFileDownloadSignedUrlFunction: IFunction;

  constructor(scope: Construct, id: string, props: BackendApiProps) {
    super(scope, id);

    const {
      modelRegion,
      modelIds,
      imageGenerationModelIds,
      videoGenerationModelIds,
      endpointNames,
      crossAccountBedrockRoleArn,
      userPool,
      userPoolClient,
      table,
      idPool,
      knowledgeBaseId,
      queryDecompositionEnabled,
      rerankingModelId,
      vpc,
      securityGroups,
      apiGatewayVpcEndpoint,
    } = props;
    // Pass both agents sources as separate JSON strings to Lambda
    const builtinAgentsJson = props.agents || '[]';
    const customAgentsJson = JSON.stringify(props.customAgents);

    // Validate Model Names
    for (const model of modelIds) {
      if (!BEDROCK_TEXT_MODELS.includes(model.modelId)) {
        throw new Error(`Unsupported Model Name: ${model.modelId}`);
      }
    }
    for (const model of imageGenerationModelIds) {
      if (!BEDROCK_IMAGE_GEN_MODELS.includes(model.modelId)) {
        throw new Error(`Unsupported Model Name: ${model.modelId}`);
      }
    }
    for (const model of videoGenerationModelIds) {
      if (!BEDROCK_VIDEO_GEN_MODELS.includes(model.modelId)) {
        throw new Error(`Unsupported Model Name: ${model.modelId}`);
      }
    }
    if (
      rerankingModelId &&
      !BEDROCK_RERANKING_MODELS.includes(rerankingModelId)
    ) {
      throw new Error(`Unsupported Model Name: ${rerankingModelId}`);
    }

    // We don't support using the same model ID accross multiple regions
    const duplicateModelIds = new Set(
      [...modelIds, ...imageGenerationModelIds, ...videoGenerationModelIds]
        .map((m) => m.modelId)
        .filter((item, index, arr) => arr.indexOf(item) !== index)
    );
    if (duplicateModelIds.size > 0) {
      throw new Error(
        'Duplicate model IDs detected. Using the same model ID multiple times is not supported:\n' +
          [...duplicateModelIds].map((s) => `- ${s}\n`).join('\n')
      );
    }

    // S3 (File Bucket)
    const fileBucket = new Bucket(this, 'FileBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          // Prevent old versions from accumulating indefinitely
          noncurrentVersionExpiration: Duration.days(90),
          // Remove incomplete multipart upload artifacts (cost optimization)
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });
    fileBucket.node.addMetadata(
      BACKUP_PROTECTED_METADATA_KEY,
      BACKUP_PROTECTED_METADATA_VALUE
    );
    cdk.Tags.of(fileBucket).add(
      BACKUP_PROTECTED_TAG.key,
      BACKUP_PROTECTED_TAG.value
    );
    fileBucket.addCorsRule({
      allowedOrigins: ['*'],
      allowedMethods: [HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT],
      allowedHeaders: ['*'],
      exposedHeaders: [],
      maxAge: 3000,
    });

    // Lambda
    const predictFunction = new NodejsFunction(this, 'Predict', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/predict.ts',
      timeout: Duration.minutes(15),
      environment: {
        MODEL_REGION: modelRegion,
        MODEL_IDS: JSON.stringify(modelIds),
        IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
        VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
        CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
        ...(props.guardrailIdentify
          ? { GUARDRAIL_IDENTIFIER: props.guardrailIdentify }
          : {}),
        ...(props.guardrailVersion
          ? { GUARDRAIL_VERSION: props.guardrailVersion }
          : {}),
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-bedrock-runtime'],
      },
      vpc,
      securityGroups,
    });

    const predictStreamFunction = new NodejsFunction(this, 'PredictStream', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/predictStream.ts',
      timeout: Duration.minutes(15),
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        USER_POOL_PROXY_ENDPOINT: props.cognitoUserPoolProxyEndpoint ?? '',
        MODEL_REGION: modelRegion,
        MODEL_IDS: JSON.stringify(modelIds),
        IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
        VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
        BUILTIN_AGENTS_JSON: builtinAgentsJson,
        CUSTOM_AGENTS_JSON: customAgentsJson,
        CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
        BUCKET_NAME: fileBucket.bucketName,
        KNOWLEDGE_BASE_ID: knowledgeBaseId ?? '',
        ...(props.guardrailIdentify
          ? { GUARDRAIL_IDENTIFIER: props.guardrailIdentify }
          : {}),
        ...(props.guardrailVersion
          ? { GUARDRAIL_VERSION: props.guardrailVersion }
          : {}),
        QUERY_DECOMPOSITION_ENABLED: JSON.stringify(queryDecompositionEnabled),
        RERANKING_MODEL_ID: rerankingModelId ?? '',
        // Prefer SSM parameter name; fall back to literal env var when only the
        // legacy field is set. The Lambda decides which to use at runtime.
        SEARCH_API_KEY: props.searchApiKeySsmParameterName
          ? ''
          : (props.searchApiKey ?? ''),
        SEARCH_API_KEY_SSM_PARAM: props.searchApiKeySsmParameterName ?? '',
        SEARCH_ENGINE: props.searchEngine ?? 'Brave',
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-bedrock-runtime',
          '@aws-sdk/client-bedrock-agent-runtime',
          // The default version of client-sagemaker-runtime does not support StreamingResponse, so specify the version in package.json for bundling
          '@aws-sdk/client-sagemaker-runtime',
          '@aws-sdk/client-ssm',
          'node-html-parser',
        ],
      },
      vpc,
      securityGroups,
    });
    fileBucket.grantReadWrite(predictStreamFunction);
    predictStreamFunction.grantInvoke(idPool.authenticatedRole);

    // Grant SSM SecureString read for the search API key when configured.
    if (props.searchApiKeySsmParameterName) {
      const region = Stack.of(this).region;
      const account = Stack.of(this).account;
      const paramName = props.searchApiKeySsmParameterName.startsWith('/')
        ? props.searchApiKeySsmParameterName.slice(1)
        : props.searchApiKeySsmParameterName;
      predictStreamFunction.role?.addToPrincipalPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter'],
          resources: [
            `arn:aws:ssm:${region}:${account}:parameter/${paramName}`,
          ],
        })
      );
      // SecureString decryption uses the AWS-managed key by default; allow
      // Decrypt against any KMS key in the account scoped via ViaService.
      predictStreamFunction.role?.addToPrincipalPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['kms:Decrypt'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'kms:ViaService': `ssm.${region}.amazonaws.com`,
            },
          },
        })
      );
    }

    // Add Flow Lambda Function
    const invokeFlowFunction = new NodejsFunction(this, 'InvokeFlow', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/invokeFlow.ts',
      timeout: Duration.minutes(15),
      bundling: {
        nodeModules: [
          '@aws-sdk/client-bedrock-runtime',
          '@aws-sdk/client-bedrock-agent-runtime',
        ],
      },
      environment: {
        MODEL_REGION: modelRegion,
      },
      vpc,
      securityGroups,
    });
    invokeFlowFunction.grantInvoke(idPool.authenticatedRole);

    const predictTitleFunction = new NodejsFunction(this, 'PredictTitle', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/predictTitle.ts',
      timeout: Duration.minutes(15),
      bundling: {
        nodeModules: ['@aws-sdk/client-bedrock-runtime'],
      },
      environment: {
        TABLE_NAME: table.tableName,
        MODEL_REGION: modelRegion,
        MODEL_IDS: JSON.stringify(modelIds),
        IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
        VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
        CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
        ...(props.guardrailIdentify
          ? { GUARDRAIL_IDENTIFIER: props.guardrailIdentify }
          : {}),
        ...(props.guardrailVersion
          ? { GUARDRAIL_VERSION: props.guardrailVersion }
          : {}),
      },
      vpc,
      securityGroups,
    });
    table.grantWriteData(predictTitleFunction);

    // Image generation (conditional)
    let generateImageFunction: NodejsFunction | undefined;
    if (imageGenerationModelIds.length > 0) {
      generateImageFunction = new NodejsFunction(this, 'GenerateImage', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/generateImage.ts',
        timeout: Duration.minutes(15),
        environment: {
          MODEL_REGION: modelRegion,
          MODEL_IDS: JSON.stringify(modelIds),
          IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
          VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
          CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
        },
        bundling: {
          nodeModules: ['@aws-sdk/client-bedrock-runtime'],
        },
        vpc,
        securityGroups,
      });
    }

    // Video generation (conditional)
    let generateVideoFunction: NodejsFunction | undefined;
    let copyVideoJob: NodejsFunction | undefined;
    let listVideoJobs: NodejsFunction | undefined;
    let deleteVideoJob: NodejsFunction | undefined;
    if (videoGenerationModelIds.length > 0) {
      generateVideoFunction = new NodejsFunction(this, 'GenerateVideo', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/generateVideo.ts',
        timeout: Duration.minutes(15),
        environment: {
          MODEL_REGION: modelRegion,
          MODEL_IDS: JSON.stringify(modelIds),
          IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
          VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
          VIDEO_BUCKET_OWNER: Stack.of(this).account,
          VIDEO_BUCKET_REGION_MAP: JSON.stringify(props.videoBucketRegionMap),
          CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
          BUCKET_NAME: fileBucket.bucketName,
          TABLE_NAME: table.tableName,
        },
        bundling: {
          nodeModules: ['@aws-sdk/client-bedrock-runtime'],
        },
        vpc,
        securityGroups,
      });
      for (const region of Object.keys(props.videoBucketRegionMap)) {
        const bucketName = props.videoBucketRegionMap[region];
        generateVideoFunction.role?.addToPrincipalPolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['s3:PutObject'],
            resources: [
              `arn:aws:s3:::${bucketName}`,
              `arn:aws:s3:::${bucketName}/*`,
            ],
          })
        );
      }
      table.grantWriteData(generateVideoFunction);

      copyVideoJob = new NodejsFunction(this, 'CopyVideoJob', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/copyVideoJob.ts',
        timeout: Duration.minutes(15),
        memorySize: 512,
        environment: {
          MODEL_REGION: modelRegion,
          MODEL_IDS: JSON.stringify(modelIds),
          IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
          VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
          VIDEO_BUCKET_REGION_MAP: JSON.stringify(props.videoBucketRegionMap),
          CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
          BUCKET_NAME: fileBucket.bucketName,
          TABLE_NAME: table.tableName,
        },
        bundling: {
          nodeModules: ['@aws-sdk/client-bedrock-runtime'],
        },
        vpc,
        securityGroups,
      });
      for (const region of Object.keys(props.videoBucketRegionMap)) {
        const bucketName = props.videoBucketRegionMap[region];
        copyVideoJob.role?.addToPrincipalPolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['s3:GetObject', 's3:DeleteObject', 's3:ListBucket'],
            resources: [
              `arn:aws:s3:::${bucketName}`,
              `arn:aws:s3:::${bucketName}/*`,
            ],
          })
        );
      }
      fileBucket.grantWrite(copyVideoJob);
      table.grantWriteData(copyVideoJob);

      listVideoJobs = new NodejsFunction(this, 'ListVideoJobs', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/listVideoJobs.ts',
        timeout: Duration.minutes(15),
        environment: {
          MODEL_REGION: modelRegion,
          MODEL_IDS: JSON.stringify(modelIds),
          IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
          VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
          VIDEO_BUCKET_REGION_MAP: JSON.stringify(props.videoBucketRegionMap),
          CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
          BUCKET_NAME: fileBucket.bucketName,
          TABLE_NAME: table.tableName,
          COPY_VIDEO_JOB_FUNCTION_ARN: copyVideoJob.functionArn,
        },
        bundling: {
          nodeModules: ['@aws-sdk/client-bedrock-runtime'],
        },
        vpc,
        securityGroups,
      });
      table.grantReadWriteData(listVideoJobs);
      copyVideoJob.grantInvoke(listVideoJobs);

      deleteVideoJob = new NodejsFunction(this, 'DeleteVideoJob', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/deleteVideoJob.ts',
        timeout: Duration.minutes(15),
        environment: {
          MODEL_IDS: JSON.stringify(modelIds),
          IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
          VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
          TABLE_NAME: table.tableName,
        },
        vpc,
        securityGroups,
      });
      table.grantWriteData(deleteVideoJob);
    }

    const optimizePromptFunction = new NodejsFunction(
      this,
      'OptimizePromptFunction',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/optimizePrompt.ts',
        timeout: Duration.minutes(15),
        bundling: {
          nodeModules: ['@aws-sdk/client-bedrock-agent-runtime'],
        },
        environment: {
          MODEL_REGION: modelRegion,
        },
        vpc,
        securityGroups,
      }
    );
    optimizePromptFunction.grantInvoke(idPool.authenticatedRole);

    const getSignedUrlFunction = new NodejsFunction(this, 'GetSignedUrl', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getFileUploadSignedUrl.ts',
      timeout: Duration.minutes(15),
      environment: {
        BUCKET_NAME: fileBucket.bucketName,
      },
      vpc,
      securityGroups,
    });
    // Grant S3 write permissions with source IP condition
    if (getSignedUrlFunction.role) {
      allowS3AccessWithSourceIpCondition(
        fileBucket.bucketName,
        getSignedUrlFunction.role,
        'write',
        {
          ipv4: props.allowedIpV4AddressRanges,
          ipv6: props.allowedIpV6AddressRanges,
        }
      );
    }

    const getFileDownloadSignedUrlFunction = new NodejsFunction(
      this,
      'GetFileDownloadSignedUrlFunction',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/getFileDownloadSignedUrl.ts',
        timeout: Duration.minutes(15),
        environment: {
          CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
          MODEL_REGION: modelRegion,
        },
        vpc,
        securityGroups,
      }
    );
    // Grant S3 read permissions with source IP condition
    if (getFileDownloadSignedUrlFunction.role) {
      // Default bucket permissions
      allowS3AccessWithSourceIpCondition(
        fileBucket.bucketName,
        getFileDownloadSignedUrlFunction.role,
        'read',
        {
          ipv4: props.allowedIpV4AddressRanges,
          ipv6: props.allowedIpV6AddressRanges,
        }
      );

      // Additional buckets permissions (AgentCore, external buckets, etc.)
      if (props.additionalS3Buckets) {
        props.additionalS3Buckets.forEach((bucket) => {
          allowS3AccessWithSourceIpCondition(
            bucket.bucketName,
            getFileDownloadSignedUrlFunction.role!,
            'read',
            {
              ipv4: props.allowedIpV4AddressRanges,
              ipv6: props.allowedIpV6AddressRanges,
            }
          );
        });
      }
    }

    // If SageMaker Endpoint exists, grant permission
    if (endpointNames.length > 0) {
      // SageMaker Policy
      const sagemakerPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sagemaker:DescribeEndpoint', 'sagemaker:InvokeEndpoint'],
        resources: endpointNames.map(
          (endpointName) =>
            `arn:aws:sagemaker:${endpointName.region}:${
              Stack.of(this).account
            }:endpoint/${endpointName.modelId}`
        ),
      });
      predictFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
      predictStreamFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
      generateImageFunction?.role?.addToPrincipalPolicy(sagemakerPolicy);
      generateVideoFunction?.role?.addToPrincipalPolicy(sagemakerPolicy);
      listVideoJobs?.role?.addToPrincipalPolicy(sagemakerPolicy);
      invokeFlowFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
    }

    // Bedrock is always granted permission
    // Bedrock Policy
    if (
      typeof crossAccountBedrockRoleArn !== 'string' ||
      crossAccountBedrockRoleArn === ''
    ) {
      const bedrockPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ['*'],
        actions: [
          'bedrock:*',
          'logs:*',
          'aws-marketplace:Subscribe',
          'aws-marketplace:Unsubscribe',
          'aws-marketplace:ViewSubscriptions',
        ],
      });
      predictStreamFunction.role?.addToPrincipalPolicy(bedrockPolicy);
      predictFunction.role?.addToPrincipalPolicy(bedrockPolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(bedrockPolicy);
      generateImageFunction?.role?.addToPrincipalPolicy(bedrockPolicy);
      generateVideoFunction?.role?.addToPrincipalPolicy(bedrockPolicy);
      listVideoJobs?.role?.addToPrincipalPolicy(bedrockPolicy);
      invokeFlowFunction.role?.addToPrincipalPolicy(bedrockPolicy);
      optimizePromptFunction.role?.addToPrincipalPolicy(bedrockPolicy);
    } else {
      // Policy for when crossAccountBedrockRoleArn is specified
      const logsPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:*'],
        resources: ['*'],
      });
      const assumeRolePolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [crossAccountBedrockRoleArn],
      });
      predictStreamFunction.role?.addToPrincipalPolicy(logsPolicy);
      predictFunction.role?.addToPrincipalPolicy(logsPolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(logsPolicy);
      generateImageFunction?.role?.addToPrincipalPolicy(logsPolicy);
      generateVideoFunction?.role?.addToPrincipalPolicy(logsPolicy);
      listVideoJobs?.role?.addToPrincipalPolicy(logsPolicy);
      predictStreamFunction.role?.addToPrincipalPolicy(assumeRolePolicy);
      predictFunction.role?.addToPrincipalPolicy(assumeRolePolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(assumeRolePolicy);
      generateImageFunction?.role?.addToPrincipalPolicy(assumeRolePolicy);
      generateVideoFunction?.role?.addToPrincipalPolicy(assumeRolePolicy);
      listVideoJobs?.role?.addToPrincipalPolicy(assumeRolePolicy);
      // To get pre-signed URL from S3 in different account
      getFileDownloadSignedUrlFunction.role?.addToPrincipalPolicy(
        assumeRolePolicy
      );
    }

    const createChatFunction = new NodejsFunction(this, 'CreateChat', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/createChat.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantWriteData(createChatFunction);

    const deleteChatFunction = new NodejsFunction(this, 'DeleteChat', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/deleteChat.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadWriteData(deleteChatFunction);

    const createMessagesFunction = new NodejsFunction(this, 'CreateMessages', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/createMessages.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
        STATS_TABLE_NAME: props.statsTable.tableName,
        BUCKET_NAME: fileBucket.bucketName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadWriteData(createMessagesFunction);
    props.statsTable.grantReadWriteData(createMessagesFunction);

    const agentObservabilityFunction = new NodejsFunction(
      this,
      'AgentObservability',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/agentObservability.ts',
        timeout: Duration.minutes(15),
        environment: {
          AGENT_OBSERVABILITY_TABLE_NAME:
            props.agentObservabilityTable.tableName,
          TENANT_ID: Stack.of(this).account,
          ENVIRONMENT_ID: Stack.of(this).stackName,
        },
        vpc,
        securityGroups,
      }
    );
    props.agentObservabilityTable.grantReadWriteData(
      agentObservabilityFunction
    );

    const updateChatTitleFunction = new NodejsFunction(
      this,
      'UpdateChatTitle',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/updateTitle.ts',
        timeout: Duration.minutes(15),
        environment: {
          TABLE_NAME: table.tableName,
        },
        vpc,
        securityGroups,
      }
    );
    table.grantReadWriteData(updateChatTitleFunction);

    const listChatsFunction = new NodejsFunction(this, 'ListChats', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/listChats.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadData(listChatsFunction);

    const findChatbyIdFunction = new NodejsFunction(this, 'FindChatbyId', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/findChatById.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadData(findChatbyIdFunction);

    const listMessagesFunction = new NodejsFunction(this, 'ListMessages', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/listMessages.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadData(listMessagesFunction);

    const updateFeedbackFunction = new NodejsFunction(this, 'UpdateFeedback', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/updateFeedback.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadWriteData(updateFeedbackFunction);

    const getWebTextFunction = new NodejsFunction(this, 'GetWebText', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getWebText.ts',
      timeout: Duration.minutes(15),
      vpc,
      securityGroups,
    });

    const createShareId = new NodejsFunction(this, 'CreateShareId', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/createShareId.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadWriteData(createShareId);

    const getSharedChat = new NodejsFunction(this, 'GetSharedChat', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getSharedChat.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadData(getSharedChat);

    const findShareId = new NodejsFunction(this, 'FindShareId', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/findShareId.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadData(findShareId);

    const deleteShareId = new NodejsFunction(this, 'DeleteShareId', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/deleteShareId.ts',
      timeout: Duration.minutes(15),
      environment: {
        TABLE_NAME: table.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadWriteData(deleteShareId);

    const listSystemContextsFunction = new NodejsFunction(
      this,
      'ListSystemContexts',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/listSystemContexts.ts',
        timeout: Duration.minutes(15),
        environment: {
          TABLE_NAME: table.tableName,
        },
        vpc,
        securityGroups,
      }
    );
    table.grantReadData(listSystemContextsFunction);

    const createSystemContextFunction = new NodejsFunction(
      this,
      'CreateSystemContexts',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/createSystemContext.ts',
        timeout: Duration.minutes(15),
        environment: {
          TABLE_NAME: table.tableName,
        },
        vpc,
        securityGroups,
      }
    );
    table.grantWriteData(createSystemContextFunction);

    const updateSystemContextTitleFunction = new NodejsFunction(
      this,
      'UpdateSystemContextTitle',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/updateSystemContextTitle.ts',
        timeout: Duration.minutes(15),
        environment: {
          TABLE_NAME: table.tableName,
        },
        vpc,
        securityGroups,
      }
    );
    table.grantReadWriteData(updateSystemContextTitleFunction);

    const deleteSystemContextFunction = new NodejsFunction(
      this,
      'DeleteSystemContexts',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/deleteSystemContext.ts',
        timeout: Duration.minutes(15),
        environment: {
          TABLE_NAME: table.tableName,
        },
        vpc,
        securityGroups,
      }
    );
    table.grantReadWriteData(deleteSystemContextFunction);

    const deleteFileFunction = new NodejsFunction(this, 'DeleteFileFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/deleteFile.ts',
      timeout: Duration.minutes(15),
      environment: {
        BUCKET_NAME: fileBucket.bucketName,
      },
      vpc,
      securityGroups,
    });
    fileBucket.grantDelete(deleteFileFunction);

    // Lambda function for getting token usage
    const getTokenUsageFunction = new NodejsFunction(this, 'GetTokenUsage', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getTokenUsage.ts',
      environment: {
        TABLE_NAME: table.tableName,
        STATS_TABLE_NAME: props.statsTable.tableName,
      },
      vpc,
      securityGroups,
    });
    table.grantReadData(getTokenUsageFunction);
    props.statsTable.grantReadData(getTokenUsageFunction);

    // API Gateway
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
    });

    const commonAuthorizerProps = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer,
    };

    const api = new RestApi(this, 'Api', {
      deployOptions: {
        stageName: 'api',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      cloudWatchRole: true,
      defaultMethodOptions: commonAuthorizerProps,
      endpointConfiguration: vpc
        ? {
            types: [EndpointType.PRIVATE],
            vpcEndpoints: [apiGatewayVpcEndpoint!],
          }
        : undefined,
      policy: vpc
        ? new PolicyDocument({
            statements: [apiGatewayVpcEndpoint!].map(
              (e: InterfaceVpcEndpoint) => {
                return new PolicyStatement({
                  effect: Effect.ALLOW,
                  principals: [new AnyPrincipal()],
                  actions: ['execute-api:Invoke'],
                  resources: ['execute-api:/*'],
                  conditions: {
                    StringEquals: {
                      'aws:SourceVpce': e.vpcEndpointId,
                    },
                  },
                });
              }
            ),
          })
        : undefined,
    });

    api.addGatewayResponse('Api4XX', {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    api.addGatewayResponse('Api5XX', {
      type: ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    const predictResource = api.root.addResource('predict');

    // POST: /predict
    predictResource.addMethod(
      'POST',
      new LambdaIntegration(predictFunction),
      commonAuthorizerProps
    );

    // POST: /predict/title
    const predictTitleResource = predictResource.addResource('title');
    predictTitleResource.addMethod(
      'POST',
      new LambdaIntegration(predictTitleFunction),
      commonAuthorizerProps
    );

    const chatsResource = api.root.addResource('chats');

    // POST: /chats
    chatsResource.addMethod(
      'POST',
      new LambdaIntegration(createChatFunction),
      commonAuthorizerProps
    );

    // GET: /chats
    chatsResource.addMethod(
      'GET',
      new LambdaIntegration(listChatsFunction),
      commonAuthorizerProps
    );

    const chatResource = chatsResource.addResource('{chatId}');

    // GET: /chats/{chatId}
    chatResource.addMethod(
      'GET',
      new LambdaIntegration(findChatbyIdFunction),
      commonAuthorizerProps
    );

    // DELETE: /chats/{chatId}
    chatResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteChatFunction),
      commonAuthorizerProps
    );

    const titleResource = chatResource.addResource('title');

    // PUT: /chats/{chatId}/title
    titleResource.addMethod(
      'PUT',
      new LambdaIntegration(updateChatTitleFunction),
      commonAuthorizerProps
    );

    const messagesResource = chatResource.addResource('messages');

    // GET: /chats/{chatId}/messages
    messagesResource.addMethod(
      'GET',
      new LambdaIntegration(listMessagesFunction),
      commonAuthorizerProps
    );

    // POST: /chats/{chatId}/messages
    messagesResource.addMethod(
      'POST',
      new LambdaIntegration(createMessagesFunction),
      commonAuthorizerProps
    );

    const agentObservabilityResource = api.root.addResource(
      'agent-observability'
    );
    const agentObservabilityOperationResource =
      agentObservabilityResource.addResource('{operation}');

    // POST: /agent-observability/{operation}
    agentObservabilityOperationResource.addMethod(
      'POST',
      new LambdaIntegration(agentObservabilityFunction),
      commonAuthorizerProps
    );

    const systemContextsResource = api.root.addResource('systemcontexts');

    // POST: /systemcontexts
    systemContextsResource.addMethod(
      'POST',
      new LambdaIntegration(createSystemContextFunction),
      commonAuthorizerProps
    );

    // GET: /systemcontexts
    systemContextsResource.addMethod(
      'GET',
      new LambdaIntegration(listSystemContextsFunction),
      commonAuthorizerProps
    );

    const systemContextResource =
      systemContextsResource.addResource('{systemContextId}');

    // DELETE: /systemcontexts/{systemContextId}
    systemContextResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteSystemContextFunction),
      commonAuthorizerProps
    );

    const systemContextTitleResource =
      systemContextResource.addResource('title');

    // PUT: /systemcontexts/{systemContextId}/title
    systemContextTitleResource.addMethod(
      'PUT',
      new LambdaIntegration(updateSystemContextTitleFunction),
      commonAuthorizerProps
    );

    const feedbacksResource = chatResource.addResource('feedbacks');

    // POST: /chats/{chatId}/feedbacks
    feedbacksResource.addMethod(
      'POST',
      new LambdaIntegration(updateFeedbackFunction),
      commonAuthorizerProps
    );

    // Image generation API routes (conditional)
    if (generateImageFunction) {
      const imageResource = api.root.addResource('image');
      const imageGenerateResource = imageResource.addResource('generate');
      // POST: /image/generate
      imageGenerateResource.addMethod(
        'POST',
        new LambdaIntegration(generateImageFunction),
        commonAuthorizerProps
      );
    }

    // Video generation API routes (conditional)
    if (generateVideoFunction && listVideoJobs && deleteVideoJob) {
      const videoResource = api.root.addResource('video');
      const videoGenerateResource = videoResource.addResource('generate');
      // POST: /video/generate
      videoGenerateResource.addMethod(
        'POST',
        new LambdaIntegration(generateVideoFunction),
        commonAuthorizerProps
      );
      // GET: /video/generate
      videoGenerateResource.addMethod(
        'GET',
        new LambdaIntegration(listVideoJobs),
        commonAuthorizerProps
      );
      const videoJobResource =
        videoGenerateResource.addResource('{createdDate}');
      // DELETE: /video/generate/{createdDate}
      videoJobResource.addMethod(
        'DELETE',
        new LambdaIntegration(deleteVideoJob),
        commonAuthorizerProps
      );
    }

    // Used in the web content extraction use case
    const webTextResource = api.root.addResource('web-text');
    // GET: /web-text
    webTextResource.addMethod(
      'GET',
      new LambdaIntegration(getWebTextFunction),
      commonAuthorizerProps
    );

    const shareResource = api.root.addResource('shares');
    const shareChatIdResource = shareResource
      .addResource('chat')
      .addResource('{chatId}');
    // GET: /shares/chat/{chatId}
    shareChatIdResource.addMethod(
      'GET',
      new LambdaIntegration(findShareId),
      commonAuthorizerProps
    );
    // POST: /shares/chat/{chatId}
    shareChatIdResource.addMethod(
      'POST',
      new LambdaIntegration(createShareId),
      commonAuthorizerProps
    );
    const shareShareIdResource = shareResource
      .addResource('share')
      .addResource('{shareId}');
    // GET: /shares/share/{shareId}
    shareShareIdResource.addMethod(
      'GET',
      new LambdaIntegration(getSharedChat),
      commonAuthorizerProps
    );
    // DELETE: /shares/share/{shareId}
    shareShareIdResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteShareId),
      commonAuthorizerProps
    );

    const fileResource = api.root.addResource('file');
    const urlResource = fileResource.addResource('url');
    // POST: /file/url
    urlResource.addMethod(
      'POST',
      new LambdaIntegration(getSignedUrlFunction),
      commonAuthorizerProps
    );
    // Get: /file/url
    urlResource.addMethod(
      'GET',
      new LambdaIntegration(getFileDownloadSignedUrlFunction),
      commonAuthorizerProps
    );
    // DELETE: /file/{fileName}
    fileResource
      .addResource('{fileName}')
      .addMethod(
        'DELETE',
        new LambdaIntegration(deleteFileFunction),
        commonAuthorizerProps
      );

    // GET: /token-usage
    const tokenUsageResource = api.root.addResource('token-usage');
    tokenUsageResource.addMethod(
      'GET',
      new LambdaIntegration(getTokenUsageFunction),
      commonAuthorizerProps
    );

    this.api = api;
    this.predictStreamFunction = predictStreamFunction;
    this.invokeFlowFunction = invokeFlowFunction;
    this.optimizePromptFunction = optimizePromptFunction;
    this.modelRegion = modelRegion;
    this.modelIds = modelIds;
    this.imageGenerationModelIds = imageGenerationModelIds;
    this.videoGenerationModelIds = videoGenerationModelIds;
    this.endpointNames = endpointNames;
    // Don't create this.agents - frontend will combine remoteAgentsJson and customAgentsJson
    this.agents = [];
    this.fileBucket = fileBucket;
    this.getFileDownloadSignedUrlFunction = getFileDownloadSignedUrlFunction;
  }
}
