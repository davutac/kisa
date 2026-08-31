import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { getScheduledMailApi } from "@/platform/desktop";
import { handleScheduledMailOutcome } from "@/scheduled/scheduled-mail-outcome";
import { useScheduledMailNavigation } from "@/scheduled/scheduled-navigation";
import { useMailboxStore } from "@/state/mailbox";

const ScheduledMailOutcomeListener = () => {
  const api = useMemo(() => getScheduledMailApi(), []);
  const navigate = useNavigate();
  const requestOpen = useScheduledMailNavigation((state) => state.requestOpen);

  useEffect(() => {
    if (api === undefined) {
      return;
    }
    return api.onOutcome((outcome) => {
      handleScheduledMailOutcome(outcome, {
        navigate: (to) => {
          void navigate({ to });
        },
        notify: (tone, message) => {
          toast[tone](message);
        },
        requestAttentionOpen: requestOpen,
        selectAccount: (accountId) => {
          useMailboxStore.getState().selectAccount(accountId);
        },
        selectInbox: (accountId) => {
          useMailboxStore.getState().selectInbox(accountId);
        },
        setSentMailbox: () => {
          useMailboxStore.getState().setMailbox("sent");
        },
      });
    });
  }, [api, navigate, requestOpen]);

  return null;
};

export default ScheduledMailOutcomeListener;
