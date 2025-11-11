/**
 * Custom Resource Lambda for applying database migrations
 * This is called during CloudFormation stack creation/update to run database migrations
 */

import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from 'aws-lambda';
import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { runMigrations } from './migrationRunner';
import * as path from 'path';

interface ResourceProperties {
  RdsSecretArn: string;
  MigrationsPath?: string;
}

interface RdsCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

const secretsManager = new SecretsManagerClient({});

/**
 * Send CloudFormation response
 */
async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  status: 'SUCCESS' | 'FAILED',
  reason: string,
  physicalResourceId: string,
  data?: Record<string, any>
): Promise<void> {
  const responseBody: CloudFormationCustomResourceResponse = {
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: data || {},
  };

  console.log('Sending CloudFormation response:', responseBody);

  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': JSON.stringify(responseBody).length.toString(),
    },
    body: JSON.stringify(responseBody),
  });

  if (!response.ok) {
    console.error(
      'Failed to send CloudFormation response:',
      response.statusText
    );
  }
}

/**
 * RDS接続情報をSecrets Managerから取得する
 */
async function getRdsCredentials(secretArn: string): Promise<RdsCredentials> {
  console.log('Fetching RDS credentials from Secrets Manager:', secretArn);

  const command = new GetSecretValueCommand({
    SecretId: secretArn,
  });

  const response = await secretsManager.send(command);

  if (!response.SecretString) {
    throw new Error('Secret string is empty');
  }

  const secret = JSON.parse(response.SecretString);

  return {
    host: secret.host,
    port: secret.port || 5432,
    database: secret.dbname || secret.database,
    username: secret.username,
    password: secret.password,
  };
}

/**
 * マイグレーションを実行する
 */
async function executeMigrations(props: ResourceProperties): Promise<void> {
  // RDS接続情報を取得
  const credentials = await getRdsCredentials(props.RdsSecretArn);

  console.log('RDS connection info:', {
    host: credentials.host,
    port: credentials.port,
    database: credentials.database,
    username: credentials.username,
  });

  // データベース接続プールを作成
  const pool = new Pool({
    host: credentials.host,
    port: credentials.port,
    database: credentials.database,
    user: credentials.username,
    password: credentials.password,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    // 接続テスト
    const client = await pool.connect();
    console.log('Successfully connected to RDS');
    client.release();

    // マイグレーションディレクトリのパスを決定
    // Lambda環境では、マイグレーションファイルはLambda関数と一緒にパッケージ化されている
    const migrationsDir = props.MigrationsPath || path.join(__dirname, '../../database/migrations');

    console.log('Migrations directory:', migrationsDir);

    // マイグレーションを実行
    await runMigrations(pool, migrationsDir);

    console.log('All migrations completed successfully');
  } finally {
    await pool.end();
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<void> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties as unknown as ResourceProperties;
  const physicalResourceId = 'rds-migration-runner';

  try {
    if (event.RequestType === 'Delete') {
      // For deletion, we don't need to do anything
      // The migration state is preserved in the database
      console.log('Delete request received. No action needed.');
      await sendResponse(
        event,
        'SUCCESS',
        'Delete completed successfully',
        physicalResourceId
      );
      return;
    }

    // For both Create and Update, run the migration
    // Migrations are idempotent (already applied migrations are skipped)
    console.log(`${event.RequestType} request received. Running migrations...`);

    await executeMigrations(props);

    await sendResponse(
      event,
      'SUCCESS',
      'Migrations completed successfully',
      physicalResourceId,
      {
        MigrationStatus: 'Completed',
      }
    );
  } catch (error) {
    console.error('Error in migration runner:', error);

    await sendResponse(
      event,
      'FAILED',
      `Error: ${(error as Error).message}`,
      physicalResourceId
    );

    // Re-throw to ensure Lambda execution is marked as failed
    throw error;
  }
};
