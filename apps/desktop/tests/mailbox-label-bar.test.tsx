import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MailboxLabelBarView } from "../src/renderer/src/components/mail/mailbox-label-bar";
import { getMailboxLabelScrollEdges } from "../src/renderer/src/mail/use-mailbox-label-scroll";

const getButtonTag = (markup: string, label: string): string =>
  markup.match(
    new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`, "u")
  )?.[0] ?? "";

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

  it("hides the clear control and scroll arrows until they apply", () => {
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
    expect(markup).not.toContain("Scroll labels");
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

  it("shows scroll arrows after the labels and disables an exhausted direction", () => {
    const markup = renderToString(
      <MailboxLabelBarView
        canScrollBackward={false}
        canScrollForward
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

    expect(markup.indexOf("Scroll labels left")).toBeGreaterThan(
      markup.indexOf('aria-label="Work"')
    );
    expect(getButtonTag(markup, "Scroll labels left")).toContain(
      ' disabled=""'
    );
    expect(getButtonTag(markup, "Scroll labels right")).not.toContain(
      ' disabled=""'
    );
  });
});

describe(getMailboxLabelScrollEdges, () => {
  it.each([
    {
      expected: [false, false],
      name: "labels fit",
      scrollLeft: 0,
      scrollWidth: 400,
    },
    {
      expected: [false, true],
      name: "at the start",
      scrollLeft: 0,
      scrollWidth: 1000,
    },
    {
      expected: [true, false],
      name: "at the end",
      scrollLeft: 600,
      scrollWidth: 1000,
    },
    {
      expected: [false, true],
      name: "sub-pixel from the start",
      scrollLeft: 0.5,
      scrollWidth: 1000,
    },
    {
      expected: [true, false],
      name: "sub-pixel from the end",
      scrollLeft: 599.5,
      scrollWidth: 1000,
    },
  ])(
    "reports scrollable directions when $name",
    ({ expected, scrollLeft, scrollWidth }) => {
      const [canScrollBackward, canScrollForward] = expected;

      expect(
        getMailboxLabelScrollEdges({
          clientWidth: 400,
          scrollLeft,
          scrollWidth,
        })
      ).toStrictEqual({ canScrollBackward, canScrollForward });
    }
  );
});
