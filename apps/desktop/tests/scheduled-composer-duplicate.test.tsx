import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfirmOptions } from "../src/renderer/src/components/confirm-dialog";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "../src/renderer/src/components/mail/new-message/new-message-store";
import { useScheduledComposer } from "../src/renderer/src/components/mail/new-message/use-scheduled-composer";
import type {
  ScheduledMailEditSession,
  ScheduledMailFinishEditReply,
  ScheduledMailFinishEditRequest,
} from "../src/shared/ipc/scheduled-mail";

const confirm = vi.fn<(options: ConfirmOptions) => Promise<boolean>>();
const finishEdit =
  vi.fn<
    (
      request: ScheduledMailFinishEditRequest
    ) => Promise<ScheduledMailFinishEditReply>
  >();

vi.mock(import("@/components/confirm-dialog"), async (importOriginal) => ({
  ...(await importOriginal()),
  useConfirm: () => confirm,
}));

vi.mock(import("@/platform/desktop"), async (importOriginal) => ({
  ...(await importOriginal()),
  getScheduledMailApi: () => ({ finishEdit }) as never,
}));

const draft = {
  accountId: "person@example.com",
  attachments: [],
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  createdAt: 1,
  id: "draft-1",
  kind: "new" as const,
  subject: "Hello",
  to: ["friend@example.com"],
  updatedAt: 1,
};

/** The editor's snapshot from when the email was still waiting to be sent. */
const scheduledSession: ScheduledMailEditSession = {
  draft,
  item: {
    accountId: "person@example.com",
    attachments: [],
    deliveryState: "scheduled",
    draftId: "draft-1",
    preview: "Hello",
    recipients: ["friend@example.com"],
    revision: 1,
    scheduledAt: 2000,
    subject: "Hello",
  },
};

type ScheduledComposer = ReturnType<typeof useScheduledComposer>;

/** Renders the hook once and hands back the actions its composer would call. */
const composerFor = (
  scheduledEdit: ScheduledMailEditSession
): ScheduledComposer => {
  let composer: ScheduledComposer | undefined;
  const Probe = (): null => {
    composer = useScheduledComposer({
      canSend: true,
      currentDraft: scheduledEdit.draft,
      hasPendingReschedule: false,
      isBusy: false,
      onOpenChange: () => {},
      onSessionChange: () => {},
      scheduledEdit,
      selectedAccountId: scheduledEdit.item.accountId,
    });
    return null;
  };
  renderToString(
    <NewMessageStoreProvider
      store={createNewMessageStore(scheduledEdit.item.accountId)}
    >
      <Probe />
    </NewMessageStoreProvider>
  );
  if (composer === undefined) {
    throw new Error("The scheduled composer did not render");
  }
  return composer;
};

const sentAction = () => finishEdit.mock.calls.at(0)?.[0].action;

describe("scheduled composer duplicate acknowledgement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finishEdit.mockResolvedValue({ data: { kind: "finished" }, ok: true });
  });

  // The snapshot can be older than the row: the worker may have ended an
  // attempt without a known outcome since. Main decides, and it can only do
  // so if a user who was not asked is never reported as having agreed.
  it.each([
    {
      kind: "send-now" as const,
      reply: { data: { kind: "finished" as const }, ok: true as const },
      run: (composer: ScheduledComposer) => composer.sendNow(),
    },
    {
      kind: "reschedule" as const,
      reply: {
        data: { kind: "saved" as const, session: scheduledSession },
        ok: true as const,
      },
      run: (composer: ScheduledComposer) => composer.schedule(3000),
    },
  ])(
    "claims no acknowledgement for $kind before main asks for one",
    async ({ kind, reply, run }) => {
      finishEdit.mockResolvedValue(reply);

      await run(composerFor(scheduledSession));

      expect(confirm).not.toHaveBeenCalled();
      expect(sentAction()).toMatchObject({
        allowPossibleDuplicate: false,
        kind,
      });
    }
  );
});
