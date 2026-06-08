import { PrimaryKey } from './base';

// Meeting (minutes) workbench entity.
// The dedicated MeetingTable is the source of truth; the main Chat table only
// holds a lightweight projection row (usecase === 'minutes') so the sidebar
// history can list meetings without schema changes. See the Phase 2
// meeting-workbench design memo, section 1.

// recording: mic session in progress / transcribing: batch job running
// ready: transcript available / failed: transcription failed
export type MeetingStatus = 'recording' | 'transcribing' | 'ready' | 'failed';

// mic: realtime streaming transcription / batch: uploaded audio file
export type MeetingSource = 'mic' | 'batch';

export type MeetingSpeaker = {
  id: string;
  name: string;
};

export type Meeting = PrimaryKey & {
  // id = `meeting#${userId}` (PK), createdDate = `${epochMs}` (SK)
  meetingId: string; // `meeting#${uuid}`
  title: string;
  status: MeetingStatus;
  source: MeetingSource;
  jobName?: string; // batch Transcribe job reference
  transcriptKey?: string; // S3 key: transcript body (rev included)
  minutesKey?: string; // S3 key: structured minutes (after manual generation)
  audioKey?: string; // S3 key: audio source (required for mic sessions)
  speakers: MeetingSpeaker[]; // speaker roster (naming / merge result)
  rev: number; // transcript revision
  genRev?: number; // transcript rev at minutes-generation time (re-gen banner)
  updatedDate: string;
};

// ---------------------------------------------------------------------------
// Workbench content bodies (stored in S3, not DynamoDB).
// DynamoDB holds meta + pointers (transcriptKey / minutesKey); the heavy
// transcript and structured minutes live as JSON objects in S3. See the
// Phase 2 meeting-workbench design memo 1.2(2) and 13.
// ---------------------------------------------------------------------------

// One utterance in the editable transcript. `spk` is the numeric speaker index
// (spk_N); avatar/color are derived from the index on the client.
export type MeetingTurn = {
  id: string;
  spk: number;
  at: number; // start time in seconds
  t: string; // formatted hh:mm:ss
  html: string; // turn text (may contain <mark> for low-confidence words)
  lowConf?: boolean; // speaker assignment is uncertain (needs review)
  est?: boolean; // time is estimated (after a split)
  manual?: boolean; // manually added turn
};

// The transcript body persisted to S3 (the source of truth for the workbench).
export type MeetingTranscript = {
  source: MeetingSource;
  durationSec?: number;
  names: Record<string, string>; // spkId (string) -> assigned name
  speakers: number[]; // speaker ids present (avatar order)
  turns: MeetingTurn[];
  rev: number; // mirrors Meeting.rev at write time
};

// owner = speaker id as string (e.g. "2") or null when unattributed.
// src = the originating turn id (evidence link target).
export type MeetingDecision = {
  id: string;
  text: string;
  owner: string | null;
  src: string;
  time?: string;
};

export type MeetingTodo = {
  id: string;
  text: string;
  owner: string | null;
  due?: string;
  src: string;
};

// The structured minutes body persisted to S3 (after manual generation).
export type MeetingMinutesDoc = {
  summary: string[];
  decisions: MeetingDecision[];
  todos: MeetingTodo[];
  genRev?: number; // transcript rev this was generated from
};
