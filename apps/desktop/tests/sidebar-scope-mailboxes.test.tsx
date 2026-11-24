import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SidebarScopeMailboxes } from "../src/renderer/src/components/shell/sidebar/sidebar-scope-mailboxes";
import { getHotkeyAriaLabel } from "../src/renderer/src/hotkeys/commands";
import type { MailboxLabelItem } from "../src/renderer/src/mail/mailbox-labels";
import type { MailboxPlace } from "../src/renderer/src/mail/mailbox-place";

const getButtonTag = (markup: string, label: string): string =>
  markup.match(
    new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`, "u")
  )?.[0] ?? "";

const renderScope = (
  accountId: string,
  scopeLabel: string,
  {
    isLabelsExpanded = false,
    labels = [],
    mailbox = "spam",
  }: {
    readonly isLabelsExpanded?: boolean;
    readonly labels?: readonly MailboxLabelItem[];
    readonly mailbox?: MailboxPlace;
  } = {}
): string =>
  renderToString(
    <SidebarScopeMailboxes
      accountId={accountId}
      id="mailboxes"
      isLabelsExpanded={isLabelsExpanded}
      labels={labels}
      onLabelsExpandedChange={vi.fn<() => void>()}
      onSelect={vi.fn<() => void>()}
      scopeAccountIds={["one@example.com"]}
      scopeLabel={scopeLabel}
      view={{
        currentPath: "/",
        mailbox,
        selectedAccountId: "one@example.com",
      }}
    />
  );

const LABELS: readonly MailboxLabelItem[] = [
  { accountIds: ["one@example.com"], key: "work", name: "Work" },
  {
    accountIds: ["one@example.com"],
    key: "work/clients",
    name: "Work/Clients",
  },
];

describe(SidebarScopeMailboxes, () => {
  it("marks the scope's current mailbox and advertises the mailbox shortcuts", () => {
    const markup = renderScope("one@example.com", "one@example.com");
    const spam = getButtonTag(markup, "Spam, one@example.com");

    expect(spam).toContain('aria-current="page"');
    expect(spam).toContain(
      `aria-keyshortcuts="${getHotkeyAriaLabel("app.toggleSpam")}"`
    );
    expect(getButtonTag(markup, "Sent, one@example.com")).not.toContain(
      "aria-current"
    );
    expect(markup).not.toContain("Inbox");
  });

  it("opens Starred from a row of its own, without a shortcut", () => {
    const markup = renderScope("one@example.com", "one@example.com", {
      mailbox: "starred",
    });
    const starred = getButtonTag(markup, "Starred, one@example.com");

    expect(starred).toContain('aria-current="page"');
    expect(starred).not.toContain("aria-keyshortcuts");
  });

  it("leaves the shortcuts to the current scope's rows", () => {
    const markup = renderScope("two@example.com", "two@example.com");

    expect(getButtonTag(markup, "Spam, two@example.com")).not.toContain(
      "aria-current"
    );
    expect(markup).not.toContain("aria-keyshortcuts");
  });

  it("shows no Labels row for a scope without labels", () => {
    expect(renderScope("one@example.com", "one@example.com")).not.toContain(
      "Labels"
    );
  });

  it("holds the labels behind a Labels row that stands in for a hidden label", () => {
    const markup = renderScope("one@example.com", "one@example.com", {
      labels: LABELS,
      mailbox: { label: "Work/Clients" },
    });
    const labelsRow = getButtonTag(markup, "Labels, one@example.com");

    expect(labelsRow).toContain('aria-expanded="false"');
    expect(labelsRow).toContain('aria-current="page"');
    expect(markup).not.toContain("Work/Clients, one@example.com");
  });

  it("nests shown labels and marks the one on screen", () => {
    const markup = renderScope("one@example.com", "one@example.com", {
      isLabelsExpanded: true,
      labels: LABELS,
      mailbox: { label: "work/clients" },
    });

    expect(getButtonTag(markup, "Labels, one@example.com")).not.toContain(
      "aria-current"
    );
    expect(getButtonTag(markup, "Work, one@example.com")).not.toContain(
      "aria-current"
    );
    expect(getButtonTag(markup, "Work/Clients, one@example.com")).toContain(
      'aria-current="page"'
    );
    expect(markup).toContain(">Clients</span>");
  });

  it("puts a favorite star beside each label row", () => {
    const markup = renderScope("one@example.com", "one@example.com", {
      isLabelsExpanded: true,
      labels: LABELS,
    });
    const star = getButtonTag(markup, "Favorite Work/Clients");

    expect(star).toContain('aria-pressed="false"');
    // A sibling of the row's button, never nested inside it.
    expect(markup).not.toMatch(/<button(?:(?!<\/button>).)*<button/su);
  });
});
