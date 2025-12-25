/**
 * AWS Client Utilities
 * AWSクライアントのファクトリとクロスアカウントアクセス
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  Credentials,
} from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentity, Provider } from '@aws-sdk/types';
import { AWSClientConfig } from '../types';

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
 * S3 クライアントを作成する
 */
export function createS3Client(config: AWSClientConfig): S3Client {
  const cacheKey = getCacheKey('s3', config.region, config.profile);
  const cached = clientCache.get(cacheKey);

  if (cached) {
    return cached as S3Client;
  }

  const client = new S3Client({
    region: config.region,
    credentials: config.credentials ?? getCredentialProvider(config.profile),
  });

  clientCache.set(cacheKey, client);
  return client;
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
