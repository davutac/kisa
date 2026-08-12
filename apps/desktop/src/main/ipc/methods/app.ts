import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AppStartupReply,
  ThreadWindowOpenReply,
  ThreadWindowOpenRequest,
} from "../../../shared/ipc/app";
import {
  APP_OPEN_THREAD_WINDOW_CHANNEL,
  APP_START_CHANNEL,
} from "../../../shared/ipc/channels";
import { getAppStartupReply } from "../../app/startup";
import { openThreadWindow as openNativeThreadWindow } from "../../window/create-window";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

const THREAD_WINDOW_OPEN_ERROR_MESSAGE =
  "Could not open the conversation in a new window";

// oxlint-disable-next-line unicorn/throw-new-error
class ThreadWindowOpenError extends Schema.TaggedError<ThreadWindowOpenError>()(
  "ThreadWindowOpenError",
  { message: Schema.String }
) {}

export const startApp = makeIpcMethod({
  channel: APP_START_CHANNEL,
  handler: () => Effect.promise(getAppStartupReply),
  payload: Schema.Void,
  result: AppStartupReply,
});

export const openThreadWindow = makeIpcMethod({
  channel: APP_OPEN_THREAD_WINDOW_CHANNEL,
  handler: (request) =>
    toIpcReply(
      Effect.tryPromise({
        catch: () =>
          new ThreadWindowOpenError({
            message: THREAD_WINDOW_OPEN_ERROR_MESSAGE,
          }),
        try: async () => {
          await openNativeThreadWindow(request);
        },
      }),
      THREAD_WINDOW_OPEN_ERROR_MESSAGE
    ),
  payload: ThreadWindowOpenRequest,
  result: ThreadWindowOpenReply,
});
