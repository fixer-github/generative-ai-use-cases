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

// YYYY-MM-DD (UTC-based, for daily path prefix)
const formatDate = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

// DynamoDB PITR Export Lambda triggered daily by an EventBridge schedule.
// Calls ExportTableToPointInTime for all tables specified as comma-separated ARNs
// in the TABLE_ARNS environment variable, exporting them in DynamoDB JSON format
// to ddb-export/{tableName}/{YYYY-MM-DD}/ in S3 (AWS automatically appends AWSDynamoDB/{ExportId}/).
// Since the API is asynchronous, the Lambda only initiates the call and the export job continues on the AWS side.
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
