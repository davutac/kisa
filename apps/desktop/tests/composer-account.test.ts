import { describe, expect, it } from "vitest";

import { getInitialComposerAccountId } from "../src/renderer/src/mail/composer-account";

const onlyAccount = [{ email: "me@example.com" }];
const multipleAccounts = [
  { email: "one@example.com" },
  { email: "two@example.com" },
];

describe(getInitialComposerAccountId, () => {
  it("selects the only connected account by default", () => {
    expect(getInitialComposerAccountId(onlyAccount, null)).toBe(
      "me@example.com"
    );
  });

  it("keeps a known initial account when multiple accounts are connected", () => {
    expect(
      getInitialComposerAccountId(multipleAccounts, "two@example.com")
    ).toBe("two@example.com");
  });

  it("requires a choice when multiple accounts have no known initial account", () => {
    expect(getInitialComposerAccountId(multipleAccounts, null)).toBe("");
  });

  it("falls back to the only account when the initial account is stale", () => {
    expect(
      getInitialComposerAccountId(onlyAccount, "removed@example.com")
    ).toBe("me@example.com");
  });
});
