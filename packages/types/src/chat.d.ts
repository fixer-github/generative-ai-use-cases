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
};
