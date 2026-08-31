import type { IpcRendererEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ScheduledMailChanged,
  ScheduledMailFinishEditRequest,
  ScheduledMailKey,
  ScheduledMailOutcome,
  ScheduledMailPageRequest,
  ScheduledMailScheduleRequest,
  ScheduledMailScope,
  ScheduledMailSendNowRequest,
} from "../src/shared/ipc/scheduled-mail";

type RendererPayload = ScheduledMailChanged | ScheduledMailOutcome;
type ScheduledMailInvokeRequest =
  | boolean
  | ScheduledMailFinishEditRequest
  | ScheduledMailKey
  | ScheduledMailPageRequest
  | ScheduledMailScheduleRequest
  | ScheduledMailScope
  | ScheduledMailSendNowRequest;
type RendererListener = (
  event: IpcRendererEvent,
  payload: RendererPayload
) => void;

const electron = vi.hoisted(() => ({
  invoke:
    vi.fn<
      (channel: string, request: ScheduledMailInvokeRequest) => Promise<object>
    >(),
  on: vi.fn<(channel: string, listener: RendererListener) => void>(),
  removeListener:
    vi.fn<(channel: string, listener: RendererListener) => void>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("electron", () => ({ ipcRenderer: electron }));

const { scheduledMailApi } = await import("../src/preload/scheduled-mail-api");

const key = { accountId: "person@example.com", draftId: "draft-1" };
const draft = {
  accountId: key.accountId,
  attachments: [],
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  id: key.draftId,
  kind: "new" as const,
  subject: "Hello",
  to: ["friend@example.com"],
};
const scope = { accountIds: [key.accountId] };
const scheduleRequest = { ...key, draft, scheduledAt: 2000 };
const finishRequest = {
  ...key,
  action: { kind: "discard" as const },
};
const sendNowRequest = { ...key, allowPossibleDuplicate: false };

const invokeCases = [
  {
    channel: "desktop:scheduled-mail:list-page",
    request: scope,
    run: () => scheduledMailApi.listScheduledMailPage(scope),
  },
  {
    channel: "desktop:scheduled-mail:attention-count",
    request: scope,
    run: () => scheduledMailApi.getScheduledMailAttentionCount(scope),
  },
  {
    channel: "desktop:scheduled-mail:schedule",
    request: scheduleRequest,
    run: () => scheduledMailApi.scheduleMail(scheduleRequest),
  },
  {
    channel: "desktop:scheduled-mail:begin-edit",
    request: key,
    run: () => scheduledMailApi.beginScheduledMailEdit(key),
  },
  {
    channel: "desktop:scheduled-mail:finish-edit",
    request: finishRequest,
    run: () => scheduledMailApi.finishScheduledMailEdit(finishRequest),
  },
  {
    channel: "desktop:scheduled-mail:cancel-to-stash",
    request: key,
    run: () => scheduledMailApi.cancelScheduledMailToStash(key),
  },
  {
    channel: "desktop:scheduled-mail:discard",
    request: key,
    run: () => scheduledMailApi.discardScheduledMail(key),
  },
  {
    channel: "desktop:scheduled-mail:send-now",
    request: sendNowRequest,
    run: () => scheduledMailApi.sendScheduledMailNow(sendNowRequest),
  },
] as const;

describe("scheduled mail preload bridge", () => {
  beforeEach(() => {
    electron.invoke.mockReset();
    electron.on.mockReset();
    electron.removeListener.mockReset();
  });

  it.each(invokeCases)(
    "invokes $channel with its narrow request",
    async ({ channel, request, run }) => {
      electron.invoke.mockResolvedValue({ data: { items: [] }, ok: true });

      await run();

      expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(channel, request);
    }
  );

  it("returns scoped presence on the existing attention-count channel", async () => {
    const reply = {
      data: { count: 0, hasScheduledMail: true },
      ok: true as const,
    };
    electron.invoke.mockResolvedValue(reply);

    await expect(
      scheduledMailApi.getScheduledMailAttentionCount(scope)
    ).resolves.toStrictEqual(reply);
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(
      "desktop:scheduled-mail:attention-count",
      scope
    );
  });

  it.each([
    {
      channel: "desktop:scheduled-mail:changed",
      payload: {
        accountId: "person@example.com",
        draftId: "draft-1",
        kind: "upsert" as const,
      },
      subscribe: scheduledMailApi.onScheduledMailChanged,
    },
  ])(
    "removes only its exact $channel subscription",
    ({ channel, payload, subscribe }) => {
      const listener = vi.fn<(payload: RendererPayload) => void>();
      const unsubscribe = subscribe(listener);
      const subscription = electron.on.mock.calls[0]?.[1];

      expect(subscription).toBeDefined();
      subscription?.({} as IpcRendererEvent, payload);
      expect(listener).toHaveBeenCalledExactlyOnceWith(payload);

      unsubscribe();
      expect(electron.removeListener).toHaveBeenCalledExactlyOnceWith(
        channel,
        subscription
      );
    }
  );

  it("announces outcome readiness only while the exact subscription is installed", () => {
    electron.invoke.mockResolvedValue({ data: undefined, ok: true });
    const listener = vi.fn<(payload: ScheduledMailOutcome) => void>();
    const unsubscribe = scheduledMailApi.onScheduledMailOutcome(listener);
    const subscription = electron.on.mock.calls[0]?.[1];
    const payload = {
      accountId: "person@example.com",
      draftId: "draft-1",
      intent: "feedback" as const,
      kind: "sent" as const,
    };

    expect(subscription).toBeDefined();
    subscription?.({} as IpcRendererEvent, payload);
    expect(listener).toHaveBeenCalledExactlyOnceWith(payload);
    expect({
      invoke: electron.invoke.mock.calls[0],
      subscription: electron.on.mock.calls[0],
      subscriptionInstalledFirst:
        (electron.on.mock.invocationCallOrder[0] ?? 0) <
        (electron.invoke.mock.invocationCallOrder[0] ?? 0),
    }).toStrictEqual({
      invoke: ["desktop:scheduled-mail:outcome-readiness", true],
      subscription: ["desktop:scheduled-mail:outcome", subscription],
      subscriptionInstalledFirst: true,
    });

    unsubscribe();

    expect({
      invoke: electron.invoke.mock.calls[1],
      removed: electron.removeListener.mock.calls[0],
      subscriptionRemovedFirst:
        (electron.removeListener.mock.invocationCallOrder[0] ?? 0) <
        (electron.invoke.mock.invocationCallOrder[1] ?? 0),
    }).toStrictEqual({
      invoke: ["desktop:scheduled-mail:outcome-readiness", false],
      removed: ["desktop:scheduled-mail:outcome", subscription],
      subscriptionRemovedFirst: true,
    });
  });
});
