import { useEffect, useState } from "react";

import { getThreadListChangeAccountId } from "@/mail/mailbox-model";
import { getMailApi } from "@/platform/desktop";
import type { MailUnreadLabels } from "@/shared/ipc/mail";

import { createCoalescedRead } from "./coalesced-read";
import { normalizeMailboxLabelName } from "./mailbox-labels";

const EMPTY: ReadonlySet<string> = new Set();
const BURST_READ_GAP_MS = 500;

/** One account's label, folded as the label catalog folds names. */
export const toUnreadLabelKey = (accountId: string, label: string): string =>
  `${accountId}\u0000${normalizeMailboxLabelName(label)}`;

export const toUnreadLabelKeys = ({
  labels,
}: MailUnreadLabels): ReadonlySet<string> =>
  new Set(
    labels.map(({ accountId, label }) => toUnreadLabelKey(accountId, label))
  );

/** Whether any of an account's labels has unread conversations on its place. */
export const hasUnreadLabel = (
  unreadLabels: ReadonlySet<string>,
  accountId: string,
  labels: readonly { readonly name: string }[]
): boolean =>
  labels.some(({ name }) =>
    unreadLabels.has(toUnreadLabelKey(accountId, name))
  );

/**
 * The labels with unread conversations on their label place, for the given
 * accounts, as `toUnreadLabelKey` keys. Refreshed by the thread event stream
 * of those accounts; no request is made for an empty scope.
 */
export const useUnreadLabels = (
  accountIds: readonly string[]
): ReadonlySet<string> => {
  const scopeKey = accountIds.join("\u0000");
  const [status, setStatus] = useState({ keys: EMPTY, scopeKey });

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined || scopeKey === "") {
      return;
    }

    // The scope key, not the caller's array, drives the effect, so a caller
    // building a new array on every render does not request again each time.
    const scopeAccountIds = scopeKey.split("\u0000");
    // The read walks every unread conversation's labels, and the background
    // index sends thread events after each step: a burst costs one more
    // read, spaced from the last.
    const reader = createCoalescedRead({
      apply: (unread: MailUnreadLabels) => {
        setStatus({ keys: toUnreadLabelKeys(unread), scopeKey });
      },
      pause: () => {
        const { promise, resolve } = Promise.withResolvers<undefined>();
        setTimeout(resolve, BURST_READ_GAP_MS);
        return promise;
      },
      read: async () => {
        const reply = await mailApi.getUnreadLabels({
          accountIds: scopeAccountIds,
        });
        return reply.ok ? reply.data : undefined;
      },
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
  }, [scopeKey]);

  return status.scopeKey === scopeKey ? status.keys : EMPTY;
};
