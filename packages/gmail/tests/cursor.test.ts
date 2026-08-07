// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolvePageRequest } from "../src/cursor";
import { AccountId, PageCursor } from "../src/models";

const encodePayload = (payload: unknown): PageCursor =>
  PageCursor.make(
    Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url")
  );

describe(resolvePageRequest, () => {
  it.effect("rejects a cursor whose page size exceeds the public limit", () =>
    Effect.gen(function* rejectsOversizedCursor() {
      const accountId = AccountId.make("account-a");
      const cursor = encodePayload({
        accountId,
        includeSpamTrash: false,
        labelIds: [],
        pageSize: 501,
        pageToken: "next-page",
        version: 1,
      });

      const error = yield* Effect.flip(
        resolvePageRequest({ accountId, cursor })
      );

      expect(error._tag).toBe("GmailValidationError");
    })
  );
});
