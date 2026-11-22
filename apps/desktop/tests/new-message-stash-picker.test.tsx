import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StashItem } from "../src/renderer/src/components/mail/new-message-stash-picker";
import {
  Command,
  CommandList,
} from "../src/renderer/src/components/ui/command";
import { createNewMailDraft } from "../src/renderer/src/mail/mail-draft";

describe(StashItem, () => {
  it("offers a labeled discard button on each stash, apart from the row that pops it", () => {
    const markup = renderToString(
      <Command>
        <CommandList>
          <StashItem
            accountsCount={1}
            draft={{
              ...createNewMailDraft("one@example.com"),
              createdAt: 0,
              subject: "Lunch?",
              updatedAt: 0,
            }}
            onDiscard={vi.fn<() => void>()}
            onSelect={vi.fn<() => void>()}
          />
        </CommandList>
      </Command>
    );

    expect(markup).toContain('aria-label="Discard stash: Lunch?"');
    expect(markup).toContain('type="button"');
  });
});
