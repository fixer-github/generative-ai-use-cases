import {
  DynamoDBClient,
  ExportTableToPointInTimeCommand,
  ExportFormat,
  ExportType,
} from '@aws-sdk/client-dynamodb';
import { ScheduledEvent } from 'aws-lambda';

const TABLE_ARNS = (process.env.TABLE_ARNS ?? '')
  .split(',')
  .map((arn) => arn.trim())
  .filter((arn) => arn.length > 0);
const EXPORT_BUCKET_NAME = process.env.EXPORT_BUCKET_NAME!;

const ddbClient = new DynamoDBClient({});

// "arn:aws:dynamodb:ap-northeast-1:123456789012:table/MyTable" → "MyTable"
const extractTableName = (tableArn: string): string => {
  const slashIndex = tableArn.lastIndexOf('/');
  return slashIndex >= 0 ? tableArn.slice(slashIndex + 1) : tableArn;
};

// YYYY-MM-DD（UTC ベース、日次パス用）
const formatDate = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

// EventBridge スケジュールから日次起動される DynamoDB PITR Export Lambda。
// 環境変数 TABLE_ARNS にカンマ区切りで指定された全テーブルについて
// ExportTableToPointInTime を呼び出し、S3 の ddb-export/{tableName}/{YYYY-MM-DD}/
// 配下に DynamoDB JSON 形式で出力する（AWS が AWSDynamoDB/{ExportId}/ を自動付与）。
// API は非同期のため、Lambda は呼び出しのみで終了し、エクスポートジョブは AWS 側で継続する。
export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log('DDB PITR export started:', JSON.stringify(event));

  if (TABLE_ARNS.length === 0) {
    console.warn('TABLE_ARNS is empty; nothing to export.');
    return;
  }

  const exportedAt = new Date();
  const datePrefix = formatDate(exportedAt);

  const results = await Promise.allSettled(
    TABLE_ARNS.map(async (tableArn) => {
      const tableName = extractTableName(tableArn);
      const s3Prefix = `ddb-export/${tableName}/${datePrefix}/`;

      const response = await ddbClient.send(
        new ExportTableToPointInTimeCommand({
          TableArn: tableArn,
          S3Bucket: EXPORT_BUCKET_NAME,
          S3Prefix: s3Prefix,
          ExportFormat: ExportFormat.DYNAMODB_JSON,
          ExportType: ExportType.FULL_EXPORT,
        })
      );

      console.log(
        `Export started: table=${tableName} exportArn=${response.ExportDescription?.ExportArn} prefix=${s3Prefix}`
      );

      return {
        tableArn,
        tableName,
        exportArn: response.ExportDescription?.ExportArn,
      };
    })
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        console.error('Export failed:', failure.reason);
      }
    }
    throw new Error(
      `DDB PITR export failed for ${failures.length}/${TABLE_ARNS.length} tables`
    );
  }

  console.log(
    `DDB PITR export completed: ${TABLE_ARNS.length} table(s) submitted.`
  );
};
