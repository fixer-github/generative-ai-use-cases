import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import {
  CognitoUserPoolsAuthorizer,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { Api, LitellmProxyServer, TenantManager } from '../../construct';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ProcessedStackInput } from '../../stack-input';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Agent } from 'generative-ai-use-cases';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';

interface ApiStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly videoBucketRegionMap: Record<string, string>;
  readonly knowledgeBaseId?: string;

  // From other stacks
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly authorizer: CognitoUserPoolsAuthorizer;
  readonly agents?: Agent[];
  readonly guardrailIdentify?: string;
  readonly guardrailVersion?: string;
  readonly userPoolClient: UserPoolClient;
  readonly litellmEndpoint?: string;
  readonly litellmProxy?: LitellmProxyServer;
  readonly table: Table;
  readonly statsTable: Table;
  readonly tenantManager?: TenantManager;
  readonly fileBucket: Bucket;
}

class ApiStack extends Stack {
  readonly restApi: RestApi;
  readonly predictStreamFunction: NodejsFunction;
  readonly invokeFlowFunction: NodejsFunction;
  readonly optimizePromptFunction: NodejsFunction;
  readonly getFileDownloadSignedUrlFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      params,
      videoBucketRegionMap,
      knowledgeBaseId,
      userPool,
      idPool,
      authorizer,
      agents,
      guardrailIdentify,
      guardrailVersion: guardRailVersion,
      userPoolClient,
      litellmEndpoint,
      litellmProxy,
      table,
      statsTable,
      tenantManager,
      fileBucket,
    } = props;

    const apiConstruct = new Api(this, 'Api', {
      modelRegion: params.modelRegion,
      modelIds: params.modelIds,
      imageGenerationModelIds: params.imageGenerationModelIds,
      videoGenerationModelIds: params.videoGenerationModelIds,
      videoBucketRegionMap: videoBucketRegionMap,
      endpointNames: params.endpointNames,
      customAgents: params.agents,
      queryDecompositionEnabled: params.queryDecompositionEnabled,
      rerankingModelId: params.rerankingModelId,
      crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      selfSignUpTenantMap: params.selfSignUpTenantMap,
      environment: params.env,

      knowledgeBaseId: knowledgeBaseId,
      userPool: userPool,
      idPool: idPool,
      authorizer: authorizer,
      agents: agents,
      guardrailIdentify: guardrailIdentify,
      guardrailVersion: guardRailVersion,
      userPoolClient: userPoolClient,
      litellmEndpoint: litellmEndpoint,
      litellmProxy: litellmProxy,
      table: table,
      statsTable: statsTable,
      tenantManager: tenantManager,
      fileBucket: fileBucket,
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: apiConstruct.restApi.url,
    });

    new CfnOutput(this, 'PredictStreamFunctionArn', {
      value: apiConstruct.predictStreamFunction.functionArn,
    });

    new CfnOutput(this, 'OptimizePromptFunctionArn', {
      value: apiConstruct.optimizePromptFunction.functionArn,
    });

    new CfnOutput(this, 'InvokeFlowFunctionArn', {
      value: apiConstruct.invokeFlowFunction.functionArn,
    });

    this.restApi = apiConstruct.restApi;
    this.predictStreamFunction = apiConstruct.predictStreamFunction;
    this.invokeFlowFunction = apiConstruct.invokeFlowFunction;
    this.optimizePromptFunction = apiConstruct.optimizePromptFunction;
    this.getFileDownloadSignedUrlFunction =
      apiConstruct.getFileDownloadSignedUrlFunction;
  }
}

export default ApiStack;
