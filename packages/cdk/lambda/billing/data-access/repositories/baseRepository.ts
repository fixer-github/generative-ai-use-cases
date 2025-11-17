/**
 * Base Repository class for RDS database access
 * Manages connection pooling and provides common database operations
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * RDS接続設定（パスワード含む）
 */
export interface RdsConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string; // IAM認証トークン
  ssl: {
    rejectUnauthorized: boolean;
  };
}

/**
 * 接続プールの管理
 * Lambda関数のグローバルスコープに配置することで、実行環境の再利用時に接続を再利用
 */
const connectionPools: Map<string, Pool> = new Map();

/**
 * Base Repository class
 */
export abstract class BaseRepository {
  protected pool: Pool;

  constructor(config: RdsConnectionConfig) {
    // 接続プールのキーを生成（テナントごとに異なる）
    const poolKey = `${config.host}:${config.port}/${config.database}`;

    // 既存の接続プールがあれば再利用
    let pool = connectionPools.get(poolKey);

    if (!pool) {
      // 新しい接続プールを作成
      pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
        // Lambda環境に最適化された設定
        max: 10, // 最大接続数
        idleTimeoutMillis: 30000, // アイドル接続のタイムアウト
        connectionTimeoutMillis: 10000, // 接続タイムアウト
      });

      connectionPools.set(poolKey, pool);
    }

    this.pool = pool;
  }

  /**
   * クエリを実行する
   */
  protected async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    try {
      return await this.pool.query<T>(text, params);
    } catch (error) {
      console.error('Database query error:', error);
      console.error('Query:', text);
      console.error('Params:', params);
      throw error;
    }
  }

  /**
   * トランザクション内でクエリを実行する
   */
  protected async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 接続プールを閉じる（テスト用）
   */
  static async closeAllPools(): Promise<void> {
    const pools = Array.from(connectionPools.values());
    await Promise.all(pools.map((pool) => pool.end()));
    connectionPools.clear();
  }
}
