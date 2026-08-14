import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MailReplyArea from "../src/renderer/src/components/mail/reply-area";
import type {
  Tooltip as TooltipComponent,
  TooltipContent as TooltipContentComponent,
  TooltipTrigger as TooltipTriggerComponent,
} from "../src/renderer/src/components/ui/tooltip";
import { createThreadMailDraft } from "../src/renderer/src/mail/mail-draft";
import type {
  GmailThreadMessage,
  MailDraftInput,
} from "../src/shared/ipc/mail";

type TooltipProps = Parameters<typeof TooltipComponent>[0];
type TooltipContentProps = Parameters<typeof TooltipContentComponent>[0];
type TooltipTriggerProps = Parameters<typeof TooltipTriggerComponent>[0];

vi.mock(import("@/components/mail/email-composer"), () => ({
  default: ({
    toolbarActions,
    toolbarHeader,
  }: {
    toolbarActions?: ReactNode;
    toolbarHeader?: ReactNode;
  }) => (
    <div aria-label="Composer">
      {toolbarHeader}
      <div aria-label="Composer toolbar">{toolbarActions}</div>
    </div>
  ),
}));

vi.mock(import("@/components/mail/email-recipient-fields"), () => ({
  default: () => <span />,
}));

vi.mock(import("@/components/mail/forwarded-message"), () => ({
  default: () => <span />,
}));

vi.mock(import("@/components/mail/message-attachments"), () => ({
  default: () => null,
}));

vi.mock(import("@/components/mail/relative-time"), () => ({
  default: () => <span />,
}));

vi.mock(import("@/components/ui/tooltip"), () => ({
  Tooltip: ({ children }: TooltipProps) => <div>{children as ReactNode}</div>,
  TooltipContent: ({ children }: TooltipContentProps) => <div>{children}</div>,
  TooltipTrigger: ({ render }: TooltipTriggerProps) => (
    <span>{render as ReactNode}</span>
  ),
}));

vi.mock(import("@/hotkeys"), () => ({
  HotkeyHint: ({ command }: { command: string }) => <span>{command}</span>,
  getHotkeyAriaLabel: vi.fn<(command: string) => string>((command) => command),
  getHotkeyDisplay: vi.fn<
    (command: string) => { bindings: string[]; label: string }
  >((command) => ({
    bindings: [],
    label:
      command === "threadComposer.createReply"
        ? "Create reply"
        : "Clean up reply",
  })),
  useAppCommand: vi.fn<() => void>(),
  useHotkeyLayer: vi.fn<() => void>(),
}));

vi.mock(import("@/components/mail/reply-area/use-reply-workspace"), () => ({
  useReplyWorkspace: ({
    action,
    draft,
  }: {
    action: string;
    draft: MailDraftInput;
  }) => {
    const isForward = action === "forward";
    return {
      aiModelLabel: "Codex · gpt-5.6-luna",
      canClean: isForward,
      canCreateReply: !isForward,
      canSend: true,
      clean: () => Promise.resolve(),
      cleanHistory: isForward
        ? [
            {
              body: "<p>Draft</p>",
              id: "original",
              label: "Original",
              status: "ready",
              subject: "Project update",
            },
            {
              body: "<p>Draft</p>",
              id: "clean-1",
              label: "#1 Clean",
              status: "loading",
              subject: "Project update",
            },
          ]
        : [],
      composer: {
        html: isForward ? "<p>Draft</p>" : "",
        isEmpty: !isForward,
        text: isForward ? "Draft" : "",
      },
      createReply: () => Promise.resolve(),
      currentDraft: draft,
      discard: () => Promise.resolve(),
      dismissCleanVersion: () => null,
      isBusy: false,
      isCreatingReply: false,
      isInputDisabled: false,
      isSending: false,
      recipients: { bcc: [], cc: [], to: [] },
      selectCleanVersion: () => null,
      selectedCleanVersionId: isForward ? "original" : null,
      send: () => Promise.resolve(),
      setComposer: () => null,
      setRecipients: () => null,
    };
  },
}));

const message: GmailThreadMessage = {
  attachments: [],
  body: {},
  from: "Sender <sender@example.com>",
  id: "message-1",
  labelIds: [],
  sentAt: 0,
  snippet: "Hello",
  subject: "Project update",
};

const renderReplyArea = (action: "forward" | "reply"): string => {
  const draft = createThreadMailDraft({
    accountId: "person@example.com",
    action,
    messageId: message.id,
    recipients: { bcc: [], cc: [], to: [] },
    threadId: "thread-1",
  });

  return renderToString(
    <MailReplyArea
      accountId="person@example.com"
      action={action}
      draft={draft}
      message={message}
      onCancel={() => null}
      onClose={() => null}
      onSent={() => null}
      suggestedAddresses={[]}
      threadId="thread-1"
    />
  );
};

describe("reply AI actions", () => {
  it("offers Create reply and Clean with the selected model", () => {
    const markup = renderReplyArea("reply");

    expect(markup).toContain("Create reply");
    expect(markup).toContain("Clean");
    expect(markup).toContain("Codex · gpt-5.6-luna");
    expect(markup).toContain("threadComposer.createReply");
    expect(markup).toContain("threadComposer.clean");
  });

  it("groups the related AI actions", () => {
    const markup = renderReplyArea("reply");

    expect(markup).toContain('aria-label="AI reply actions"');
    expect(markup).toContain('data-slot="button-group"');
    expect(markup).toContain("before:bg-[conic-gradient");
  });

  it("offers cleanup without reply generation while forwarding", () => {
    const markup = renderReplyArea("forward");

    expect(markup).toContain("Clean");
    expect(markup).not.toContain("Create reply");
  });

  it("shows cleanup history above the reply toolbar", () => {
    const markup = renderReplyArea("forward");

    expect(markup.indexOf("Draft history")).toBeGreaterThan(-1);
    expect(markup.indexOf("Draft history")).toBeLessThan(
      markup.indexOf("Composer toolbar")
    );
    expect(markup).toContain("Original");
    expect(markup).toContain("#1 Cleaning…");
  });
});
