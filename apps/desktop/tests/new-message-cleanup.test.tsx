import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NewMessageForm from "../src/renderer/src/components/mail/new-message/new-message-form";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "../src/renderer/src/components/mail/new-message/new-message-store";
import type { useComposerFocus } from "../src/renderer/src/components/mail/use-composer-focus";
import type {
  Tooltip as TooltipComponent,
  TooltipContent as TooltipContentComponent,
  TooltipTrigger as TooltipTriggerComponent,
} from "../src/renderer/src/components/ui/tooltip";

type TooltipProps = Parameters<typeof TooltipComponent>[0];
type TooltipContentProps = Parameters<typeof TooltipContentComponent>[0];
type TooltipTriggerProps = Parameters<typeof TooltipTriggerComponent>[0];

vi.mock(import("@/components/accounts/account-picker"), () => ({
  default: () => <span />,
}));

vi.mock(import("@/components/mail/email-recipient-fields"), () => ({
  default: () => <span />,
}));

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

vi.mock(import("@/components/mail/outgoing-attachments"), () => ({
  OutgoingAttachmentButton: ({ disabled }: { disabled?: boolean }) => (
    <button aria-label="Add attachments" disabled={disabled} type="button">
      Attach
    </button>
  ),
  OutgoingAttachmentList: () => null,
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
  getHotkeyAriaLabel: vi.fn<(command: string) => string>(() => "Meta+Shift+C"),
  getHotkeyDisplay: vi.fn<
    (command: string) => { bindings: string[]; label: string }
  >(() => ({
    bindings: ["⌘ ⇧ C"],
    label: "Clean up draft",
  })),
  useAppCommand: vi.fn<() => void>(),
}));

const elementRef = (): null => null;

const handleRef = (): null => null;

const focus = {
  getCurrentTarget: () => null,
  getElement: () => null,
  getReturnElement: () => null,
  handleRefFor: () => handleRef,
  onFocusCapture: () => null,
  refFor: () => elementRef,
  replaceContent: () => false,
  requestRestore: () => null,
  restorePending: () => null,
} satisfies ReturnType<typeof useComposerFocus>;

const renderForm = ({ canClean }: { canClean: boolean }): string => {
  const store = createNewMessageStore("");

  return renderToString(
    <NewMessageStoreProvider store={store}>
      <NewMessageForm
        accounts={[]}
        addAttachments={() => null}
        applyTemplate={() => null}
        attachments={[]}
        canClean={canClean}
        canSend={false}
        canStash={false}
        cleanupModelLabel="Codex · gpt-5.6-luna"
        focus={focus}
        inputRef={{ current: null }}
        onAccountSelect={() => null}
        onClean={() => Promise.resolve()}
        onComposerChange={() => null}
        onDismissCleanVersion={() => null}
        onSelectCleanVersion={() => null}
        onSend={() => Promise.resolve()}
        onStash={() => null}
        onSubjectChange={() => null}
        selectedAccountId=""
        sendShortcutLabel="Send"
        setAttachments={() => null}
        templates={[]}
      />
    </NewMessageStoreProvider>
  );
};

describe("new message cleanup", () => {
  it("places Clean immediately before attachments in the composer toolbar", () => {
    const markup = renderForm({ canClean: true });

    expect(markup.indexOf("Clean")).toBeGreaterThan(-1);
    expect(markup.indexOf("Clean")).toBeLessThan(
      markup.indexOf("Add attachments")
    );
    expect(markup).toContain('aria-label="Clean up draft"');
    expect(markup).toContain("before:bg-[conic-gradient");
  });

  it("shows its shortcut, provider, and model", () => {
    const markup = renderForm({ canClean: true });

    expect(markup).toContain('aria-keyshortcuts="Meta+Shift+C"');
    expect(markup).toContain("Codex · gpt-5.6-luna");
    expect(markup).toContain("composer.clean");
  });

  it("keeps Clean and draft inputs available while generations run", () => {
    const markup = renderForm({ canClean: true });
    const cleanButton = markup.match(
      /<button[^>]*aria-label="Clean up draft"[^>]*>/u
    )?.[0];
    const attachmentButton = markup.match(
      /<button[^>]*aria-label="Add attachments"[^>]*>/u
    )?.[0];
    const subjectInput = markup.match(
      /<input[^>]*id="new-message-subject"[^>]*>/u
    )?.[0];

    expect(cleanButton).toContain('aria-busy="false"');
    expect(cleanButton).not.toContain(' disabled=""');
    expect(attachmentButton).not.toContain(' disabled=""');
    expect(subjectInput).not.toContain(' disabled=""');
  });

  it("keeps history hidden before a clean starts", () => {
    const markup = renderForm({ canClean: true });

    expect(markup).not.toContain("Draft history");
  });
});
