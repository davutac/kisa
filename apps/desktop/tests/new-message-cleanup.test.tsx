import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NewMessageForm from "../src/renderer/src/components/mail/new-message/new-message-form";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "../src/renderer/src/components/mail/new-message/new-message-store";
import type { useComposerFocus } from "../src/renderer/src/components/mail/use-composer-focus";

vi.mock(import("@/components/accounts/account-picker"), () => ({
  default: () => null,
}));

vi.mock(import("@/components/mail/email-recipient-fields"), () => ({
  default: () => null,
}));

vi.mock(import("@/components/mail/email-composer"), () => ({
  default: ({ toolbarActions }: { toolbarActions?: ReactNode }) => (
    <div aria-label="Composer toolbar">{toolbarActions}</div>
  ),
}));

vi.mock(import("@/components/mail/new-message-attachments"), () => ({
  NewMessageAttachmentButton: ({ disabled }: { disabled?: boolean }) => (
    <button aria-label="Add attachments" disabled={disabled} type="button">
      Attach
    </button>
  ),
  NewMessageAttachmentList: () => null,
}));

vi.mock(import("@/components/ui/tooltip"), () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
}));

vi.mock(import("@/hotkeys"), () => ({
  HotkeyHint: ({ command }: { command: string }) => <span>{command}</span>,
  getHotkeyAriaLabel: vi.fn<(command: string) => string>(() => "Meta+Shift+C"),
  getHotkeyDisplay: vi.fn<(command: string) => object>(() => ({
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

const renderForm = ({
  canClean,
  isCleaning,
}: {
  canClean: boolean;
  isCleaning: boolean;
}): string => {
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
        isCleaning={isCleaning}
        onClean={() => Promise.resolve()}
        onSend={() => Promise.resolve()}
        onStash={() => null}
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
    const markup = renderForm({ canClean: true, isCleaning: false });

    expect(markup.indexOf("Clean")).toBeGreaterThan(-1);
    expect(markup.indexOf("Clean")).toBeLessThan(
      markup.indexOf("Add attachments")
    );
    expect(markup).toContain('aria-label="Clean up draft"');
    expect(markup).toContain("before:bg-[conic-gradient");
  });

  it("shows its shortcut, provider, and model", () => {
    const markup = renderForm({ canClean: true, isCleaning: false });

    expect(markup).toContain('aria-keyshortcuts="Meta+Shift+C"');
    expect(markup).toContain("Codex · gpt-5.6-luna");
    expect(markup).toContain("composer.clean");
  });

  it("shows a busy state and disables toolbar actions during cleanup", () => {
    const markup = renderForm({ canClean: false, isCleaning: true });
    const cleanButton = markup.match(
      /<button[^>]*aria-label="Clean up draft"[^>]*>/u
    )?.[0];
    const attachmentButton = markup.match(
      /<button[^>]*aria-label="Add attachments"[^>]*>/u
    )?.[0];

    expect(markup).toContain("Cleaning…");
    expect(cleanButton).toContain('aria-busy="true"');
    expect(cleanButton).toContain("disabled");
    expect(cleanButton).toContain("disabled:before:hidden");
    expect(attachmentButton).toContain("disabled");
  });
});
