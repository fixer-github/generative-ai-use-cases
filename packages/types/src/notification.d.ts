import { PrimaryKey } from './base';

// Persisted notification entity (P4 / B6). This is the durable, per-user
// notification that backs the sidebar bell + unread badge. It is distinct from
// `AppNotification` (agent-core.d.ts), which is a volatile in-memory toast.
//
// Producers (backend only): the meeting-completion detector (B3) writes
// minutes_ready / minutes_failed; the scheduler execution Lambda writes
// sched_failed / sched_paused. Users never create notifications via the API.
//
// The dedicated NotificationTable is the source of truth; notifications are NOT
// projected into the Chat table (they belong in the bell, not sidebar history).
// See the Phase 2 common-infrastructure-cluster memo, section 4.

export type NotificationType =
  | 'minutes_ready' // a meeting's transcription finished (status -> ready)
  | 'minutes_failed' // a meeting's transcription failed (status -> failed)
  | 'sched_paused' // a scheduled task was auto-stopped (3 consecutive failures)
  | 'sched_failed'; // a scheduled task run failed (permanent error)

export type StoredNotification = PrimaryKey & {
  // id = `notification#${userId}` (PK), createdDate = `${epochMs}` (SK).
  // createdDate doubles as the sort key (newest first), mirroring the meeting
  // projection convention; the client parses it as Number() for display.
  notificationId: string; // `notification#${uuid}`
  type: NotificationType;
  title: string;
  body?: string;
  link: string; // in-app route to open when the notification is clicked
  read: boolean;
  ttl?: number; // epoch SECONDS; DynamoDB TTL auto-expiry (default +90 days)
};
