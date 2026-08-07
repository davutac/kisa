import type { ReactNode } from "react";
import { createContext, use, useEffect, useState } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";
import type {
  GmailTrustedImageSender,
  GmailTrustedImageSendersReply,
} from "@/shared/ipc/mail";

const TrustedImageSendersContext = createContext<
  readonly GmailTrustedImageSender[]
>([]);

const matches = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

export const TrustedImageSendersProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [senders, setSenders] = useState<readonly GmailTrustedImageSender[]>(
    []
  );

  useEffect(() => {
    const api = getMailApi();

    if (api === undefined) {
      return;
    }

    let isMounted = true;
    const apply = (reply: GmailTrustedImageSendersReply): void => {
      if (!(isMounted && reply.ok)) {
        return;
      }

      setSenders(reply.data);
    };
    const unsubscribe = api.onTrustedImageSendersChanged(apply);

    void (async () => {
      try {
        apply(await api.listTrustedImageSenders());
      } catch {
        toast.error("Could not load the senders you trust with images");
      }
    })();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <TrustedImageSendersContext value={senders}>
      {children}
    </TrustedImageSendersContext>
  );
};

export const useIsTrustedImageSender = (
  accountId: string,
  senderEmail: string
): boolean =>
  use(TrustedImageSendersContext).some(
    (sender) =>
      matches(sender.accountId, accountId) &&
      matches(sender.senderEmail, senderEmail)
  );

// The main process answers with the new list on its own channel, so the caller
// only has to report a failure.
export const trustImageSender = async (
  accountId: string,
  senderEmail: string
): Promise<void> => {
  const api = getMailApi();

  if (api === undefined) {
    return;
  }

  try {
    const reply = await api.trustImageSender({ accountId, senderEmail });

    if (!reply.ok) {
      toast.error(reply.error);
    }
  } catch {
    toast.error("Could not remember this sender");
  }
};
