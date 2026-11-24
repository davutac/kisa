// An account's sender name: main saves it to the account row, which sending
// reads each time, and tells every window. The request schema keeps control
// characters, which would break the From header, out of main.
// oxlint-disable vitest/prefer-import-in-mock
import { Effect, Exit, Schema } from "effect";
import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateAccountName } from "../src/main/auth/accounts";
import { sendRendererEvent } from "../src/main/electron/renderer-events";
import { AccountNameUpdateRequest } from "../src/shared/ipc/accounts";
import { MAX_DISPLAY_NAME_LENGTH } from "../src/shared/mail-account-presets";
import { insertGmailAccount } from "./fixtures/mail-accounts";
import { connection, resetDatabase } from "./fixtures/mail-engine-harness";

vi.mock("electron", () => ({
  safeStorage: {
    getSelectedStorageBackend: vi.fn<
      typeof Electron.safeStorage.getSelectedStorageBackend
    >(() => "gnome_libsecret"),
    isAsyncEncryptionAvailable: vi.fn<
      typeof Electron.safeStorage.isAsyncEncryptionAvailable
    >(() => Promise.resolve(true)),
  },
}));
vi.mock("../src/main/database-query", async () => {
  const { remoteDatabase } = await import("./fixtures/mail-engine-harness");
  const { Effect: MockEffect } = await import("effect");
  return {
    withDatabaseClient: <A>(
      run: (database: typeof remoteDatabase) => Promise<A>
    ) => MockEffect.promise(() => run(remoteDatabase)),
  };
});
vi.mock("../src/main/electron/renderer-events", () => ({
  sendRendererEvent: vi.fn<() => void>(),
}));

const storedNames = () =>
  connection
    .prepare(
      "SELECT email, display_name AS name FROM mail_accounts ORDER BY email"
    )
    .all();

describe("saving an account's sender name", () => {
  beforeEach(() => {
    resetDatabase();
    vi.clearAllMocks();
    insertGmailAccount(connection, "ana@gmail.com", { sortOrder: 1 });
    insertGmailAccount(connection, "bo@gmail.com", { sortOrder: 2 });
  });

  it("saves it trimmed on that account alone, and tells every window", async () => {
    const accounts = await Effect.runPromise(
      updateAccountName("ana@gmail.com", "  Ana Lima ")
    );

    expect({
      accounts,
      stored: storedNames(),
    }).toStrictEqual({
      accounts: [
        { displayName: "Ana Lima", email: "ana@gmail.com", provider: "gmail" },
        { displayName: undefined, email: "bo@gmail.com", provider: "gmail" },
      ],
      stored: [
        { email: "ana@gmail.com", name: "Ana Lima" },
        { email: "bo@gmail.com", name: null },
      ],
    });
    expect(sendRendererEvent).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.anything(),
      { data: accounts, ok: true }
    );
  });

  it("clears it when blank, so mail goes out with the bare address", async () => {
    await Effect.runPromise(updateAccountName("ana@gmail.com", "Ana"));
    const accounts = await Effect.runPromise(
      updateAccountName("ana@gmail.com", "   ")
    );

    expect({
      name: accounts[0]?.displayName,
      stored: storedNames()[0],
    }).toStrictEqual({
      name: undefined,
      stored: { email: "ana@gmail.com", name: null },
    });
  });

  it("refuses an account that is no longer connected, telling no window", async () => {
    const exit = await Effect.runPromiseExit(
      updateAccountName("gone@gmail.com", "Gone")
    );

    expect({
      failed: Exit.isFailure(exit),
      message: Exit.isFailure(exit) ? String(exit.cause) : null,
      notified: vi.mocked(sendRendererEvent).mock.calls.length,
    }).toStrictEqual({
      failed: true,
      message: expect.stringContaining("That account is no longer connected"),
      notified: 0,
    });
  });
});

const decodes = (name: string): boolean =>
  Exit.isSuccess(
    Schema.decodeUnknownExit(AccountNameUpdateRequest)({
      email: "ana@gmail.com",
      name,
    })
  );

describe("the sender name request", () => {
  it("takes a name or a blank, and refuses what would break the From header", () => {
    expect({
      blank: decodes(""),
      lineBreak: decodes("Ana\r\nBcc: x@example.com"),
      name: decodes("Ana Lima"),
      tab: decodes("Ana\tLima"),
      tooLong: decodes("a".repeat(MAX_DISPLAY_NAME_LENGTH + 1)),
    }).toStrictEqual({
      blank: true,
      lineBreak: false,
      name: true,
      tab: false,
      tooLong: false,
    });
  });
});
