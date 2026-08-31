// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { vi } from "vitest";

import {
  SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL,
  SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL,
  SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL,
  SCHEDULED_MAIL_DISCARD_CHANNEL,
  SCHEDULED_MAIL_FINISH_EDIT_CHANNEL,
  SCHEDULED_MAIL_LIST_PAGE_CHANNEL,
  SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL,
  SCHEDULED_MAIL_SCHEDULE_CHANNEL,
  SCHEDULED_MAIL_SEND_NOW_CHANNEL,
} from "../src/shared/ipc/channels";
import type {
  ScheduledMailAttentionCount,
  ScheduledMailEditSession,
  ScheduledMailFinishEditResult,
  ScheduledMailFinishEditRequest,
  ScheduledMailKey,
  ScheduledMailPage,
  ScheduledMailPageRequest,
  ScheduledMailScheduleRequest,
  ScheduledMailScope,
  ScheduledMailSendNowRequest,
  ScheduledMailSummary,
} from "../src/shared/ipc/scheduled-mail";

const draft = {
  accountId: "person@example.com",
  attachments: [],
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  id: "draft-1",
  kind: "new" as const,
  subject: "Hello",
  to: ["friend@example.com"],
};

const summary: ScheduledMailSummary = {
  accountId: "person@example.com",
  attachments: [],
  deliveryState: "scheduled",
  draftId: "draft-1",
  preview: "Hello",
  recipients: ["friend@example.com"],
  revision: 1,
  scheduledAt: 2000,
  subject: "Hello",
};

const session: ScheduledMailEditSession = {
  draft: { ...draft, createdAt: 1000, updatedAt: 1000 },
  item: summary,
};

const state = vi.hoisted(() => ({
  begin:
    vi.fn<
      (
        request: ScheduledMailKey,
        ownerId: number
      ) => Effect.Effect<ScheduledMailEditSession>
    >(),
  bindOwner: vi.fn<(owner: IpcMainInvokeEvent["sender"]) => number>(),
  cancel: vi.fn<(request: ScheduledMailKey) => Effect.Effect<void>>(),
  count:
    vi.fn<
      (
        request: ScheduledMailScope
      ) => Effect.Effect<ScheduledMailAttentionCount>
    >(),
  discard: vi.fn<(request: ScheduledMailKey) => Effect.Effect<void>>(),
  finish:
    vi.fn<
      (
        request: ScheduledMailFinishEditRequest,
        ownerId: number
      ) => Effect.Effect<ScheduledMailFinishEditResult>
    >(),
  list: vi.fn<
    (request: ScheduledMailPageRequest) => Effect.Effect<ScheduledMailPage>
  >(),
  outcomeReadiness:
    vi.fn<
      (
        owner: IpcMainInvokeEvent["sender"],
        ready: boolean
      ) => Effect.Effect<void>
    >(),
  schedule:
    vi.fn<
      (
        request: ScheduledMailScheduleRequest,
        ownerId: number
      ) => Effect.Effect<ScheduledMailSummary>
    >(),
  sendNow:
    vi.fn<(request: ScheduledMailSendNowRequest) => Effect.Effect<void>>(),
}));

vi.mock("../src/main/mail/outgoing-attachment-authorizations", () => ({
  bindOutgoingAttachmentOwner: state.bindOwner,
}));

vi.mock("../src/main/mail/scheduled-mail", () => ({
  beginScheduledMailEdit: state.begin,
  cancelScheduledMailToStash: state.cancel,
  discardScheduledMail: state.discard,
  finishScheduledMailEdit: state.finish,
  getScheduledMailAttentionCount: state.count,
  listScheduledMailPage: state.list,
  scheduleMail: state.schedule,
  sendScheduledMailNow: state.sendNow,
}));

vi.mock("../src/main/mail/scheduled-mail-notifications", () => ({
  setScheduledMailOutcomeTargetReadyEffect: state.outcomeReadiness,
}));

const {
  beginScheduledMailEdit,
  cancelScheduledMailToStash,
  discardScheduledMail,
  finishScheduledMailEdit,
  getScheduledMailAttentionCount,
  listScheduledMailPage,
  scheduleMail,
  sendScheduledMailNow,
  setScheduledMailOutcomeReadiness,
} = await import("../src/main/ipc/methods/scheduled-mail");

const scheduleRequest: ScheduledMailScheduleRequest = {
  accountId: "person@example.com",
  draft,
  draftId: "draft-1",
  scheduledAt: 2000,
};

const finishRequest: ScheduledMailFinishEditRequest = {
  accountId: "person@example.com",
  action: { kind: "discard" },
  draftId: "draft-1",
};

describe("scheduled mail main IPC methods", () => {
  it.effect(
    "binds schedule and edit sessions to the invoking WebContents",
    () =>
      Effect.gen(function* verifiesOwnerBinding() {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The method reads only the mocked sender identity.
        const sender = { id: 73 } as IpcMainInvokeEvent["sender"];
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Electron invocation events cannot be constructed outside Electron.
        const event = { sender } as IpcMainInvokeEvent;
        state.bindOwner.mockReturnValue(73);
        state.schedule.mockReturnValue(Effect.succeed(summary));
        state.begin.mockReturnValue(Effect.succeed(session));
        state.finish.mockReturnValue(Effect.succeed({ kind: "finished" }));

        const replies = {
          begin: yield* beginScheduledMailEdit.handler(
            { accountId: summary.accountId, draftId: summary.draftId },
            event
          ),
          finish: yield* finishScheduledMailEdit.handler(finishRequest, event),
          schedule: yield* scheduleMail.handler(scheduleRequest, event),
        };

        expect(replies).toStrictEqual({
          begin: { data: session, ok: true },
          finish: { data: { kind: "finished" }, ok: true },
          schedule: { data: summary, ok: true },
        });

        expect(state.bindOwner).toHaveBeenCalledWith(sender);
        expect(state.schedule).toHaveBeenCalledWith(scheduleRequest, 73);
        expect(state.begin).toHaveBeenCalledWith(
          { accountId: summary.accountId, draftId: summary.draftId },
          73
        );
        expect(state.finish).toHaveBeenCalledWith(finishRequest, 73);
      })
  );

  it.effect("fails closed when an owner-bound method has no invoke event", () =>
    Effect.gen(function* rejectsMissingOwner() {
      expect(yield* scheduleMail.handler(scheduleRequest)).toStrictEqual({
        error: "Could not identify this window",
        ok: false,
      });
      expect(
        yield* beginScheduledMailEdit.handler({
          accountId: summary.accountId,
          draftId: summary.draftId,
        })
      ).toStrictEqual({
        error: "Could not identify this window",
        ok: false,
      });
      expect(
        yield* finishScheduledMailEdit.handler(finishRequest)
      ).toStrictEqual({
        error: "Could not identify this window",
        ok: false,
      });
      expect(
        yield* setScheduledMailOutcomeReadiness.handler(true)
      ).toStrictEqual({
        error: "Could not identify this window",
        ok: false,
      });
    })
  );

  it.effect("binds outcome readiness to the invoking WebContents", () =>
    Effect.gen(function* bindsOutcomeReadiness() {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The method forwards only the mocked sender identity.
      const sender = { id: 73 } as IpcMainInvokeEvent["sender"];
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Electron invocation events cannot be constructed outside Electron.
      const event = { sender } as IpcMainInvokeEvent;
      state.outcomeReadiness.mockReturnValue(Effect.void);

      expect(
        yield* setScheduledMailOutcomeReadiness.handler(true, event)
      ).toStrictEqual({ data: undefined, ok: true });
      expect(state.outcomeReadiness).toHaveBeenCalledExactlyOnceWith(
        sender,
        true
      );
    })
  );

  it.effect("keeps unopened mutations account-qualified at the boundary", () =>
    Effect.gen(function* verifiesAccountQualifiedMutations() {
      const key = {
        accountId: "other@example.com",
        draftId: "draft-1",
      };
      const sendRequest = { ...key, allowPossibleDuplicate: false };
      state.cancel.mockReturnValue(Effect.void);
      state.discard.mockReturnValue(Effect.void);
      state.sendNow.mockReturnValue(Effect.void);

      const replies = {
        cancel: yield* cancelScheduledMailToStash.handler(key),
        discard: yield* discardScheduledMail.handler(key),
        sendNow: yield* sendScheduledMailNow.handler(sendRequest),
      };

      expect(replies).toStrictEqual({
        cancel: { data: undefined, ok: true },
        discard: { data: undefined, ok: true },
        sendNow: { data: undefined, ok: true },
      });

      expect(state.cancel).toHaveBeenCalledWith(key);
      expect(state.discard).toHaveBeenCalledWith(key);
      expect(state.sendNow).toHaveBeenCalledWith(sendRequest);
    })
  );

  it.effect(
    "forwards account-scoped reads without widening their payloads",
    () =>
      Effect.gen(function* verifiesScopedReads() {
        const scope = { accountIds: ["person@example.com"] };
        const pageRequest = { ...scope, cursor: "opaque-cursor" };
        const page = { items: [summary], nextCursor: "next-cursor" };
        state.count.mockReturnValue(
          Effect.succeed({ count: 1, hasScheduledMail: true })
        );
        state.list.mockReturnValue(Effect.succeed(page));

        expect(
          yield* getScheduledMailAttentionCount.handler(scope)
        ).toStrictEqual({
          data: { count: 1, hasScheduledMail: true },
          ok: true,
        });
        expect(yield* listScheduledMailPage.handler(pageRequest)).toStrictEqual(
          {
            data: page,
            ok: true,
          }
        );
        expect(state.count).toHaveBeenCalledExactlyOnceWith(scope);
        expect(state.list).toHaveBeenCalledExactlyOnceWith(pageRequest);
      })
  );

  it("uses dedicated channels for every scheduled mail operation", () => {
    expect({
      attentionCount: getScheduledMailAttentionCount.channel,
      begin: beginScheduledMailEdit.channel,
      cancel: cancelScheduledMailToStash.channel,
      discard: discardScheduledMail.channel,
      finish: finishScheduledMailEdit.channel,
      listPage: listScheduledMailPage.channel,
      outcomeReadiness: setScheduledMailOutcomeReadiness.channel,
      schedule: scheduleMail.channel,
      sendNow: sendScheduledMailNow.channel,
    }).toStrictEqual({
      attentionCount: SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL,
      begin: SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL,
      cancel: SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL,
      discard: SCHEDULED_MAIL_DISCARD_CHANNEL,
      finish: SCHEDULED_MAIL_FINISH_EDIT_CHANNEL,
      listPage: SCHEDULED_MAIL_LIST_PAGE_CHANNEL,
      outcomeReadiness: SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL,
      schedule: SCHEDULED_MAIL_SCHEDULE_CHANNEL,
      sendNow: SCHEDULED_MAIL_SEND_NOW_CHANNEL,
    });
  });
});
