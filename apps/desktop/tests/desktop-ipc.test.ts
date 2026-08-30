// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";

import * as DesktopIpc from "../src/main/ipc/desktop-ipc";
import { DesktopIpcRegistrationError } from "../src/main/ipc/desktop-ipc-registration-error";
import {
  AiThreadCategorizationReply,
  AiThreadCategorizationRequest,
} from "../src/shared/ipc/ai";
import {
  AI_CATEGORIZE_THREAD_CHANNEL,
  MAIL_CREATE_LABEL_CHANNEL,
  MAIL_DELETE_LABEL_CHANNEL,
  MAIL_SET_THREAD_LABEL_CHANNEL,
  MAIL_UPDATE_LABEL_CHANNEL,
} from "../src/shared/ipc/channels";
import {
  GmailLabelCreateReply,
  GmailLabelCreateRequest,
  GmailLabelDeleteReply,
  GmailLabelDeleteRequest,
  GmailLabelUpdateReply,
  GmailLabelUpdateRequest,
  GmailThreadLabelRequest,
  GmailThreadMutationReply,
} from "../src/shared/ipc/mail";

const createIpcMain = () => {
  const listeners = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  const removedChannels: string[] = [];

  return {
    ipcMain: {
      handle: (
        channel: string,
        listener: DesktopIpc.DesktopIpcHandleListener
      ) => {
        listeners.set(channel, listener);
      },
      removeHandler: (channel: string) => {
        listeners.delete(channel);
        removedChannels.push(channel);
      },
    },
    listeners,
    removedChannels,
  };
};

describe(DesktopIpc.DesktopIpc, () => {
  it.effect(
    "decodes payloads, encodes results, and unregisters with scope",
    () =>
      Effect.gen(function* verifiesIpcLifecycle() {
        const { ipcMain, listeners, removedChannels } = createIpcMain();
        const ipc = DesktopIpc.make(ipcMain);
        const method = DesktopIpc.makeIpcMethod({
          channel: "desktop:test:double",
          handler: ({ value }, event) =>
            Effect.sync(() => {
              expect(event?.sender.id).toBe(7);
              return { value: value * 2 };
            }),
          payload: Schema.Struct({ value: Schema.Finite }),
          result: Schema.Struct({ value: Schema.Finite }),
        });
        let encodedResult: unknown;

        yield* Effect.scoped(
          Effect.gen(function* registersAndInvokes() {
            yield* ipc.handle(method);
            const listener = listeners.get(method.channel);

            expect(listener).toBeDefined();
            encodedResult = yield* Effect.promise(() =>
              Promise.resolve(
                listener?.({ sender: { id: 7 } } as IpcMainInvokeEvent, {
                  value: 21,
                })
              )
            );
            expect(encodedResult).toStrictEqual({ value: 42 });
          })
        );

        expect(listeners.has(method.channel)).toBeFalsy();
        expect(removedChannels).toStrictEqual([method.channel, method.channel]);
      })
  );

  it.effect("rejects payloads that do not match the method schema", () =>
    Effect.gen(function* rejectsInvalidPayload() {
      const method = DesktopIpc.makeIpcMethod({
        channel: "desktop:test:validated",
        handler: ({ value }) => Effect.succeed(value),
        payload: Schema.Struct({ value: Schema.Finite }),
        result: Schema.Finite,
      });

      const exit = yield* Effect.exit(method.handler({ value: "invalid" }));

      expect(exit._tag).toBe("Failure");
    })
  );

  it.effect("decodes binary payloads as Uint8Array values", () =>
    Effect.gen(function* decodesBinaryPayload() {
      const method = DesktopIpc.makeIpcMethod({
        channel: "desktop:test:binary",
        handler: ({ bytes }) => Effect.succeed([...bytes]),
        payload: Schema.Struct({ bytes: Schema.Uint8Array }),
        result: Schema.Array(Schema.Finite),
      });

      const result = yield* method.handler({
        bytes: new Uint8Array([1, 2, 3]),
      });

      expect(result).toStrictEqual([1, 2, 3]);
    })
  );

  it.effect("validates and encodes the thread label mutation boundary", () =>
    Effect.gen(function* validatesThreadLabelMutation() {
      const requests: unknown[] = [];
      const method = DesktopIpc.makeIpcMethod({
        channel: MAIL_SET_THREAD_LABEL_CHANNEL,
        handler: (request) =>
          Effect.sync(() => {
            requests.push(request);
            return { data: undefined, ok: true as const };
          }),
        payload: GmailThreadLabelRequest,
        result: GmailThreadMutationReply,
      });
      const request = {
        accountId: "person@example.com",
        applied: true,
        labelId: "Label_1",
        threadId: "thread-1",
      };

      expect(method.channel).toBe("desktop:mail:set-thread-label");
      expect(yield* method.handler(request)).toStrictEqual({
        data: undefined,
        ok: true,
      });
      expect(requests).toStrictEqual([request]);
      expect(
        (yield* Effect.exit(method.handler({ ...request, labelId: "" })))._tag
      ).toBe("Failure");
    })
  );

  it.effect("validates the manual categorization boundary", () =>
    Effect.gen(function* validatesManualCategorization() {
      const requests: unknown[] = [];
      const method = DesktopIpc.makeIpcMethod({
        channel: AI_CATEGORIZE_THREAD_CHANNEL,
        handler: (request) =>
          Effect.sync(() => {
            requests.push(request);
            return { data: { labelIds: ["Label_1"] }, ok: true as const };
          }),
        payload: AiThreadCategorizationRequest,
        result: AiThreadCategorizationReply,
      });
      const request = {
        accountId: "person@example.com",
        threadId: "thread-1",
      };

      expect(method.channel).toBe("desktop:ai:categorize-thread");
      expect(yield* method.handler(request)).toStrictEqual({
        data: { labelIds: ["Label_1"] },
        ok: true,
      });
      expect(requests).toStrictEqual([request]);
      expect(
        (yield* Effect.exit(method.handler({ ...request, threadId: "" })))._tag
      ).toBe("Failure");
    })
  );

  it.effect("validates label definition mutation boundaries", () =>
    Effect.gen(function* validatesLabelDefinitionMutations() {
      const create = DesktopIpc.makeIpcMethod({
        channel: MAIL_CREATE_LABEL_CHANNEL,
        handler: (request) =>
          Effect.succeed({
            data: {
              color: request.color,
              id: "Label_1",
              name: request.name,
              threadCount: 0,
              type: "user",
            },
            ok: true as const,
          }),
        payload: GmailLabelCreateRequest,
        result: GmailLabelCreateReply,
      });
      const remove = DesktopIpc.makeIpcMethod({
        channel: MAIL_DELETE_LABEL_CHANNEL,
        handler: () => Effect.succeed({ data: undefined, ok: true as const }),
        payload: GmailLabelDeleteRequest,
        result: GmailLabelDeleteReply,
      });
      const update = DesktopIpc.makeIpcMethod({
        channel: MAIL_UPDATE_LABEL_CHANNEL,
        handler: (request) =>
          Effect.succeed({
            data: {
              color: request.color,
              id: request.labelId,
              name: request.name,
              type: "user",
            },
            ok: true as const,
          }),
        payload: GmailLabelUpdateRequest,
        result: GmailLabelUpdateReply,
      });

      expect(
        yield* create.handler({
          accountId: "person@example.com",
          color: { background: "#fef1d1", text: "#0d3472" },
          name: "Projects/Kisa",
        })
      ).toStrictEqual({
        data: {
          color: { background: "#fef1d1", text: "#0d3472" },
          id: "Label_1",
          name: "Projects/Kisa",
          threadCount: 0,
          type: "user",
        },
        ok: true,
      });
      expect(
        yield* remove.handler({
          accountId: "person@example.com",
          labelId: "Label_1",
        })
      ).toStrictEqual({ data: undefined, ok: true });
      expect(
        yield* update.handler({
          accountId: "person@example.com",
          color: { background: "#4a86e8", text: "#ffffff" },
          labelId: "Label_1",
          name: "Projects/Kisa 2",
        })
      ).toStrictEqual({
        data: {
          color: { background: "#4a86e8", text: "#ffffff" },
          id: "Label_1",
          name: "Projects/Kisa 2",
          type: "user",
        },
        ok: true,
      });
      const invalid = yield* Effect.all([
        Effect.exit(
          create.handler({ accountId: "person@example.com", name: "" })
        ),
        Effect.exit(
          create.handler({
            accountId: "person@example.com",
            color: { background: "#123456", text: "#ffffff" },
            name: "Projects/Kisa",
          })
        ),
        Effect.exit(
          remove.handler({ accountId: "person@example.com", labelId: "" })
        ),
        Effect.exit(
          update.handler({
            accountId: "person@example.com",
            labelId: "Label_1",
            name: "",
          })
        ),
      ]);

      expect(invalid.map((exit) => exit._tag)).toStrictEqual([
        "Failure",
        "Failure",
        "Failure",
        "Failure",
      ]);
    })
  );

  it.effect("preserves handler registration failures", () =>
    Effect.gen(function* preservesRegistrationFailure() {
      const cause = new Error("registration failed");
      const ipc = DesktopIpc.make({
        handle: () => {
          throw cause;
        },
        removeHandler: () => {},
      });
      const method: DesktopIpc.DesktopIpcMethod<never, never> = {
        channel: "desktop:test:failure",
        handler: () => Effect.void,
      };

      const error = yield* Effect.flip(Effect.scoped(ipc.handle(method)));

      expect(error).toBeInstanceOf(DesktopIpcRegistrationError);
      expect(error.channel).toBe(method.channel);
      expect(error.cause).toBe(cause);
    })
  );
});
