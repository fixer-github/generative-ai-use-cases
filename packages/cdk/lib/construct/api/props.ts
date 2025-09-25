import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import {
  Agent,
  AgentMap,
  ModelConfiguration,
  SelfSignUpTenantMapEntry,
} from 'generative-ai-use-cases';
import { LitellmProxyServer } from '../litellm-proxy-server';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IIdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { ITenantManager } from '../tenant-manager-interface';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export type GenericApiProps = {
  // Context Params
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly videoBucketRegionMap: Record<string, string>;
  readonly endpointNames: string[];
  readonly queryDecompositionEnabled: boolean;
  readonly rerankingModelId?: string | null;
  readonly customAgents: Agent[];
  readonly crossAccountBedrockRoleArn?: string | null;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly litellmEndpoint?: string | null;
  readonly litellmProxy?: LitellmProxyServer | null;
  readonly environment: string;

  // Resource
  readonly userPool: IUserPool;
  readonly idPool: IIdentityPool;
  readonly userPoolClient: IUserPoolClient;
  readonly table: ITable;
  readonly statsTable: ITable;
  readonly knowledgeBaseId?: string;
  readonly agents?: Agent[];
  readonly guardrailIdentify?: string;
  readonly guardrailVersion?: string;
  // Tenant Management
  readonly tenantManager?: ITenantManager;

  // LangChain Credentials
  readonly openai?: {
    readonly apiKey: string; // OPENAI_API_KEY
  };

  api: RestApi;
  fileBucket: Bucket;

  commonAuthorizerProps: {
    authorizationType: AuthorizationType;
    authorizer: CognitoUserPoolsAuthorizer;
  };

  agentMap: AgentMap;

  // Policy
  sagemakerPolicy?: PolicyStatement;
  bedrockPolicy?: PolicyStatement;
  logsPolicy?: PolicyStatement;
  assumeRolePolicy?: PolicyStatement;

  selfSignUpTenantMap?: SelfSignUpTenantMapEntry[] | null;
};
