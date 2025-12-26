/**
 * Migration Runner
 * Reads SQL migration files and applies them to the database in order
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * マイグレーション情報
 */
interface Migration {
  version: string;
  filename: string;
  sql: string;
}

/**
 * データベースに適用済みのマイグレーションバージョンを取得する
 */
async function getAppliedMigrations(pool: Pool): Promise<string[]> {
  try {
    const result = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    return result.rows.map((row) => row.version);
  } catch (error: any) {
    // schema_migrationsテーブルが存在しない場合は空配列を返す
    if (error.code === '42P01') {
      // undefined_table
      console.log(
        'schema_migrations table does not exist yet, will be created by first migration'
      );
      return [];
    }
    throw error;
  }
}

/**
 * マイグレーションファイルを読み込む
 */
function loadMigrationFiles(migrationsDir: string): Migration[] {
  console.log(`Loading migration files from: ${migrationsDir}`);

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files:`, files);

  return files.map((filename) => {
    const filePath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filePath, 'utf-8');

    // ファイル名から番号を抽出（例: 001_create_plans_table.sql -> 001）
    const version = filename.split('_')[0];

    return {
      version,
      filename,
      sql,
    };
  });
}

/**
 * マイグレーションを実行する
 */
async function applyMigration(
  pool: Pool,
  migration: Migration
): Promise<void> {
  console.log(`Applying migration ${migration.version}: ${migration.filename}`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // SQLを実行
    await client.query(migration.sql);

    // schema_migrationsテーブルに記録
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [migration.version]
    );

    await client.query('COMMIT');

    console.log(
      `Successfully applied migration ${migration.version}: ${migration.filename}`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(
      `Failed to apply migration ${migration.version}: ${migration.filename}`,
      error
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * マイグレーションを実行する
 */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string
): Promise<void> {
  console.log('Starting database migration');
  console.log('Migrations directory:', migrationsDir);

  // マイグレーションファイルを読み込む
  const migrations = loadMigrationFiles(migrationsDir);

  if (migrations.length === 0) {
    console.log('No migration files found');
    return;
  }

  // 適用済みのマイグレーションを取得
  const appliedMigrations = await getAppliedMigrations(pool);
  console.log('Applied migrations:', appliedMigrations);

  // 未適用のマイグレーションを抽出
  const pendingMigrations = migrations.filter(
    (migration) => !appliedMigrations.includes(migration.version)
  );

  if (pendingMigrations.length === 0) {
    console.log('All migrations are already applied');
    return;
  }

  console.log(
    `Found ${pendingMigrations.length} pending migrations:`,
    pendingMigrations.map((m) => m.filename)
  );

  // 未適用のマイグレーションを順番に実行
  for (const migration of pendingMigrations) {
    await applyMigration(pool, migration);
  }

  console.log(
    `Successfully applied ${pendingMigrations.length} migrations`
  );
}
