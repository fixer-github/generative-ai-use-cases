/**
 * Charges batch transcription jobs when Transcribe reports completion via
 * EventBridge ("Transcribe Job State Change"), independently of the browser.
 *
 * Background (review 2026-07-30): the polling-based charge in
 * getTranscription.ts only fires while the user's tab keeps polling. If the
 * tab is closed after upload, the job name existed nowhere but that tab's
 * memory, so the job would never be charged. This handler closes that hole:
 * completion events arrive server-side for every job, so the charge no
 * longer depends on the browser. The polling-based charge stays in place;
 * the per-job charge marker in chargeTranscribeJobOnce() makes the two paths
 * idempotent (whichever runs first wins, the other is a no-op).
 *
 * The EventBridge rule matches every Transcribe job in this account/region,
 * including jobs of other stacks (e.g. dev and stg share an account). Jobs
 * are attributed to this stack by their output bucket, so foreign jobs are
 * skipped without touching this stack's license table.
 */
import { EventBridgeEvent } from 'aws-lambda';
import {
  TranscribeClient,
  GetTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  LICENSE_ENABLED,
  chargeTranscribeJobOnceSafely,
} from './utils/license';

const TRANSCRIPT_BUCKET_NAME = process.env.TRANSCRIPT_BUCKET_NAME ?? '';

type TranscribeJobStateChangeDetail = {
  TranscriptionJobName?: string;
  TranscriptionJobStatus?: string;
};

export const handler = async (
  event: EventBridgeEvent<
    'Transcribe Job State Change',
    TranscribeJobStateChangeDetail
  >
): Promise<void> => {
  const jobName = event.detail?.TranscriptionJobName;
  const status = event.detail?.TranscriptionJobStatus;
  if (!LICENSE_ENABLED || !jobName || status !== 'COMPLETED') {
    return;
  }

  const transcribeClient = new TranscribeClient({});
  const res = await transcribeClient.send(
    new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
  );
  const job = res.TranscriptionJob;

  // Only charge jobs that belong to this stack (output in our bucket)
  const transcriptUri = job?.Transcript?.TranscriptFileUri;
  if (!transcriptUri) {
    return;
  }
  const url = new URL(transcriptUri);
  const pathParts = url.pathname.split('/');
  const bucket = pathParts[1];
  const key = pathParts.slice(2).join('/');
  if (bucket !== TRANSCRIPT_BUCKET_NAME) {
    return;
  }

  const licenseUserId = job?.Tags?.find(
    (tag) => tag.Key === 'licenseUserId'
  )?.Value;
  if (!licenseUserId) {
    // Job started before the licenseUserId tag existed — the polling path
    // remains the only charger for those
    console.warn(`[license] job ${jobName} has no licenseUserId tag; skipped`);
    return;
  }

  // Measured duration = the largest segment end time in the result JSON
  // (same rule as the polling-based charge in getTranscription.ts)
  const s3Client = new S3Client({});
  const s3Result = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const output = JSON.parse(await s3Result.Body!.transformToString());
  const durationSeconds = (
    (output.results.audio_segments ?? []) as { end_time?: string }[]
  ).reduce((max, seg) => {
    const end = parseFloat(seg.end_time ?? '0');
    return Number.isFinite(end) && end > max ? end : max;
  }, 0);

  await chargeTranscribeJobOnceSafely(licenseUserId, jobName, durationSeconds);
  console.log(
    `[license] job ${jobName} charged on completion event (${durationSeconds}s, user ${licenseUserId})`
  );
};
