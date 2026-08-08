import { useEffect, useState } from "react";

import {
  createCachedThreadPageRequest,
  getThreadListChangeAccountId,
} from "@/mail/mailbox-model";
import { getMailApi } from "@/platform/desktop";

/** Whether the cached inbox for one account contains at least one unread thread. */
export const useHasUnreadMail = (accountId: string): boolean => {
  const [hasUnreadMail, setHasUnreadMail] = useState(false);

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    let requestRevision = 0;
    const loadUnreadState = async (): Promise<void> => {
      const revision = requestRevision + 1;
      requestRevision = revision;
      const reply = await mailApi.listCachedThreadPage(
        createCachedThreadPageRequest([accountId], true)
      );

      if (isActive && requestRevision === revision && reply.ok) {
        setHasUnreadMail(reply.data.threads.length > 0);
      }
    };
    const unsubscribeThreadList = mailApi.onThreadListUpdated(({ changes }) => {
      const includesAccount = changes.some(
        (change) => getThreadListChangeAccountId(change) === accountId
      );

      if (includesAccount) {
        void loadUnreadState();
      }
    });

    void loadUnreadState();

    return () => {
      isActive = false;
      unsubscribeThreadList();
    };
  }, [accountId]);

  return hasUnreadMail;
};
