import { useEffect, useState } from "react";

import { createCachedThreadPageRequest } from "@/mail/mailbox-model";
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
    const unsubscribe = mailApi.onThreadsChanged((event) => {
      if (event.accountId === accountId) {
        void loadUnreadState();
      }
    });

    void loadUnreadState();

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [accountId]);

  return hasUnreadMail;
};
