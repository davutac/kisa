import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { ConfirmDialogProvider } from "../src/renderer/src/components/confirm-dialog";
import MailThreadView from "../src/renderer/src/components/mail/thread-view";
import { useHotkeyLayer } from "../src/renderer/src/hotkeys";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import type { ThreadActions } from "../src/renderer/src/mail/use-thread-actions";
import type { AiApi, MailApi } from "../src/renderer/src/platform/desktop";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import { AiProviderStateProvider } from "../src/renderer/src/state/ai-provider-state";
import { LabelsProvider } from "../src/renderer/src/state/labels";
import type {
  MailDraft,
  MailThread,
  ThreadMessage,
} from "../src/shared/ipc/mail";

interface ThreadFakes {
  readonly discardDraft: Mock<MailApi["discardDraft"]>;
  savedDraft: MailDraft | null;
  readonly sendThreadMessage: Mock<MailApi["sendThreadMessage"]>;
  thread: MailThread;
}

const fakes = vi.hoisted((): ThreadFakes => ({
  discardDraft: vi.fn<MailApi["discardDraft"]>(),
  savedDraft: null,
  sendThreadMessage: vi.fn<MailApi["sendThreadMessage"]>(),
  thread: {
    accountId: "",
    awaitsServer: false,
    labels: [],
    messages: [],
    subject: "",
    threadId: "",
  },
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

vi.mock(import("@/mail/use-mail-thread"), () => ({
  useMailThread: () => ({ status: "ready" as const, thread: fakes.thread }),
}));

// The composer's AI buttons are tooltip triggers that strict mode refuses
// while disabled; they belong to the composer, not to this surface.
vi.mock(import("@/components/mail/ai-composer-button"), () => ({
  default: () => <span hidden />,
}));

vi.mock(import("@/platform/desktop"), async (importOriginal) => {
  const api = withFallback<MailApi>({
    discardDraft: fakes.discardDraft,
    listLabels: () =>
      Promise.resolve({
        data: {
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "Label_1", name: "Travel", type: "user" },
            { id: "Label_2", name: "Receipts", type: "user" },
          ],
        },
        ok: true as const,
      }),
    loadThreadDraft: () =>
      Promise.resolve({ data: fakes.savedDraft, ok: true as const }),
    prepareOutgoingAttachments: () =>
      Promise.resolve({ data: [], ok: true as const }),
    sendThreadMessage: fakes.sendThreadMessage,
  });
  const ai = withFallback<AiApi>({
    getSettings: () =>
      Promise.resolve({
        data: {
          activeProvider: "claude" as const,
          cleanupUserInstructions: "",
          providerModels: {
            claude: "claude-sonnet-5",
            codex: "gpt-5.6-luna",
            opencode: null,
          },
          providerReasoning: { claude: null, codex: "low", opencode: null },
          replyUserInstructions: "",
        },
        ok: true as const,
      }),
    listProviders: () =>
      Promise.resolve({
        data: [
          {
            authentication: "authenticated" as const,
            installed: true,
            models: [
              {
                id: "claude-sonnet-5",
                isDefault: true,
                name: "Sonnet 5",
                reasoningOptions: [],
              },
            ],
            provider: "claude" as const,
          },
        ],
        ok: true as const,
      }),
  });
  return {
    ...(await importOriginal()),
    getAiApi: () => ai,
    getMailApi: () => api,
  };
});

let approve = false;
const asked: string[] = [];
const agent = createAgent({
  allow: (step) => {
    if (step.confirm !== undefined) {
      asked.push(step.confirm);
    }
    return !step.confirm || approve;
  },
});

const ME = "me@example.com";

const message = (
  id: string,
  from: string,
  to: string,
  sentAt: number
): ThreadMessage => ({
  attachments: [],
  body: { html: `<p>About the report, ${id}</p>`, text: "About the report" },
  from,
  id,
  labelIds: [],
  senderAuthenticated: true,
  sentAt,
  snippet: "About the report",
  subject: "Quarterly report",
  to,
});

const threadIn = (
  labels: readonly string[],
  messageLabels: readonly (readonly string[])[] = [[], ["SENT"], []]
): MailThread => ({
  accountId: ME,
  awaitsServer: false,
  labels,
  messages: [
    message("m1", "Ana Lopez <ana@example.com>", ME, Date.UTC(2026, 10, 15)),
    message("m2", `Me <${ME}>`, "ana@example.com", Date.UTC(2026, 10, 16)),
    message("m3", "Ana Lopez <ana@example.com>", ME, Date.UTC(2026, 10, 17)),
  ].map((entry, index) => ({
    ...entry,
    labelIds: messageLabels[index] ?? [],
  })),
  subject: "Quarterly report",
  threadId: "t1",
});

const onClose = vi.fn<() => void>();
const actions = {
  archive: vi.fn<ThreadActions["archive"]>(),
  bulkArchive: vi.fn<ThreadActions["bulkArchive"]>(),
  bulkDeleteForever: vi.fn<ThreadActions["bulkDeleteForever"]>(),
  bulkReportSpam: vi.fn<ThreadActions["bulkReportSpam"]>(),
  bulkSetLabel: vi.fn<ThreadActions["bulkSetLabel"]>(),
  bulkSetReadState: vi.fn<ThreadActions["bulkSetReadState"]>(),
  bulkSetStarred: vi.fn<ThreadActions["bulkSetStarred"]>(),
  bulkTrash: vi.fn<ThreadActions["bulkTrash"]>(),
  deleteForever: vi.fn<ThreadActions["deleteForever"]>(),
  moveToInbox: vi.fn<ThreadActions["moveToInbox"]>(),
  notSpam: vi.fn<ThreadActions["notSpam"]>(),
  reportSpam: vi.fn<ThreadActions["reportSpam"]>(),
  setLabel: vi.fn<ThreadActions["setLabel"]>(),
  toggleRead: vi.fn<ThreadActions["toggleRead"]>(),
  toggleStar: vi.fn<ThreadActions["toggleStar"]>(),
  trash: vi.fn<ThreadActions["trash"]>(),
} satisfies ThreadActions;

// The route that opens a conversation registers its hotkey layer.
const ThreadLayer = () => {
  useHotkeyLayer("thread", true);
  return null;
};

const renderThread = (
  labels: readonly string[] = ["INBOX", "Travel"],
  {
    messageLabels,
    withThreadLayer = false,
  }: {
    readonly messageLabels?: readonly (readonly string[])[];
    readonly withThreadLayer?: boolean;
  } = {}
) => {
  fakes.thread = threadIn(labels, messageLabels);
  render(
    <AccountsProvider
      accounts={[{ email: ME, provider: "gmail" }]}
      onReorder={() => Promise.resolve()}
    >
      <LabelsProvider accountIds={[ME]}>
        <AiProviderStateProvider>
          <AppHotkeysProvider>
            {withThreadLayer ? <ThreadLayer /> : null}
            <ConfirmDialogProvider>
              <MailThreadView
                accountId={ME}
                actions={actions}
                onClose={onClose}
                threadId="t1"
              />
            </ConfirmDialogProvider>
          </AppHotkeysProvider>
        </AiProviderStateProvider>
      </LabelsProvider>
    </AccountsProvider>
  );
};

const onPage = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

const unnamedOnPage = () =>
  onPage()
    .filter((entry) => !entry.label)
    .map((entry) => `${entry.component} ${entry.ref}`);

const openMessageHeaders = () =>
  screen
    .queryAllByRole("button", { name: /^Collapse message from/u })
    .map((header) => header.getAttribute("aria-label")?.split(",")[0]);

const duplicatesOf = (labels: readonly (string | undefined)[]) =>
  labels.filter((label, index) => labels.indexOf(label) !== index);

const savedReply: MailDraft = {
  accountId: ME,
  attachments: [],
  bcc: [],
  body: { html: "<p>Thanks, Ana!</p>", text: "Thanks, Ana!" },
  cc: [],
  createdAt: 1,
  id: "draft-1",
  kind: "reply",
  messageId: "m1",
  subject: "",
  threadId: "t1",
  to: ["ana@example.com"],
  updatedAt: 1,
};

describe("the open conversation, for an agent", () => {
  beforeEach(() => {
    fakes.savedDraft = null;
    fakes.sendThreadMessage.mockResolvedValue({
      data: { refusedRecipients: [] },
      ok: true,
    });
    fakes.discardDraft.mockResolvedValue({ data: undefined, ok: true });
  });

  afterEach(() => {
    approve = false;
    asked.length = 0;
    vi.clearAllMocks();
  });

  it("names every control, and an agent can mark, label and expand", async () => {
    renderThread();
    await act(settle);

    const labels = onPage().map((entry) => entry.label ?? "");
    // The messages are one accordion; its items are their headers.
    const messages =
      onPage().find((entry) => entry.component === "accordion")?.items ?? [];
    const headers = messages.map((item) => item.label ?? "");
    expect({
      // Each message header offers to copy its own addresses, so an address
      // in several messages is offered several times; each copies the same.
      duplicates: [...new Set(duplicatesOf(labels))].toSorted(),
      headers: headers.map((label) => label.split(",")[0]),
      unnamed: unnamedOnPage(),
      uniqueHeaders: new Set(headers).size,
    }).toStrictEqual({
      duplicates: ["Copy ana@example.com", "Copy me@example.com"],
      headers: [
        "Expand message from Ana Lopez <ana@example.com>",
        "Expand message from Me <me@example.com>",
        "Collapse message from Ana Lopez <ana@example.com>",
      ],
      unnamed: [],
      uniqueHeaders: 3,
    });
    expect(labels).toStrictEqual(
      expect.arrayContaining([
        "Back to inbox",
        "Archive",
        "Star",
        "Mark as unread",
        "Report spam",
        "Move to trash",
        "Manage labels",
        "Categorize with AI",
        "Remove Travel",
        "Reply",
        "Forward",
      ])
    );

    const [firstFromAna = ""] = headers;
    const result = await agent.act({
      steps: [
        { action: "press", ref: "Mark as unread" },
        { action: "press", args: ["Receipts"], ref: "Manage labels" },
        { action: "press", ref: "Remove Travel" },
        { action: "open", args: [messages[0]?.value], ref: "Messages" },
      ],
    });
    await act(settle);
    expect({
      expanded: screen
        .getByRole("button", {
          name: firstFromAna.replace("Expand", "Collapse"),
        })
        .getAttribute("aria-expanded"),
      labels: actions.setLabel.mock.calls.map(([, change]) => [
        change.labelName,
        change.applied,
      ]),
      ok: result.ok,
      read: actions.toggleRead.mock.calls,
    }).toStrictEqual({
      expanded: "true",
      labels: [
        ["Receipts", true],
        ["Travel", false],
      ],
      ok: true,
      read: [[{ accountId: ME, isUnread: false, threadId: "t1" }]],
    });
  });

  it("opens one message at a time from its heading, and closes it again", async () => {
    const user = userEvent.setup();
    renderThread();
    await act(settle);
    // jsdom names no heading from a labelled button inside it, so the
    // headings are found from their triggers.
    const headingCount = screen
      .getAllByRole("button", { name: / message from /u })
      .filter((header) => header.parentElement?.tagName === "H2").length;

    await user.click(
      screen.getAllByRole("button", { name: /^Expand message from Ana/u })[0]
    );
    await act(settle);
    const afterOpening = openMessageHeaders();
    await user.click(
      screen.getByRole("button", { name: /^Collapse message from Ana/u })
    );
    await act(settle);

    expect({ afterOpening, headingCount }).toStrictEqual({
      afterOpening: ["Collapse message from Ana Lopez <ana@example.com>"],
      headingCount: 3,
    });
    expect(openMessageHeaders()).toStrictEqual([]);
  });

  it("opens the previous message on K, and focuses its heading", async () => {
    const user = userEvent.setup();
    renderThread(undefined, { withThreadLayer: true });
    await act(settle);

    await user.keyboard("k");
    await act(settle);
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toMatch(
        /^Collapse message from Me/u
      );
    });

    expect(openMessageHeaders()).toStrictEqual([
      "Collapse message from Me <me@example.com>",
    ]);
  });

  it("moves the conversation to Trash only once a person agrees", async () => {
    renderThread();
    await act(settle);
    expect(
      screen.getByRole("button", { name: "Move to trash" }).dataset.agentConfirm
    ).toBe("Moves “Quarterly report” to Trash");

    const trash = { steps: [{ action: "press", ref: "Move to trash" }] };
    const refused = await agent.act(trash);
    expect({
      ok: refused.ok,
      trashed: actions.trash.mock.calls.length,
    }).toStrictEqual({ ok: false, trashed: 0 });

    approve = true;
    const allowed = await agent.act(trash);
    expect({
      ok: allowed.ok,
      trashed: actions.trash.mock.calls.map(([thread]) => thread),
    }).toStrictEqual({
      ok: true,
      trashed: [{ accountId: ME, threadId: "t1" }],
    });
  });

  it("archives and stars from the header, and leaves as it archives", async () => {
    renderThread();
    await act(settle);

    const result = await agent.act({
      steps: [
        { action: "setPressed", args: [true], ref: "Star" },
        { action: "press", ref: "Archive" },
      ],
    });
    expect({
      archived: actions.archive.mock.calls.map(([thread, leave]) => [
        thread,
        leave === onClose,
      ]),
      ok: result.ok,
      starred: actions.toggleStar.mock.calls.map(([thread]) => thread),
    }).toStrictEqual({
      archived: [[{ accountId: ME, threadId: "t1" }, true]],
      ok: true,
      starred: [{ accountId: ME, isStarred: false, threadId: "t1" }],
    });
  });

  it("reports spam only once a person agrees", async () => {
    renderThread();
    await act(settle);
    expect(
      screen.getByRole("button", { name: "Report spam" }).dataset.agentConfirm
    ).toBe("Moves “Quarterly report” to Spam");

    const report = { steps: [{ action: "press", ref: "Report spam" }] };
    const refused = await agent.act(report);
    approve = true;
    const allowed = await agent.act(report);

    expect({
      allowed: allowed.ok,
      refused: refused.ok,
      reported: actions.reportSpam.mock.calls.map(([thread, leave]) => [
        thread,
        leave === onClose,
      ]),
    }).toStrictEqual({
      allowed: true,
      refused: false,
      reported: [[{ accountId: ME, threadId: "t1" }, true]],
    });
  });

  it("offers Move to Inbox, on E too, once a received message left the Inbox", async () => {
    const user = userEvent.setup();
    renderThread(["Travel", "SENT"], { withThreadLayer: true });
    await act(settle);

    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    await user.keyboard("e");
    await agent.act({ steps: [{ action: "press", ref: "Move to Inbox" }] });

    expect(actions.moveToInbox.mock.calls).toStrictEqual([
      [{ accountId: ME, threadId: "t1" }],
      [{ accountId: ME, threadId: "t1" }],
    ]);
  });

  it("offers neither Move to Inbox nor Report spam on the user's own mail", async () => {
    renderThread(["SENT"], { messageLabels: [["SENT"], ["SENT"], ["SENT"]] });
    await act(settle);

    const labels = new Set(onPage().map((entry) => entry.label));
    expect({
      archive: labels.has("Archive"),
      moveToInbox: labels.has("Move to Inbox"),
      reportSpam: labels.has("Report spam"),
      star: labels.has("Star"),
    }).toStrictEqual({
      archive: false,
      moveToInbox: false,
      reportSpam: false,
      star: true,
    });
  });

  it("offers no Archive, Star or Report spam in Spam", async () => {
    renderThread(["SPAM"]);
    await act(settle);

    const labels = new Set(onPage().map((entry) => entry.label));
    expect(
      ["Archive", "Move to Inbox", "Star", "Report spam"].filter((label) =>
        labels.has(label)
      )
    ).toStrictEqual([]);
  });

  it("asks once before deleting a conversation in Trash forever", async () => {
    renderThread(["TRASH"]);
    await act(settle);
    expect(
      screen.getByRole("button", { name: "Delete forever" }).dataset
        .agentConfirm
    ).toBeUndefined();

    const remove = {
      steps: [
        { action: "press", ref: "Delete forever" },
        {
          action: "press",
          args: ["Delete forever"],
          ref: "Delete conversation?",
        },
      ],
    };
    const refused = await agent.act(remove);
    await act(settle);
    expect({
      deleted: actions.deleteForever.mock.calls.length,
      ok: refused.ok,
    }).toStrictEqual({ deleted: 0, ok: false });

    approve = true;
    asked.length = 0;
    const allowed = await agent.act({ steps: remove.steps.slice(1) });
    await act(settle);
    expect({
      asked: asked.length,
      deleted: actions.deleteForever.mock.calls.map(([thread]) => thread),
      ok: allowed.ok,
    }).toStrictEqual({
      asked: 1,
      deleted: [{ accountId: ME, threadId: "t1" }],
      ok: true,
    });
  });

  it("names the reply's controls, and sends or discards it only once a person agrees", async () => {
    fakes.savedDraft = savedReply;
    renderThread();
    await act(settle);

    expect({
      duplicates: duplicatesOf(onPage().map((entry) => entry.label)).filter(
        (label) => label?.startsWith("Copy ") !== true
      ),
      unnamed: unnamedOnPage(),
    }).toStrictEqual({ duplicates: [], unnamed: [] });
    expect(
      screen.getByRole("button", { name: /^Send/u }).dataset.agentConfirm
    ).toBe("Sends this reply to ana@example.com");

    const send = { steps: [{ action: "press", ref: "Send" }] };
    const discard = { steps: [{ action: "press", ref: "Discard draft" }] };
    const refused = await agent.act(send);
    const kept = await agent.act(discard);
    expect({
      discarded: fakes.discardDraft.mock.calls.length,
      ok: [refused.ok, kept.ok],
      sent: fakes.sendThreadMessage.mock.calls.length,
    }).toStrictEqual({ discarded: 0, ok: [false, false], sent: 0 });

    approve = true;
    const sent = await agent.act(send);
    await act(settle);
    expect({
      ok: sent.ok,
      sent: fakes.sendThreadMessage.mock.calls.map(([request]) => [
        request.action,
        request.messageId,
        request.to,
      ]),
    }).toStrictEqual({
      ok: true,
      sent: [["reply", "m1", ["ana@example.com"]]],
    });
  });

  it("discards a reply only once a person agrees", async () => {
    fakes.savedDraft = savedReply;
    renderThread();
    await act(settle);
    expect(
      screen.getByRole("button", { name: "Discard draft" }).dataset.agentConfirm
    ).toBe("Deletes this reply and what it says");

    approve = true;
    const discarded = await agent.act({
      steps: [{ action: "press", ref: "Discard draft" }],
    });
    await act(settle);
    expect({
      discarded: fakes.discardDraft.mock.calls,
      ok: discarded.ok,
    }).toStrictEqual({
      discarded: [[{ accountId: ME, draftId: "draft-1" }]],
      ok: true,
    });
  });
});
