import { Duration, Size } from 'aws-cdk-lib';
import {
  DockerImageFunction,
  DockerImageCode,
  Architecture,
  IFunction,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
// Same class name as the s3-notifications LambdaDestination above; alias to avoid
// the collision (this one is the async-invoke onFailure destination).
import { LambdaDestination as LambdaFailureDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { ManualStorage } from './storage';

export interface ManualPreprocessProps {
  readonly storage: ManualStorage;
}

/**
 * Preprocessing Lambda for the Manual RAG feature (B4/B5/B6).
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
 * toc.* from bookmarks. OCR (B6): PDF pages with little/no extractable text are
 * read from their PNG via Amazon Textract DetectDocumentText.
 */
export class ManualPreprocess extends Construct {
  public readonly function: IFunction;

  constructor(scope: Construct, id: string, props: ManualPreprocessProps) {
    super(scope, id);

    const { bucket, table } = props.storage;

    // onFailure destination for the preprocessing Lambda. The handler records
    // status=failed for ordinary exceptions itself, but a hard failure (timeout /
    // out-of-memory) kills the process first and would leave the manual stuck at
    // status=processing. This Lambda runs after async retries are exhausted and
    // flips such stuck items to failed.
    const markFailedFunction = new NodejsFunction(this, 'MarkFailed', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/manual/markFailed.ts',
      timeout: Duration.minutes(1),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });
    table.grantWriteData(markFailedFunction);

    const preprocessFunction = new DockerImageFunction(this, 'Function', {
      // Force an amd64 image regardless of the build host (e.g. Apple Silicon),
      // so it matches the X86_64 Lambda architecture below. Same pattern as
      // closed-web.ts. Without this, fromImageAsset builds for the host arch and
      // an arm64 Mac would produce an image that mismatches the function.
      code: DockerImageCode.fromImageAsset('./lambda-python/manual-preprocess', {
        platform: Platform.LINUX_AMD64,
      }),
      memorySize: 2048,
      ephemeralStorageSize: Size.mebibytes(2048),
      timeout: Duration.minutes(15),
      architecture: Architecture.X86_64,
      environment: {
        BUCKET_NAME: bucket.bucketName,
        TABLE_NAME: table.tableName,
      },
      onFailure: new LambdaFailureDestination(markFailedFunction),
    });

    // Reads originals, writes page texts / page_map.json, updates manual status.
    bucket.grantReadWrite(preprocessFunction);
    table.grantReadWriteData(preprocessFunction);

    // OCR for image-only / low-text PDF pages (B6). Only DetectDocumentText is
    // granted (AnalyzeDocument is not used). Textract reads the page PNG via an
    // S3Object reference, which is already covered by the bucket read grant.
    preprocessFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['textract:DetectDocumentText'],
        resources: ['*'],
      })
    );

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
