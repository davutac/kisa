import type { MailApi } from "@/platform/desktop";
import type { MailUnreadCounts } from "@/shared/ipc/mail";

import { useScopeRead } from "./use-scope-read";

const NONE: MailUnreadCounts = { inbox: 0, spam: 0 };

const readUnreadCounts = async (
  mailApi: MailApi,
  accountIds: readonly string[]
): Promise<MailUnreadCounts | undefined> => {
  const reply = await mailApi.getUnreadCounts({ accountIds });

  return reply.ok ? reply.data : undefined;
};

/** Unread conversations in the scope's Inbox and in its Spam. */
export const useUnreadCounts = (
  accountIds: readonly string[]
): MailUnreadCounts => useScopeRead(accountIds, NONE, readUnreadCounts);
