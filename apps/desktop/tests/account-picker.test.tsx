import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AccountPicker from "../src/renderer/src/components/accounts/account-picker";

const accounts = [
  {
    displayName: "First Account",
    email: "first@example.com",
    scopes: [],
  },
  {
    email: "second@example.com",
    scopes: [],
  },
];

describe("account picker", () => {
  it("renders required account choices through its shared interface", () => {
    const markup = renderToString(
      <AccountPicker
        accounts={accounts}
        onSelect={() => {}}
        selectedAccountId="first@example.com"
      />
    );

    expect(markup).toContain('aria-label="From account"');
    expect(markup).toContain("Select first@example.com");
    expect(markup).toContain("Select second@example.com");
    expect(markup).not.toContain("max-w-48");
    expect(markup).toMatch(/min-w-7 shrink.*min-w-0 overflow-hidden/u);
  });

  it("renders a selected null option for inheriting an account", () => {
    const markup = renderToString(
      <AccountPicker
        accounts={accounts}
        nullOption={{
          description: "Use the account selected later",
          label: "Keep current account",
        }}
        onSelect={() => {}}
        selectedAccountId={null}
      />
    );

    expect(markup).toContain("Keep current account");
    expect(markup).toContain('aria-pressed="true"');
  });
});
