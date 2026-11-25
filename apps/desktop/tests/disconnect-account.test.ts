// Disconnecting removes an account's row and sealed password, then every
// per-account store, and asks no server to revoke anything. Stores other than
// the account row are replaced; each has its own tests.
// oxlint-disable vitest/prefer-import-in-mock
import { Effect } from "effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disconnectAccount } from "../src/main/auth/disconnect-account";
import { sendRendererEvent } from "../src/main/electron/renderer-events";
import { forgetMailEngineAccount } from "../src/main/mail/engine/mail-engine";
import { forgetAccountDrafts } from "../src/main/mail/mail-drafts";
import { forgetAccountScheduledMail } from "../src/main/mail/scheduled-mail";
import { forgetTrustedImageSenders } from "../src/main/mail/trusted-image-senders";
import { forgetAccountSettings } from "../src/main/settings/account-settings";
import { insertGmailAccount } from "./fixtures/mail-accounts";
import { connection, resetDatabase } from "./fixtures/mail-engine-harness";

vi.mock("electron", () => ({
  safeStorage: {
    decryptStringAsync: vi.fn<typeof Electron.safeStorage.decryptStringAsync>(
      (value) =>
        Promise.resolve({
          result: value.toString("utf-8"),
          shouldReEncrypt: false,
        })
    ),
    getSelectedStorageBackend: vi.fn<
      typeof Electron.safeStorage.getSelectedStorageBackend
    >(() => "gnome_libsecret"),
    isAsyncEncryptionAvailable: vi.fn<
      typeof Electron.safeStorage.isAsyncEncryptionAvailable
    >(() => Promise.resolve(true)),
  },
}));

vi.mock("../src/main/database", async () => {
  const { remoteDatabase } = await import("./fixtures/mail-engine-harness");
  const { Effect: MockEffect } = await import("effect");
  return {
    withDatabaseClient: <A>(
      run: (database: typeof remoteDatabase) => Promise<A>
    ) => MockEffect.promise(() => run(remoteDatabase)),
  };
});
vi.mock("../src/main/database-query", async () => {
  const { remoteDatabase } = await import("./fixtures/mail-engine-harness");
  const { Effect: MockEffect } = await import("effect");
  return {
    withDatabaseClient: <A>(
      run: (database: typeof remoteDatabase) => Promise<A>
    ) => MockEffect.promise(() => run(remoteDatabase)),
  };
});

// Each store forgets its own rows; here they only record that they were asked.
vi.mock("../src/main/mail/engine/mail-engine", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    forgetMailEngineAccount: vi.fn<() => Effect.Effect<void>>(
      () => MockEffect.void
    ),
  };
});
vi.mock("../src/main/mail/mail-drafts", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    forgetAccountDrafts: vi.fn<() => Effect.Effect<void>>(
      () => MockEffect.void
    ),
  };
});
vi.mock("../src/main/mail/scheduled-mail", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    forgetAccountScheduledMail: vi.fn<() => Effect.Effect<void>>(
      () => MockEffect.void
    ),
  };
});
vi.mock("../src/main/mail/trusted-image-senders", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    forgetTrustedImageSenders: vi.fn<() => Effect.Effect<void>>(
      () => MockEffect.void
    ),
  };
});
vi.mock("../src/main/settings/account-settings", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    forgetAccountSettings: vi.fn<() => Effect.Effect<void>>(
      () => MockEffect.void
    ),
  };
});
vi.mock("../src/main/templates/composer-templates", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    notifyComposerTemplatesChanged: vi.fn<() => Effect.Effect<void>>(
      () => MockEffect.void
    ),
  };
});
vi.mock("../src/main/mail/unread-badge", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    refreshUnreadBadge: vi.fn<() => Effect.Effect<void>>(() => MockEffect.void),
  };
});
vi.mock("../src/main/ai/thread-categorization", () => ({
  cancelThreadCategorization: vi.fn<() => void>(),
}));
vi.mock("../src/main/electron/renderer-events", () => ({
  sendRendererEvent: vi.fn<() => void>(),
}));
vi.mock("../src/main/window/create-window", () => ({
  getMainWindow: vi.fn<() => undefined>(),
}));

const accountIds = () =>
  connection.prepare("SELECT account_id FROM mail_accounts").all();

describe("disconnecting an account", () => {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 200 }))
  );

  beforeEach(() => {
    resetDatabase();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    insertGmailAccount(connection, "person@gmail.com");
    connection
      .prepare(
        `INSERT INTO mail_accounts (
          account_id, created_at, credentials, dialect, email,
          imap_host, imap_port, imap_security, provider, smtp_host, smtp_port,
          smtp_security, sort_order, updated_at, username
        ) VALUES ('name@icloud.com', 1, X'01', 'generic',
          'name@icloud.com', 'imap.mail.me.com', 993, 'tls', 'icloud',
          'smtp.mail.me.com', 587, 'starttls', 2, 1, 'name@icloud.com')`
      )
      .run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes an account and everything cached for it, revoking nothing", async () => {
    const remaining = await Effect.runPromise(
      disconnectAccount("name@icloud.com")
    );

    expect(accountIds()).toStrictEqual([{ account_id: "person@gmail.com" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const forget of [
      forgetMailEngineAccount,
      forgetAccountScheduledMail,
      forgetAccountSettings,
      forgetAccountDrafts,
      forgetTrustedImageSenders,
    ]) {
      expect(forget).toHaveBeenCalledWith("name@icloud.com");
    }
    expect(remaining.map(({ email }) => email)).toStrictEqual([
      "person@gmail.com",
    ]);
    expect(sendRendererEvent).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.anything(),
      { data: remaining, ok: true }
    );
  });

  it("removes a Gmail account without contacting Google", async () => {
    await Effect.runPromise(disconnectAccount("person@gmail.com"));

    expect(accountIds()).toStrictEqual([{ account_id: "name@icloud.com" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(forgetMailEngineAccount).toHaveBeenCalledWith("person@gmail.com");
  });
});
