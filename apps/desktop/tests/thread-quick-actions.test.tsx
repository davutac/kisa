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
    expect(getMailThreadQuickActionsWidth(false, true)).toBe(48);

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
    expect(getMailThreadQuickActionsWidth(true, true)).toBe(96);

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
});
