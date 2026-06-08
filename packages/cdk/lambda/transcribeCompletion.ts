/* eslint-disable i18nhelper/no-jp-string */
/**
 * B3: Transcribe batch completion detector (EventBridge -> this Lambda).
 *
 * Handles "Transcribe Job State Change" events (COMPLETED / FAILED): it decodes
 * the meeting linkage embedded in the job name, transitions the meeting status,
 * and writes a completion notification to the NotificationTable. Per the user
 * decision it only advances the status -- it does NOT pull the transcript body
 * (the client fetches it via the existing getTranscription path), keeping this
 * Lambda thin.
 *
 * This closes the "leaving mid-batch leaves the row stuck in transcribing" hole:
 * the detector advances status to ready/failed regardless of the client. See the
 * Phase 2 common-infrastructure-cluster memo, section 6.
 *
 * The user-facing JP notification copy below is the same pattern as the
 * scheduler's notification-utils.ts (no-jp-string disabled for this file).
 */
import { EventBridgeEvent } from 'aws-lambda';
import { decodeMeetingJobName } from './utils/meetingJobName';
import {
  findMeetingById,
  updateMeeting,
  createNotification,
} from './repository';

type TranscribeJobStateChangeDetail = {
  TranscriptionJobName: string;
  TranscriptionJobStatus: string; // COMPLETED | FAILED | IN_PROGRESS | QUEUED
};

export const handler = async (
  event: EventBridgeEvent<
    'Transcribe Job State Change',
    TranscribeJobStateChangeDetail
  >
): Promise<void> => {
  const jobName = event.detail?.TranscriptionJobName;
  const jobStatus = event.detail?.TranscriptionJobStatus;

  const decoded = decodeMeetingJobName(jobName);
  if (!decoded) {
    // Not a meeting-linked job (legacy transcribe feature, or any unrelated
    // Transcribe job in the account). Ignore.
    return;
  }
  if (jobStatus !== 'COMPLETED' && jobStatus !== 'FAILED') {
    // Only terminal states drive a status transition.
    return;
  }

  const { userId, meetingId } = decoded;
  const newStatus = jobStatus === 'COMPLETED' ? 'ready' : 'failed';

  try {
    const meeting = await findMeetingById(userId, meetingId);
    if (!meeting) {
      // The meeting may have been deleted before the job finished. No-op.
      console.log(`B3: meeting not found for job ${jobName}; skipping`);
      return;
    }
    if (meeting.status === newStatus) {
      // Already processed — EventBridge can deliver duplicates. Idempotent no-op
      // (also avoids a duplicate notification).
      return;
    }

    // updateMeeting also mirrors status onto the projection row, so the sidebar
    // reflects the new state without any extra wiring.
    await updateMeeting(userId, meetingId, { status: newStatus });

    await createNotification(userId, {
      type: newStatus === 'ready' ? 'minutes_ready' : 'minutes_failed',
      title:
        newStatus === 'ready'
          ? '議事録の文字起こしが完了しました'
          : '議事録の文字起こしに失敗しました',
      body: meeting.title || undefined,
      link: `/g/minutes/${meetingId}`,
    });
  } catch (error) {
    // Swallow: re-throwing would make EventBridge retry. Status + notification are
    // best-effort here; the client polling path (getTranscription) still resolves
    // the transcript when the user is present.
    console.log('B3 completion handler error:', error);
  }
};
