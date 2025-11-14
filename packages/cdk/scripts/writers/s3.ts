import {
  S3Client,
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { parseS3Url } from '../transformers/knowledge';

export type S3MigrationOptions = {
  region: string;
  sourceBucket?: string;
  targetBucket?: string;
  dryRun?: boolean;
  preserveMetadata?: boolean;
};

export type S3MigrationProgress = {
  totalFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  errors: string[];
};

export type S3FileMigration = {
  sourceKey: string;
  targetKey: string;
  sourceBucket: string;
  targetBucket: string;
};

export class S3Writer {
  private client: S3Client;
  private progress: S3MigrationProgress;

  constructor(private options: S3MigrationOptions) {
    this.client = new S3Client({ region: options.region });
    this.progress = {
      totalFiles: 0,
      copiedFiles: 0,
      skippedFiles: 0,
      errors: [],
    };
  }

  /**
   * Check if object exists in target bucket
   */
  private async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Copy a single file from source to target
   */
  async copyFile(migration: S3FileMigration): Promise<boolean> {
    try {
      // Check if already exists in target
      const exists = await this.objectExists(
        migration.targetBucket,
        migration.targetKey
      );
      if (exists) {
        console.log(
          `File ${migration.targetKey} already exists in ${migration.targetBucket}, skipping`
        );
        this.progress.skippedFiles++;
        return false;
      }

      if (this.options.dryRun) {
        console.log(
          `[DRY RUN] Would copy: s3://${migration.sourceBucket}/${migration.sourceKey} -> s3://${migration.targetBucket}/${migration.targetKey}`
        );
        return true;
      }

      // Copy object
      const command = new CopyObjectCommand({
        CopySource: `${migration.sourceBucket}/${migration.sourceKey}`,
        Bucket: migration.targetBucket,
        Key: migration.targetKey,
        MetadataDirective: this.options.preserveMetadata
          ? 'COPY'
          : 'REPLACE',
      });

      await this.client.send(command);
      this.progress.copiedFiles++;
      return true;
    } catch (error) {
      const errorMsg = `Failed to copy ${migration.sourceKey}: ${error instanceof Error ? error.message : String(error)}`;
      this.progress.errors.push(errorMsg);
      console.error(errorMsg);
      return false;
    }
  }

  /**
   * Migrate multiple files
   */
  async migrateFiles(migrations: S3FileMigration[]): Promise<void> {
    this.progress.totalFiles = migrations.length;
    console.log(`Migrating ${migrations.length} files...`);

    for (const migration of migrations) {
      await this.copyFile(migration);

      // Progress reporting
      const processed =
        this.progress.copiedFiles + this.progress.skippedFiles;
      if (processed % 10 === 0) {
        console.log(
          `Progress: ${processed}/${this.progress.totalFiles} files processed (${this.progress.copiedFiles} copied, ${this.progress.skippedFiles} skipped)`
        );
      }
    }

    console.log(
      `Completed: ${this.progress.copiedFiles} copied, ${this.progress.skippedFiles} skipped, ${this.progress.errors.length} errors`
    );
  }

  /**
   * List all objects in a bucket with a prefix
   */
  async listObjects(bucket: string, prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  /**
   * Generate migration plan for knowledge base files
   * Maps old S3 URLs to new storage locations
   */
  async planKnowledgeFileMigration(
    s3Urls: string[],
    targetBucket: string,
    targetPrefix: string = 'knowledge-base/'
  ): Promise<S3FileMigration[]> {
    const migrations: S3FileMigration[] = [];

    for (const s3Url of s3Urls) {
      const parsed = parseS3Url(s3Url);
      if (!parsed) {
        console.warn(`Failed to parse S3 URL: ${s3Url}`);
        continue;
      }

      // Generate target key: preserve filename but use new prefix
      const filename = parsed.key.split('/').pop() || parsed.key;
      const targetKey = `${targetPrefix}${filename}`;

      migrations.push({
        sourceKey: parsed.key,
        targetKey,
        sourceBucket: parsed.bucket,
        targetBucket,
      });
    }

    return migrations;
  }

  /**
   * Get current progress
   */
  getProgress(): S3MigrationProgress {
    return { ...this.progress };
  }

  /**
   * Print progress summary
   */
  printProgress(): void {
    console.log('\n=== S3 Migration Progress ===\n');
    console.log(`Total Files: ${this.progress.totalFiles}`);
    console.log(`Copied: ${this.progress.copiedFiles}`);
    console.log(`Skipped: ${this.progress.skippedFiles}`);
    console.log(`Errors: ${this.progress.errors.length}`);

    if (this.progress.errors.length > 0) {
      console.log('\nRecent Errors:');
      this.progress.errors.slice(-10).forEach((error) => {
        console.log(`  - ${error}`);
      });
    }

    console.log('\n============================\n');
  }
}
