import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SettingsAccountReindexRow from "../src/renderer/src/components/settings/settings-account-reindex-row";
import type {
  AccountsApi,
  MailApi,
} from "../src/renderer/src/platform/desktop";

const progress = vi.hoisted(() => ({ status: "complete" }));

vi.mock(import("@/mail/use-mail-index-progress"), () => ({
  useAccountIndexProgress: (() => ({
    accountId: "me@example.org",
    indexedMessages: 0,
    indexedThreads: 0,
    status: progress.status,
  })) as never,
}));

vi.mock(import("@/components/confirm-dialog"), async (importOriginal) => ({
  ...(await importOriginal()),
  useConfirm: () => () => Promise.resolve(false),
}));

const render = (status: string): string => {
  progress.status = status;
  return renderToString(
    <SettingsAccountReindexRow
      accountId="me@example.org"
      accountsApi={{} as AccountsApi}
      mailApi={{} as MailApi}
    />
  );
};

describe("the account's Mail sync row", () => {
  it("offers to sign in again while the account's sign-in is refused", () => {
    expect(render("paused")).toContain("Sign in again");
    expect(render("paused")).toContain("Sync now");
  });

  it.each(["complete", "running", "failed"])(
    "offers no sign-in while the status is %s",
    (status) => {
      expect(render(status)).not.toContain("Sign in again");
    }
  );
});
