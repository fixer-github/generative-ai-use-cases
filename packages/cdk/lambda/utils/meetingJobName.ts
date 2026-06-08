/**
 * Encode/decode the meeting linkage inside a Transcribe job name (B3).
 *
 * Transcribe job names allow only [0-9a-zA-Z._-] ('#' and '@' are not allowed).
 * The meeting userId is `cognito:username` (which may be an email or a UUID), so
 * embedding it raw would break the charset. We base64url-encode the userId
 * ([A-Za-z0-9-_], no padding => all allowed chars) and use '.' as the field
 * delimiter since it appears neither in base64url nor in a UUID.
 *
 * Format: gx.<base64url(userId)>.<meetingId>.<jobUuid>
 * Legacy transcribe jobs (not tied to a meeting) use a bare UUID, so the
 * completion detector can ignore them via the `gx.` prefix. startTranscription
 * (encode) and the completion Lambda (decode) must use the SAME convention, so
 * it lives here in one place. See Phase 2 cluster memo section 6 + codemap fix 4.
 */

const PREFIX = 'gx';

export const encodeMeetingJobName = (
  userId: string,
  meetingId: string,
  jobUuid: string
): string => {
  const u = Buffer.from(userId, 'utf-8').toString('base64url');
  return `${PREFIX}.${u}.${meetingId}.${jobUuid}`;
};

export type DecodedMeetingJob = { userId: string; meetingId: string };

// Returns null when the job name is not one of our meeting-linked jobs (legacy
// transcribe job, or any unrelated Transcribe job in the account).
export const decodeMeetingJobName = (
  jobName: string | undefined
): DecodedMeetingJob | null => {
  if (!jobName || !jobName.startsWith(`${PREFIX}.`)) return null;
  const parts = jobName.split('.');
  // ['gx', base64url(userId), meetingId, jobUuid] — none of the trailing
  // segments contain '.', so exactly 4 parts when well-formed.
  if (parts.length < 4) return null;
  try {
    const userId = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const meetingId = parts[2];
    if (!userId || !meetingId) return null;
    return { userId, meetingId };
  } catch {
    return null;
  }
};
