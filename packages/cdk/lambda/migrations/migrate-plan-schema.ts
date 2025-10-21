/**
 * Plan Schema Migration Lambda
 * プランスキーママイグレーションLambda
 *
 * Custom Resource handler that executes PostgreSQL migrations
 * to create plan/quota schema in the OpenFGA database.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';

const secretsManager = new SecretsManagerClient({});

interface DbCredentials {
  username: string;
  password: string;
}

/**
 * Custom Resource handler
 */
export async function handler(event: any): Promise<any> {
  console.log('Migration event:', JSON.stringify(event, null, 2));

  const requestType = event.RequestType;
  const { DB_ENDPOINT, DB_NAME, DB_SECRET_ARN, SQL_MIGRATION } = process.env;

  // Only run migration on Create and Update
  if (requestType === 'Delete') {
    console.log('Delete event - skipping migration (schema preserved)');
    return {
      PhysicalResourceId: event.PhysicalResourceId || 'plan-schema-migration',
      Data: {
        Status: 'Deleted',
      },
    };
  }

  try {
    // Get database credentials from Secrets Manager
    const secretResponse = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: DB_SECRET_ARN,
      })
    );

    if (!secretResponse.SecretString) {
      throw new Error('Secret value is empty');
    }

    const credentials: DbCredentials = JSON.parse(secretResponse.SecretString);

    // Parse endpoint (format: "host:port")
    const [host, port] = DB_ENDPOINT!.split(':');

    // Create PostgreSQL client
    const client = new Client({
      host,
      port: parseInt(port, 10),
      database: DB_NAME,
      user: credentials.username,
      password: credentials.password,
      ssl: {
        rejectUnauthorized: false, // Required for RDS
      },
      connectionTimeoutMillis: 10000,
    });

    try {
      await client.connect();
      console.log('Connected to database');

      // Execute migration SQL
      console.log('Executing migration SQL...');
      await client.query(SQL_MIGRATION!);
      console.log('Migration completed successfully');

      // Verify schema creation
      const result = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'plans'
        ORDER BY table_name;
      `);

      console.log('Created tables:', result.rows);

      return {
        PhysicalResourceId: 'plan-schema-migration',
        Data: {
          Status: 'Success',
          Tables: result.rows.map((r: any) => r.table_name),
          Timestamp: new Date().toISOString(),
        },
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
