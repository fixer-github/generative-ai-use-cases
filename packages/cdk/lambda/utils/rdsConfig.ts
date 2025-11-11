/**
 * RDS接続設定を取得するユーティリティ関数
 */

import { RdsConfig } from '../repositories/types';

/**
 * テナントIDに基づいてRDS接続設定を取得する
 *
 * @param tenantId テナントID
 * @returns RDS接続設定
 */
export async function getRdsConfig(tenantId: string): Promise<RdsConfig> {
  // 環境変数からRDS接続情報を取得
  const host = process.env.RDS_HOST;
  const port = parseInt(process.env.RDS_PORT || '5432', 10);
  const database = process.env.RDS_DATABASE;
  const user = process.env.RDS_USER;
  const password = process.env.RDS_PASSWORD;

  if (!host || !database || !user || !password) {
    throw new Error('RDS connection configuration is missing');
  }

  // TODO: テナントごとに異なるデータベースやスキーマを使用する場合は、ここで分岐処理を追加
  // 現在は全テナントで同じRDS接続を使用

  return {
    host,
    port,
    database,
    user,
    password,
  };
}
