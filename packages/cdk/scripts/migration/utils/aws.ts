/**
 * AWS クライアントファクトリ
 * クロスアカウントアクセス（STS AssumeRole）に対応
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
} from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { AWSCredentials, AWSClientConfig, CrossAccountConfig } from '../config/types';
import { withRetry } from './retry';
import { logger } from './logger';

// CloudFormation 関連の型定義（SDK がない場合でも動作するよう）
interface StackOutput {
  OutputKey?: string;
  OutputValue?: string;
}

interface Stack {
  StackName?: string;
  StackStatus?: string;
  CreationTime?: Date;
  LastUpdatedTime?: Date;
  Outputs?: StackOutput[];
}

interface StackSummary {
  StackName?: string;
  StackStatus?: string;
  CreationTime?: Date;
}

// re-export AWSClientConfig for convenience
export { AWSClientConfig };

// クライアントキャッシュ
const clientCache = new Map<string, unknown>();

/**
 * キャッシュキーを生成
 */
function getCacheKey(type: string, config: AWSClientConfig): string {
  return `${type}:${config.region}:${config.profile ?? 'default'}`;
}

/**
 * CloudFormation クライアントを取得（動的インポート）
 */
async function getCloudFormationClient(config: AWSClientConfig): Promise<unknown> {
  const cacheKey = getCacheKey('cfn', config);

  if (!clientCache.has(cacheKey)) {
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');

    const clientConfig: Record<string, unknown> = {
      region: config.region,
    };

    if (config.profile) {
      clientConfig.credentials = fromIni({ profile: config.profile });
    }

    if (config.credentials) {
      clientConfig.credentials = {
        accessKeyId: config.credentials.accessKeyId,
        secretAccessKey: config.credentials.secretAccessKey,
        sessionToken: config.credentials.sessionToken,
      };
    }

    clientCache.set(cacheKey, new CloudFormationClient(clientConfig));
  }

  return clientCache.get(cacheKey);
}

/**
 * DynamoDB クライアントを取得
 */
export function getDynamoDBClient(config: AWSClientConfig): DynamoDBClient {
  const cacheKey = getCacheKey('ddb', config);

  if (!clientCache.has(cacheKey)) {
    const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
      region: config.region,
    };

    if (config.profile) {
      clientConfig.credentials = fromIni({ profile: config.profile });
    }

    if (config.credentials) {
      clientConfig.credentials = {
        accessKeyId: config.credentials.accessKeyId,
        secretAccessKey: config.credentials.secretAccessKey,
        sessionToken: config.credentials.sessionToken,
      };
    }

    clientCache.set(cacheKey, new DynamoDBClient(clientConfig));
  }

  return clientCache.get(cacheKey) as DynamoDBClient;
}

/**
 * DynamoDB Document クライアントを取得
 */
export function getDynamoDBDocumentClient(
  config: AWSClientConfig
): DynamoDBDocumentClient {
  const cacheKey = getCacheKey('ddb-doc', config);

  if (!clientCache.has(cacheKey)) {
    const dynamoClient = getDynamoDBClient(config);
    clientCache.set(
      cacheKey,
      DynamoDBDocumentClient.from(dynamoClient, {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      })
    );
  }

  return clientCache.get(cacheKey) as DynamoDBDocumentClient;
}

/**
 * STS クライアントを取得
 */
export function getSTSClient(config: AWSClientConfig): STSClient {
  const cacheKey = getCacheKey('sts', config);

  if (!clientCache.has(cacheKey)) {
    const clientConfig: ConstructorParameters<typeof STSClient>[0] = {
      region: config.region,
    };

    if (config.profile) {
      clientConfig.credentials = fromIni({ profile: config.profile });
    }

    clientCache.set(cacheKey, new STSClient(clientConfig));
  }

  return clientCache.get(cacheKey) as STSClient;
}

/**
 * 現在の AWS アイデンティティを取得
 */
export async function getCallerIdentity(
  config: AWSClientConfig
): Promise<{ account: string; arn: string; userId: string }> {
  const stsClient = getSTSClient(config);

  const response = await withRetry(() =>
    stsClient.send(new GetCallerIdentityCommand({}))
  );

  return {
    account: response.Account ?? '',
    arn: response.Arn ?? '',
    userId: response.UserId ?? '',
  };
}

/**
 * クロスアカウントロールを引き受けてクレデンシャルを取得
 */
export async function assumeRole(
  config: AWSClientConfig,
  crossAccountConfig: CrossAccountConfig
): Promise<AWSCredentials> {
  const stsClient = getSTSClient(config);

  logger.debug(
    `ロール引き受け: ${crossAccountConfig.roleArn} (セッション: ${crossAccountConfig.sessionName})`
  );

  const command = new AssumeRoleCommand({
    RoleArn: crossAccountConfig.roleArn,
    RoleSessionName: crossAccountConfig.sessionName,
    ExternalId: crossAccountConfig.externalId,
    DurationSeconds: 3600, // 1時間
  });

  const response = await withRetry(() => stsClient.send(command));

  if (!response.Credentials) {
    throw new Error(
      `ロール引き受けに失敗しました: ${crossAccountConfig.roleArn}`
    );
  }

  return {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
  };
}

/**
 * テナント用の DynamoDB クライアントを取得（クロスアカウント対応）
 */
export async function getTenantDynamoDBClient(
  baseConfig: AWSClientConfig,
  roleArn: string,
  tenantId: string,
  tenantRegion: string
): Promise<DynamoDBClient> {
  const credentials = await assumeRole(baseConfig, {
    accountId: '', // roleArn から推測可能
    roleArn,
    sessionName: `Migration-${tenantId}`,
  });

  return new DynamoDBClient({
    region: tenantRegion,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}

/**
 * テナント用の DynamoDB Document クライアントを取得
 */
export async function getTenantDynamoDBDocumentClient(
  baseConfig: AWSClientConfig,
  roleArn: string,
  tenantId: string,
  tenantRegion: string
): Promise<DynamoDBDocumentClient> {
  const dynamoClient = await getTenantDynamoDBClient(
    baseConfig,
    roleArn,
    tenantId,
    tenantRegion
  );

  return DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

/**
 * GenU スタック一覧を取得
 */
export async function listGenUStacks(
  config: AWSClientConfig
): Promise<StackSummary[]> {
  const { ListStacksCommand } = await import('@aws-sdk/client-cloudformation');
  const cfnClient = await getCloudFormationClient(config) as { send: (cmd: unknown) => Promise<{ StackSummaries?: StackSummary[]; NextToken?: string }> };
  const stacks: StackSummary[] = [];

  let nextToken: string | undefined;

  do {
    const response = await withRetry(() =>
      cfnClient.send(
        new ListStacksCommand({
          NextToken: nextToken,
          StackStatusFilter: [
            'CREATE_COMPLETE',
            'UPDATE_COMPLETE',
            'UPDATE_ROLLBACK_COMPLETE',
          ],
        })
      )
    );

    const genUStacks = (response.StackSummaries ?? []).filter(
      (stack: StackSummary) =>
        stack.StackName?.startsWith('GenerativeAiUseCasesStack') ||
        stack.StackName?.includes('GenU')
    );

    stacks.push(...genUStacks);
    nextToken = response.NextToken;
  } while (nextToken);

  return stacks;
}

/**
 * スタック詳細を取得
 */
export async function describeStack(
  config: AWSClientConfig,
  stackName: string
): Promise<Stack | undefined> {
  const { DescribeStacksCommand } = await import('@aws-sdk/client-cloudformation');
  const cfnClient = await getCloudFormationClient(config) as { send: (cmd: unknown) => Promise<{ Stacks?: Stack[] }> };

  try {
    const response = await withRetry(() =>
      cfnClient.send(
        new DescribeStacksCommand({
          StackName: stackName,
        })
      )
    );

    return response.Stacks?.[0];
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('does not exist')
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * スタック出力から特定のキーの値を取得
 */
export function getStackOutputValue(
  stack: Stack,
  outputKey: string
): string | undefined {
  return stack.Outputs?.find((o) => o.OutputKey === outputKey)?.OutputValue;
}

/**
 * クライアントキャッシュをクリア
 */
export function clearClientCache(): void {
  clientCache.clear();
}

/**
 * テナント用テーブル名を生成
 * @param baseTableName ベーステーブル名 (例: ChatHistory)
 * @param environment 環境名 (例: dev)
 * @param tenantId テナントID
 */
export function generateTenantTableName(
  baseTableName: string,
  environment: string,
  tenantId: string
): string {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${baseTableName}-${environment}-tenant-${sanitizedTenantId}`;
}

/**
 * デフォルトテナントかどうかを判定
 */
export function isDefaultTenant(tenantId: string): boolean {
  return tenantId === 'default' || tenantId === '';
}
