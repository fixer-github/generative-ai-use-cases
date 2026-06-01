import { Duration, Size } from 'aws-cdk-lib';
import {
  DockerImageFunction,
  DockerImageCode,
  Architecture,
  IFunction,
} from 'aws-cdk-lib/aws-lambda';
import { EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import { ManualStorage } from './storage';

export interface ManualPreprocessProps {
  readonly storage: ManualStorage;
}

/**
 * Preprocessing Lambda for the Manual RAG feature (B4/B5).
 *
 * Docker Image (Python 3.13, AWS Lambda base image) bundling poppler-utils
 * (pdftoppm) for PDF rasterization. The function is event-driven, not an HTTP
 * server: it is triggered by S3 ObjectCreated events for
 * {manual_id}/original.txt|md|pdf and by direct invoke ({ manual_id }) from the
 * reprocess Lambda.
 *
 * TXT / Markdown (B4): split into page texts under {manual_id}/pages/, write
 * page_map.json (printed page = null). PDF (B5): rasterize pages to PNG, extract
 * per-page text, read printed numbers from footers into page_map.json, and emit
 * toc.* from bookmarks. OCR for image-only pages (Amazon Textract) comes in B6.
 */
export class ManualPreprocess extends Construct {
  public readonly function: IFunction;

  constructor(scope: Construct, id: string, props: ManualPreprocessProps) {
    super(scope, id);

    const { bucket, table } = props.storage;

    const preprocessFunction = new DockerImageFunction(this, 'Function', {
      code: DockerImageCode.fromImageAsset('./lambda-python/manual-preprocess'),
      memorySize: 2048,
      ephemeralStorageSize: Size.mebibytes(2048),
      timeout: Duration.minutes(15),
      architecture: Architecture.X86_64,
      environment: {
        BUCKET_NAME: bucket.bucketName,
        TABLE_NAME: table.tableName,
      },
    });

    // Reads originals, writes page texts / page_map.json, updates manual status.
    bucket.grantReadWrite(preprocessFunction);
    table.grantReadWriteData(preprocessFunction);

    // S3 trigger for normal uploads. The suffix filter matches only the original
    // files (exact tail "original.txt" / "original.md" / "original.pdf"); derived
    // artifacts such as pages/page_0001.md|png do not match, preventing a
    // self-trigger loop. The handler also guards against non-original keys.
    for (const suffix of ['original.txt', 'original.md', 'original.pdf']) {
      bucket.addEventNotification(
        EventType.OBJECT_CREATED,
        new LambdaDestination(preprocessFunction),
        { suffix }
      );
    }

    this.function = preprocessFunction;
  }
}
