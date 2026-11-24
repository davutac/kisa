import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MailThreadQuickActions, {
  getMailThreadQuickActionsWidth,
} from "../src/renderer/src/components/mail/thread-quick-actions";
import { InMailList } from "./fixtures/mail-list";

describe("thread quick actions", () => {
  it("lets a lone action fill its column", () => {
    const markup = renderToString(
      <InMailList rowKey="ana@example.com:t1" withRow>
        <MailThreadQuickActions
          hotkeysEnabled={false}
          isRevealed
          isUnread
          name="Alpha"
          subject="Alpha"
          onToggleRead={() => {}}
        />
      </InMailList>
    );

    expect(markup).toContain("grid-rows-1");
    expect(markup).toContain("grid-cols-[60px]");
    expect(markup).toContain("w-15");
  });

  it("keeps two actions in one column", () => {
    expect(
      getMailThreadQuickActionsWidth({
        hasArchive: false,
        hasDestructive: true,
        hasSecondary: false,
      })
    ).toBe(48);

    const markup = renderToString(
      <InMailList rowKey="ana@example.com:t1" withRow>
        <MailThreadQuickActions
          hotkeysEnabled={false}
          isRevealed
          isUnread
          name="Alpha"
          subject="Alpha"
          onToggleRead={() => {}}
          onTrash={() => {}}
        />
      </InMailList>
    );

    expect(markup).toContain("grid-rows-2");
    expect(markup).toContain("grid-cols-[60px]");
    expect(markup).not.toContain("row-span-2");
  });

  it("places a third action in a second full-height column", () => {
    expect(
      getMailThreadQuickActionsWidth({
        hasArchive: false,
        hasDestructive: true,
        hasSecondary: true,
      })
    ).toBe(96);

    const markup = renderToString(
      <InMailList rowKey="ana@example.com:t1" withRow>
        <MailThreadQuickActions
          hotkeysEnabled={false}
          isRevealed
          isUnread
          name="Alpha"
          subject="Alpha"
          onDeleteForever={() => {}}
          onNotSpam={() => {}}
          onToggleRead={() => {}}
        />
      </InMailList>
    );

    expect(markup).toContain("grid-cols-[60px_48px]");
    expect(markup).toContain("w-27");
    expect(markup).toContain("row-span-2");
  });

  it("stands Read with Star, and Archive with Trash, in two columns", () => {
    expect(
      getMailThreadQuickActionsWidth({
        hasArchive: true,
        hasDestructive: true,
        hasSecondary: true,
      })
    ).toBe(96);

    const markup = renderToString(
      <InMailList rowKey="ana@example.com:t1" withRow>
        <MailThreadQuickActions
          hotkeysEnabled={false}
          isRevealed
          isStarred
          isUnread
          name="Alpha"
          subject="Alpha"
          onArchive={() => {}}
          onToggleRead={() => {}}
          onToggleStar={() => {}}
          onTrash={() => {}}
        />
      </InMailList>
    );

    expect({
      archive: markup.includes('aria-label="Archive Alpha"'),
      columns: markup.includes("grid-cols-[60px_48px]"),
      rows: markup.includes("grid-rows-2"),
      spans: markup.includes("row-span-2"),
      starPressed:
        /aria-label="Star Alpha"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Star Alpha"/u.test(
          markup
        ),
    }).toStrictEqual({
      archive: true,
      columns: true,
      rows: true,
      spans: false,
      starPressed: true,
    });
  });
});
