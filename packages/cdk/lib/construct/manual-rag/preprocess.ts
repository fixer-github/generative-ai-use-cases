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
 * Preprocessing Lambda for the Manual RAG feature (B4).
 *
 * Docker Image (Python 3.13, AWS Lambda base image) bundling poppler-utils for the
 * PDF rasterization added in B5. The function is event-driven, not an HTTP server:
 * it is triggered by S3 ObjectCreated events for {manual_id}/original.txt|md and by
 * direct invoke ({ manual_id }) from the reprocess Lambda.
 *
 * B4 scope is TXT / Markdown: split into page texts under {manual_id}/pages/, write
 * page_map.json (printed page = null), and update DynamoDB status. PDF/OCR come in
 * B5/B6; original.pdf is intentionally NOT wired to the trigger here.
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
    // files (exact tail "original.txt" / "original.md"); derived artifacts such as
    // pages/page_0001.md do not match, preventing a self-trigger loop. original.pdf
    // is wired in B5. The handler also guards against non-original keys.
    bucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(preprocessFunction),
      { suffix: 'original.txt' }
    );
    bucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(preprocessFunction),
      { suffix: 'original.md' }
    );

    this.function = preprocessFunction;
  }
}
