import type { ScheduledMailOutcome } from "@/shared/ipc/scheduled-mail";

export interface ScheduledMailOutcomeActions {
  readonly navigate: (to: "/" | "/scheduled") => void;
  readonly notify: (tone: "error" | "success", message: string) => void;
  readonly requestAttentionOpen: (target: {
    readonly accountId: string;
    readonly draftId: string;
  }) => void;
  readonly selectAccount: (accountId: string) => void;
  readonly selectInbox: (accountId: string) => void;
  readonly setSentMailbox: () => void;
}

export const handleScheduledMailOutcome = (
  outcome: ScheduledMailOutcome,
  actions: ScheduledMailOutcomeActions
): void => {
  if (outcome.intent === "feedback") {
    if (outcome.kind === "sent") {
      actions.notify("success", "Scheduled email sent");
    } else {
      actions.notify("error", "Scheduled email needs attention");
    }
    return;
  }

  if (outcome.kind === "sent") {
    actions.selectInbox(outcome.accountId);
    actions.setSentMailbox();
    actions.navigate("/");
    return;
  }

  actions.selectAccount(outcome.accountId);
  actions.requestAttentionOpen({
    accountId: outcome.accountId,
    draftId: outcome.draftId,
  });
  actions.navigate("/scheduled");
};
