/**
 * VPC内Lambda関数用のRDS接続ヘルパー
 *
 * VPC内から直接RDSに接続するための設定を提供します。
 * パスワード認証を使用し、環境変数からテナント固有の接続情報を取得します。
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RdsConnectionConfig } from './repositories/baseRepository';
import * as fs from 'fs';
import * as path from 'path';

const secretsManager = new SecretsManagerClient({});

/**
 * VPC内Lambda関数用のRDS接続設定を取得
 *
 * @param tenantId テナントID
 * @returns RDS接続設定（パスワード認証）
 */
export async function getRdsConnectionForVpc(tenantId: string): Promise<RdsConnectionConfig> {
  // 環境変数からSecrets Manager ARNを取得
  const secretArn = process.env.RDS_SECRET_ARN;

  if (!secretArn) {
    throw new Error('Missing RDS_SECRET_ARN in environment variables');
  }

  // Secrets ManagerからRDS認証情報を取得
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
    user: secret.username,
    password: secret.password,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(path.join(__dirname, 'certs/rds-ca-bundle.pem')).toString(),
    },
  };
}