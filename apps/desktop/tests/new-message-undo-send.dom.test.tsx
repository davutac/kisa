import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { ConfirmDialogProvider } from "../src/renderer/src/components/confirm-dialog";
import { NewMessagePage } from "../src/renderer/src/components/mail/new-message";
import { TitlebarSlotContext } from "../src/renderer/src/components/shell/titlebar-slot";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import {
  restoreComposeDraft,
  undoneDrafts,
} from "../src/renderer/src/mail/undo-send";
import type { MailApi } from "../src/renderer/src/platform/desktop";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import { AiProviderStateProvider } from "../src/renderer/src/state/ai-provider-state";
import { hydrateAppSettingsState } from "../src/renderer/src/state/app-settings";
import { UndoProvider } from "../src/renderer/src/undo/undo-provider";
import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";
import type { MailDraftInput } from "../src/shared/ipc/mail";

interface ComposeFakes {
  readonly cancelSend: Mock<MailApi["cancelSend"]>;
  readonly discardDraft: Mock<MailApi["discardDraft"]>;
  readonly saveDraft: Mock<MailApi["saveDraft"]>;
  readonly sendMessage: Mock<MailApi["sendMessage"]>;
}

const fakes = vi.hoisted((): ComposeFakes => ({
  cancelSend: vi.fn<MailApi["cancelSend"]>(),
  discardDraft: vi.fn<MailApi["discardDraft"]>(),
  saveDraft: vi.fn<MailApi["saveDraft"]>(),
  sendMessage: vi.fn<MailApi["sendMessage"]>(),
}));

// The page's leave guard needs a router; leaving is the test's to do, as
// navigating to and from the page would.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useBlocker: (() => ({ status: "idle" })) as never,
}));

// What the test doesn't answer replies like an unreachable main process,
// and subscriptions are no-ops.
const { withFallback } = vi.hoisted(() => ({
  withFallback: <Api extends object>(answered: Partial<Api>): Api =>
    new Proxy(answered, {
      get: (target, key) => {
        if (key in target) {
          return Reflect.get(target, key);
        }
        return String(key).startsWith("on")
          ? () => () => {}
          : () => Promise.resolve({ error: "Unavailable", ok: false });
      },
    }) as Api,
}));

vi.mock(import("@/platform/desktop"), async (importOriginal) => {
  const api = withFallback<MailApi>({
    cancelSend: fakes.cancelSend,
    discardDraft: fakes.discardDraft,
    listStashedDrafts: () => Promise.resolve({ data: [], ok: true as const }),
    prepareOutgoingAttachments: () =>
      Promise.resolve({ data: [], ok: true as const }),
    saveDraft: fakes.saveDraft,
    sendMessage: fakes.sendMessage,
  });
  return { ...(await importOriginal()), getMailApi: () => api };
});

const agent = createAgent({ allow: () => true });

const ME = "ana@example.com";
const draft: MailDraftInput = {
  accountId: ME,
  attachments: [],
  bcc: [],
  body: { html: "<p>See you at noon</p>", text: "See you at noon" },
  cc: [],
  id: "draft-1",
  kind: "new",
  subject: "Lunch?",
  to: ["ben@example.com"],
};

const onClose = vi.fn<() => void>();

/**
 * The compose route, as far as this test needs it: the page is shown until
 * it closes, and opens afresh when Undo hands an email back, as the shell
 * opens it, while the app-wide providers, Undo's among them, stay.
 */
const ComposeHost = () => {
  const [opened, setOpened] = useState(1);
  const [isOpen, setIsOpen] = useState(true);
  useEffect(
    () =>
      undoneDrafts.subscribe((state) => {
        if (state.compose !== undefined) {
          setIsOpen(true);
          setOpened((count) => count + 1);
        }
      }),
    []
  );
  return isOpen ? (
    <NewMessagePage
      accounts={[{ email: ME, provider: "gmail" }]}
      initialAccountId={ME}
      key={opened}
      onClose={() => {
        onClose();
        setIsOpen(false);
      }}
    />
  ) : null;
};

const renderComposer = () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  return render(
    <AccountsProvider
      accounts={[{ email: ME, provider: "gmail" }]}
      onReorder={() => Promise.resolve()}
    >
      <AiProviderStateProvider>
        <AppHotkeysProvider>
          <ConfirmDialogProvider>
            <UndoProvider>
              <TitlebarSlotContext.Provider value={slot}>
                <ComposeHost />
              </TitlebarSlotContext.Provider>
            </UndoProvider>
          </ConfirmDialogProvider>
        </AppHotkeysProvider>
      </AiProviderStateProvider>
    </AccountsProvider>
  );
};

const subject = () =>
  screen.queryByRole<HTMLInputElement>("textbox", { name: "Subject" })?.value;

describe("a new email with Undo send", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the email in Stash while it is held, and Undo opens it again", async () => {
    hydrateAppSettingsState({ ...DEFAULT_APP_SETTINGS, undoSendSeconds: 10 });
    fakes.saveDraft.mockImplementation((input) =>
      Promise.resolve({
        data: { ...input, createdAt: 1, updatedAt: 1 },
        ok: true as const,
      })
    );
    fakes.discardDraft.mockResolvedValue({ data: undefined, ok: true });
    const held =
      Promise.withResolvers<Awaited<ReturnType<MailApi["sendMessage"]>>>();
    fakes.sendMessage.mockReturnValue(held.promise);
    fakes.cancelSend.mockImplementation(() => {
      held.resolve({ data: { kind: "canceled" }, ok: true });
      return Promise.resolve({ data: "canceled", ok: true });
    });
    const user = userEvent.setup();

    // Undo hands a taken-back email to the page as it opens.
    restoreComposeDraft(draft);
    renderComposer();
    await act(settle);
    const restored = subject();

    await agent.act({ steps: [{ action: "press", ref: "Send email" }] });
    await act(settle);
    const whileHeld = {
      closed: onClose.mock.calls.length,
      saved: fakes.saveDraft.mock.calls.map(([input]) => input.id),
      sentFrom: fakes.sendMessage.mock.calls.map(
        ([request]) => request.draftId
      ),
    };
    // Mod is Control off Apple platforms, as in jsdom.
    await user.keyboard("{Control>}z{/Control}");
    await act(settle);

    expect({
      reopened: subject(),
      restored,
      whileHeld,
    }).toStrictEqual({
      reopened: "Lunch?",
      restored: "Lunch?",
      whileHeld: { closed: 1, saved: ["draft-1"], sentFrom: ["draft-1"] },
    });
  });
});
