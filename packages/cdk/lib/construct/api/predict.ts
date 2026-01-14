import { Construct } from 'constructs';
import { GenericApiProps } from './props';
import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration, Stack } from 'aws-cdk-lib';
import { getBaseEnvironment } from './util';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  TABLE_PREFIX,
  STATS_TABLE_PREFIX,
  USER_SUMMARY_TABLE_PREFIX,
} from './const';

export type PredictApiProps = GenericApiProps;

class PredictApi extends Construct {
  readonly predictStreamFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: PredictApiProps) {
    super(scope, id);

    const {
      modelRegion,
      modelIds,
      imageGenerationModelIds,
      videoGenerationModelIds,
      crossAccountBedrockRoleArn,
      guardrailIdentify,
      guardrailVersion,
      tenantManager,
      openai,
      userPool,
      userPoolClient,
      agentMap,
      api,
      commonAuthorizerProps,
      table,
      fileBucket,
      knowledgeBaseId,
      queryDecompositionEnabled,
      rerankingModelId,
      litellmEndpoint,
      idPool,
      bedrockPolicy,
      sagemakerPolicy,
      logsPolicy,
      assumeRolePolicy,
      litellmProxy,
      environment,
      summaryJobEnabled,
      userSummaryTable,
    } = props;

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
        ...(guardrailIdentify
          ? { GUARDRAIL_IDENTIFIER: guardrailIdentify }
          : {}),
        ...(guardrailVersion ? { GUARDRAIL_VERSION: guardrailVersion } : {}),

        // LangChain Credentials
        OPENAI_API_KEY: openai?.apiKey ?? '',

        // User Summary table for summary context injection (only when enabled)
        ...(summaryJobEnabled && userSummaryTable
          ? {
              USER_SUMMARY_TABLE_NAME: USER_SUMMARY_TABLE_PREFIX,
              DEFAULT_USER_SUMMARY_TABLE_NAME: userSummaryTable.tableName,
              SUMMARY_JOB_ENABLED: 'true',
            }
          : {}),

        // Tenant Management Environment Variables
        ...(tenantManager
          ? {
              TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
            }
          : {}),
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-bedrock-runtime',

          '@langchain/core',
          '@langchain/openai',
        ],
      },
    });

    const predictStreamFunction = new NodejsFunction(this, 'PredictStream', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/predictStream.ts',
      timeout: Duration.minutes(15),
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        IDENTITY_POOL_ID: idPool.identityPoolId,
        AWS_ACCOUNT_ID: Stack.of(this).account!,
        MODEL_REGION: modelRegion,
        MODEL_IDS: JSON.stringify(modelIds),
        IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
        VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
        AGENT_MAP: JSON.stringify(agentMap),
        CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
        BUCKET_NAME: fileBucket.bucketName,
        KNOWLEDGE_BASE_ID: knowledgeBaseId ?? '',
        ...(guardrailIdentify
          ? { GUARDRAIL_IDENTIFIER: guardrailIdentify }
          : {}),
        ...(guardrailVersion ? { GUARDRAIL_VERSION: guardrailVersion } : {}),
        QUERY_DECOMPOSITION_ENABLED: JSON.stringify(queryDecompositionEnabled),
        RERANKING_MODEL_ID: rerankingModelId ?? '',
        LITELLM_ENDPOINT: litellmEndpoint ?? '',

        // LangChain Credentials
        OPENAI_API_KEY: openai?.apiKey ?? '',

        // Environment
        ENVIRONMENT: environment,

        // User Summary table for summary context injection (only when enabled)
        ...(summaryJobEnabled && userSummaryTable
          ? {
              USER_SUMMARY_TABLE_NAME: USER_SUMMARY_TABLE_PREFIX,
              DEFAULT_USER_SUMMARY_TABLE_NAME: userSummaryTable.tableName,
              SUMMARY_JOB_ENABLED: 'true',
            }
          : {}),

        // Tenant Management Environment Variables
        ...(tenantManager
          ? {
              TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
            }
          : {}),
      },
      bundling: {
        nodeModules: [
          'aws-jwt-verify',
          '@aws-sdk/client-bedrock-runtime',
          '@aws-sdk/client-bedrock-agent-runtime',
          // The default version of client-sagemaker-runtime does not support StreamingResponse, so specify the version in package.json for bundling
          '@aws-sdk/client-sagemaker-runtime',

          '@langchain/core',
          '@langchain/openai',
        ],
      },
    });
    fileBucket.grantReadWrite(predictStreamFunction);
    if (userSummaryTable) {
      userSummaryTable.grantReadData(predictStreamFunction);
      userSummaryTable.grantReadData(predictFunction);
    }
    predictStreamFunction.grantInvoke(idPool.authenticatedRole);

    const predictTitleFunction = new NodejsFunction(this, 'PredictTitle', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/predictTitle.ts',
      timeout: Duration.minutes(15),
      bundling: {
        nodeModules: ['@aws-sdk/client-bedrock-runtime'],
      },
      environment: getBaseEnvironment(this, props, {
        MODEL_REGION: modelRegion,
        MODEL_IDS: JSON.stringify(modelIds),
        IMAGE_GENERATION_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
        VIDEO_GENERATION_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
        CROSS_ACCOUNT_BEDROCK_ROLE_ARN: crossAccountBedrockRoleArn ?? '',
        ...(guardrailIdentify
          ? { GUARDRAIL_IDENTIFIER: guardrailIdentify }
          : {}),
        ...(guardrailVersion ? { GUARDRAIL_VERSION: guardrailVersion } : {}),
      }),
    });
    table.grantWriteData(predictTitleFunction);

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

    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(predictStreamFunction);
      tenantManager.tenantsTable.grantReadData(predictFunction);

      // Grant SSM Parameter Store read permissions for OpenFGA configuration
      // This allows Lambda functions to retrieve OpenFGA configuration from SSM after assuming tenant role
      const ssmParameterReadPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiEndpoint`,
          `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiRegion`,
          `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaStoreId`,
        ],
      });

      predictStreamFunction.role?.addToPrincipalPolicy(ssmParameterReadPolicy);
      predictFunction.role?.addToPrincipalPolicy(ssmParameterReadPolicy);

      // Grant Cognito Identity Pool access for AssumeRoleWithWebIdentity
      // This allows predictStreamFunction to exchange Cognito tokens for tenant credentials
      const cognitoIdentityPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-identity:GetId', 'cognito-identity:GetOpenIdToken'],
        resources: ['*'],
      });

      predictStreamFunction.role?.addToPrincipalPolicy(cognitoIdentityPolicy);

      // Grant STS AssumeRoleWithWebIdentity permission
      const stsAssumeRolePolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      });

      predictStreamFunction.role?.addToPrincipalPolicy(stsAssumeRolePolicy);
    }
    if (sagemakerPolicy) {
      predictFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
      predictStreamFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
    }
    if (litellmProxy) {
      litellmProxy.grantInvokeUrl(predictStreamFunction);
      litellmProxy.grantInvokeUrl(predictFunction);
      litellmProxy.grantInvokeUrl(predictTitleFunction);
    }
    if (bedrockPolicy) {
      predictStreamFunction.role?.addToPrincipalPolicy(bedrockPolicy);
      predictFunction.role?.addToPrincipalPolicy(bedrockPolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(bedrockPolicy);
    }
    if (logsPolicy) {
      predictStreamFunction.role?.addToPrincipalPolicy(logsPolicy);
      predictFunction.role?.addToPrincipalPolicy(logsPolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(logsPolicy);
    }
    if (assumeRolePolicy) {
      predictStreamFunction.role?.addToPrincipalPolicy(assumeRolePolicy);
      predictFunction.role?.addToPrincipalPolicy(assumeRolePolicy);
      predictTitleFunction.role?.addToPrincipalPolicy(assumeRolePolicy);
    }
    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(predictTitleFunction);
    }

    this.predictStreamFunction = predictStreamFunction;
  }
}

export default PredictApi;
