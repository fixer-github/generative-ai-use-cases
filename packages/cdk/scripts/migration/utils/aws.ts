/**
 * AWS Client Utilities
 * AWSクライアントのファクトリとクロスアカウントアクセス
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStacksCommand,
  StackSummary,
} from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  Credentials,
} from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentity, Provider } from '@aws-sdk/types';

/**
 * AWS クライアント設定
 */
export interface AWSClientConfig {
  region: string;
  profile?: string;
  credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
}

/**
 * クライアントキャッシュ
 */
const clientCache = new Map<string, unknown>();

/**
 * キャッシュキーを生成する
 */
function getCacheKey(
  clientType: string,
  region: string,
  profile?: string
): string {
  return `${clientType}:${region}:${profile || 'default'}`;
}

/**
 * クレデンシャルプロバイダーを取得する
 */
function getCredentialProvider(
  profile?: string
): Provider<AwsCredentialIdentity> | undefined {
  if (profile) {
    return fromIni({ profile });
  }
  return undefined;
}

/**
 * CloudFormation クライアントを作成する
 */
export function createCloudFormationClient(
  config: AWSClientConfig
): CloudFormationClient {
  const cacheKey = getCacheKey('cloudformation', config.region, config.profile);
  const cached = clientCache.get(cacheKey);

  if (cached) {
    return cached as CloudFormationClient;
  }

  const client = new CloudFormationClient({
    region: config.region,
    credentials:
      config.credentials ?? getCredentialProvider(config.profile),
  });

  clientCache.set(cacheKey, client);
  return client;
}

/**
 * DynamoDB クライアントを作成する
 */
export function createDynamoDBClient(config: AWSClientConfig): DynamoDBClient {
  const cacheKey = getCacheKey('dynamodb', config.region, config.profile);
  const cached = clientCache.get(cacheKey);

  if (cached) {
    return cached as DynamoDBClient;
  }

  const client = new DynamoDBClient({
    region: config.region,
    credentials:
      config.credentials ?? getCredentialProvider(config.profile),
  });

  clientCache.set(cacheKey, client);
  return client;
}

/**
 * DynamoDB Document クライアントを作成する
 */
export function createDynamoDBDocClient(
  config: AWSClientConfig
): DynamoDBDocumentClient {
  const dynamoClient = createDynamoDBClient(config);
  return DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

/**
 * STS クライアントを作成する
 */
export function createSTSClient(config: AWSClientConfig): STSClient {
  const cacheKey = getCacheKey('sts', config.region, config.profile);
  const cached = clientCache.get(cacheKey);

  if (cached) {
    return cached as STSClient;
  }

  const client = new STSClient({
    region: config.region,
    credentials:
      config.credentials ?? getCredentialProvider(config.profile),
  });

  clientCache.set(cacheKey, client);
  return client;
}

/**
 * 現在の呼び出し元IDを取得する
 */
export async function getCallerIdentity(
  config: AWSClientConfig
): Promise<{ accountId: string; arn: string; userId: string }> {
  const stsClient = createSTSClient(config);
  const response = await stsClient.send(new GetCallerIdentityCommand({}));

  return {
    accountId: response.Account!,
    arn: response.Arn!,
    userId: response.UserId!,
  };
}

/**
 * テナントのIAMロールをAssumeしてクレデンシャルを取得する
 * 既存パターン: packages/cdk/lambda/utils/tenantDynamoDBClient.ts
 */
export async function assumeTenantRole(
  roleArn: string,
  sessionName: string,
  config: AWSClientConfig
): Promise<Credentials> {
  const stsClient = createSTSClient(config);

  console.log(`ロールをAssume中: ${roleArn}`);

  try {
    const response = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: sessionName,
        DurationSeconds: 3600, // 1時間
      })
    );

    if (!response.Credentials) {
      throw new Error(`ロールのAssumeに失敗しました: ${roleArn}`);
    }

    console.log(`ロールのAssumeに成功しました: ${roleArn}`);
    return response.Credentials;
  } catch (error) {
    console.error(`ロールのAssumeに失敗しました: ${roleArn}`, error);
    throw new Error(`クロスアカウントアクセスに失敗しました: ${error}`);
  }
}

/**
 * テナント用のDynamoDB クライアントを作成する
 */
export async function createTenantDynamoDBClient(
  roleArn: string,
  region: string,
  sessionName: string,
  config: AWSClientConfig
): Promise<DynamoDBDocumentClient> {
  const credentials = await assumeTenantRole(roleArn, sessionName, config);

  const dynamoClient = new DynamoDBClient({
    region,
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken,
    },
  });

  return DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

/**
 * GenU スタックを検索する
 * スタック名パターン: GenerativeAiUseCasesStack{env}
 */
export async function findGenUStacks(
  config: AWSClientConfig
): Promise<StackSummary[]> {
  const client = createCloudFormationClient(config);
  const stacks: StackSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: [
          'CREATE_COMPLETE',
          'UPDATE_COMPLETE',
          'UPDATE_ROLLBACK_COMPLETE',
        ],
      })
    );

    const genUStacks =
      response.StackSummaries?.filter((stack) =>
        stack.StackName?.startsWith('GenerativeAiUseCasesStack')
      ) ?? [];

    stacks.push(...genUStacks);
    nextToken = response.NextToken;
  } while (nextToken);

  return stacks;
}

/**
 * TenantBedrockChatStack を検索する (v0.5.3 Bot テーブル用)
 * スタック名パターン: TenantBedrockChatStack{env}-{tenantId}
 */
export async function findTenantBedrockChatStacks(
  config: AWSClientConfig
): Promise<StackSummary[]> {
  const client = createCloudFormationClient(config);
  const stacks: StackSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: [
          'CREATE_COMPLETE',
          'UPDATE_COMPLETE',
          'UPDATE_ROLLBACK_COMPLETE',
        ],
      })
    );

    const bedrockChatStacks =
      response.StackSummaries?.filter((stack) =>
        stack.StackName?.startsWith('TenantBedrockChatStack')
      ) ?? [];

    stacks.push(...bedrockChatStacks);
    nextToken = response.NextToken;
  } while (nextToken);

  return stacks;
}

/**
 * スタックの詳細と出力を取得する
 */
export async function getStackDetails(
  stackName: string,
  config: AWSClientConfig
): Promise<{
  status: string;
  outputs: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}> {
  const client = createCloudFormationClient(config);

  const response = await client.send(
    new DescribeStacksCommand({
      StackName: stackName,
    })
  );

  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`スタックが見つかりません: ${stackName}`);
  }

  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }

  return {
    status: stack.StackStatus ?? 'UNKNOWN',
    outputs,
    createdAt: stack.CreationTime?.toISOString() ?? '',
    updatedAt: stack.LastUpdatedTime?.toISOString() ?? stack.CreationTime?.toISOString() ?? '',
  };
}

/**
 * キャッシュをクリアする
 */
export function clearClientCache(): void {
  clientCache.clear();
}

/**
 * ARN からアカウントIDを抽出する
 * 形式: arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME
 */
export function extractAccountIdFromArn(arn: string): string | null {
  const match = arn.match(/^arn:aws:iam::(\d+):/);
  return match ? match[1] : null;
}
