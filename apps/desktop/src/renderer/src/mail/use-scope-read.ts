import { useEffect, useState } from "react";

import { getThreadListChangeAccountId } from "@/mail/mailbox-model";
import { getMailApi } from "@/platform/desktop";
import type { MailApi } from "@/platform/desktop";

import { createCoalescedRead } from "./coalesced-read";

const BURST_READ_GAP_MS = 500;

/**
 * A cache read over some accounts, kept in step with their thread events:
 * a burst, such as the background index sends after each step, costs one
 * more read, spaced from the last. No request is made for an empty scope,
 * which reads as `empty`, as does a scope whose first read has not landed.
 */
export const useScopeRead = <A>(
  accountIds: readonly string[],
  empty: A,
  read: (
    mailApi: MailApi,
    accountIds: readonly string[]
  ) => Promise<A | undefined>
): A => {
  const scopeKey = accountIds.join("\u0000");
  const [status, setStatus] = useState({ scopeKey, value: empty });

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined || scopeKey === "") {
      return;
    }

    // The scope key, not the caller's array, drives the effect, so a caller
    // building a new array on every render does not request again each time.
    const scopeAccountIds = scopeKey.split("\u0000");
    const reader = createCoalescedRead({
      apply: (value: A) => {
        setStatus({ scopeKey, value });
      },
      pause: () => {
        const { promise, resolve } = Promise.withResolvers<undefined>();
        setTimeout(resolve, BURST_READ_GAP_MS);
        return promise;
      },
      read: () => read(mailApi, scopeAccountIds),
    });
    const unsubscribe = mailApi.onThreadListUpdated(({ changes }) => {
      if (
        changes.some((change) =>
          scopeAccountIds.includes(getThreadListChangeAccountId(change))
        )
      ) {
        reader.request();
      }
    });

    reader.request();

    return () => {
      reader.stop();
      unsubscribe();
    };
    // Callers pass a module-level `read`, so only the scope changes.
  }, [read, scopeKey]);

  return status.scopeKey === scopeKey ? status.value : empty;
};
