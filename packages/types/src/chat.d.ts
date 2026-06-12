import { PrimaryKey } from './base';

export type Chat = PrimaryKey & {
  chatId: string;
  usecase: string;
  title: string;
  updatedDate: string;
  // Meeting projection rows (usecase === 'minutes') carry a link to the
  // dedicated Meeting entity and a mirrored status so the sidebar can route to
  // the workbench. Optional: normal chats never set these.
  meetingId?: string;
  status?: string;
  // Scheduled-execution projection rows (usecase === 'sched', step 6) carry the
  // task + execution ids so the sidebar can deep-link to the execution detail.
  // `status` above mirrors the run outcome ('success' | 'error').
  taskId?: string;
  executionId?: string;
};
