import Stripe from 'stripe';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { TenantDynamoDB } from '../../../../lib/construct/tenant-dynamodb';
import { createTenantDynamoDBClient } from '../../../utils/tenantDynamoDBClient';

/**
 * UserStripeMappingテーブルのアイテム型
 */
interface UserStripeMapping {
  user_id: string;
  stripe_customer_id: string;
  created_at: string;
  updated_at: string;
  email: string;
}

/**
 * シークレットのキャッシュ
 */
let stripeApiKeyCache: string | null = null;

/**
 * テナント固有のDynamoDBクライアントを取得
 * NOTE: テナント分離のため、キャッシュは行わない
 */
async function getTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBDocumentClient> {
  const client = await createTenantDynamoDBClient(event);
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

/**
 * テーブル名を生成する
 */
function generateTableName(tenantId: string): string {
  const environment = process.env.ENVIRONMENT || 'dev';
  return TenantDynamoDB.generateTableName(
    'UserStripeMapping',
    tenantId,
    environment
  );
}

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache) {
    return stripeApiKeyCache;
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  stripeApiKeyCache = secret.apiKey;

  return stripeApiKeyCache!;
}

/**
 * ユーザーのStripe Customer IDを取得または作成
 * 「なければ作る、あれば使い回す」のシンプルなロジック
 *
 * @param event - APIGatewayProxyEvent
 * @param userId - CognitoユーザーID
 * @param userEmail - ユーザーのメールアドレス
 * @param tenantId - テナントID
 * @returns Stripe Customer ID
 */
export async function getOrCreateStripeCustomerId(
  event: APIGatewayProxyEvent,
  userId: string,
  userEmail: string,
  tenantId: string
): Promise<string> {
  const tableName = generateTableName(tenantId);
  const dynamoDB = await getTenantDynamoDBClient(event);

  console.log('Getting or creating Stripe Customer ID:', {
    userId,
    userEmail,
    tenantId,
    tableName,
  });

  // 1. まず既存のマッピングを探す
  try {
    const getCommand = new GetCommand({
      TableName: tableName,
      Key: {
        user_id: userId,
      },
    });

    const existingItem = await dynamoDB.send(getCommand);

    // 2. あればそのまま返す
    if (existingItem.Item) {
      console.log('Found existing Stripe Customer ID:', {
        userId,
        stripeCustomerId: existingItem.Item.stripe_customer_id,
      });
      return existingItem.Item.stripe_customer_id;
    }
  } catch (error) {
    console.error('Error getting existing mapping:', error);
    // テーブルが存在しない、またはアイテムが存在しない場合は続行
  }

  // 3. なければStripeに作成
  const apiKey = await getStripeApiKey(tenantId);
  const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

  console.log('Creating new Stripe Customer:', {
    userId,
    userEmail,
    tenantId,
  });

  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: {
      user_id: userId,
      tenant_id: tenantId,
    },
  });

  console.log('Created new Stripe Customer:', {
    userId,
    stripeCustomerId: customer.id,
  });

  // 4. マッピングを保存
  const now = new Date().toISOString();
  const mappingItem: UserStripeMapping = {
    user_id: userId,
    stripe_customer_id: customer.id,
    email: userEmail,
    created_at: now,
    updated_at: now,
  };

  const putCommand = new PutCommand({
    TableName: tableName,
    Item: mappingItem,
  });

  try {
    await dynamoDB.send(putCommand);
    console.log('Saved Stripe Customer mapping:', {
      userId,
      stripeCustomerId: customer.id,
    });
  } catch (error) {
    console.error('Error saving mapping to DynamoDB:', error);
    // 保存に失敗してもCustomer IDは返す
    // （次回の呼び出しで再度保存を試みる）
  }

  return customer.id;
}

/**
 * 既存のStripe Customer IDを取得（作成はしない）
 *
 * @param event - APIGatewayProxyEvent
 * @param userId - CognitoユーザーID
 * @param tenantId - テナントID
 * @returns Stripe Customer ID（存在しない場合はnull）
 */
export async function getExistingStripeCustomerId(
  event: APIGatewayProxyEvent,
  userId: string,
  tenantId: string
): Promise<string | null> {
  const tableName = generateTableName(tenantId);
  const dynamoDB = await getTenantDynamoDBClient(event);

  console.log('Getting existing Stripe Customer ID:', {
    userId,
    tenantId,
    tableName,
  });

  try {
    const getCommand = new GetCommand({
      TableName: tableName,
      Key: {
        user_id: userId,
      },
    });

    const existingItem = await dynamoDB.send(getCommand);

    if (existingItem.Item) {
      console.log('Found existing Stripe Customer ID:', {
        userId,
        stripeCustomerId: existingItem.Item.stripe_customer_id,
      });
      return existingItem.Item.stripe_customer_id;
    }
  } catch (error) {
    console.error('Error getting existing mapping:', error);
  }

  console.log('No existing Stripe Customer ID found for user:', userId);
  return null;
}