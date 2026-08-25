import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MailboxLabelBarView } from "../src/renderer/src/components/mail/mailbox-label-bar";

describe(MailboxLabelBarView, () => {
  it("renders an accessible horizontal multi-toggle label bar", () => {
    const markup = renderToString(
      <MailboxLabelBarView
        emptyLabel="No labels"
        items={[
          {
            accountIds: ["one@example.com", "two@example.com"],
            color: { background: "#16a766", text: "#ffffff" },
            key: "work",
            name: "Work",
          },
          {
            accountIds: ["one@example.com"],
            color: { background: "#0d3472", text: "#ffffff" },
            key: "travel",
            name: "Travel",
          },
        ]}
        onClearAll={() => {}}
        onValueChange={() => {}}
        selectedLabelNames={["work"]}
      />
    );

    expect(markup).toContain('aria-label="Filter threads by label"');
    expect(markup).toContain('aria-label="Clear label filters"');
    expect(markup).toContain('aria-label="Work, 2 accounts"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toMatch(
      /scroll-fade-x[^"]*overflow-x-auto[^"]*overscroll-x-contain/u
    );
  });

  it("keeps the fixed-height bar visible for an empty catalog", () => {
    const markup = renderToString(
      <MailboxLabelBarView
        emptyLabel="Loading labels…"
        items={[]}
        onClearAll={() => {}}
        onValueChange={() => {}}
        selectedLabelNames={[]}
      />
    );

    expect(markup).toContain("h-10");
    expect(markup).toContain("Loading labels…");
  });

  it("hides the clear control until a label is selected", () => {
    const markup = renderToString(
      <MailboxLabelBarView
        emptyLabel="No labels"
        items={[
          {
            accountIds: ["one@example.com"],
            key: "work",
            name: "Work",
          },
        ]}
        onClearAll={() => {}}
        onValueChange={() => {}}
        selectedLabelNames={[]}
      />
    );

    expect(markup).not.toContain('aria-label="Clear label filters"');
    expect(markup).toContain('aria-label="Work"');
  });

  it("uses default and secondary button variants for toggle state", () => {
    const markup = renderToString(
      <MailboxLabelBarView
        emptyLabel="No labels"
        items={[
          {
            accountIds: ["one@example.com"],
            color: { background: "#16a766", text: "#ffffff" },
            key: "work",
            name: "Work",
          },
          {
            accountIds: ["one@example.com"],
            color: { background: "#0d3472", text: "#ffffff" },
            key: "travel",
            name: "Travel",
          },
        ]}
        onClearAll={() => {}}
        onValueChange={() => {}}
        selectedLabelNames={["work"]}
      />
    );

    expect(markup).toContain("bg-primary text-primary-foreground");
    expect(markup).toContain("bg-secondary text-secondary-foreground");
    expect(markup).toContain("background-color:#16a766;color:#ffffff");
    expect(markup).toContain(
      "background-color:color-mix(in oklch, #0d3472 5%, transparent);color:var(--foreground)"
    );
  });
});
