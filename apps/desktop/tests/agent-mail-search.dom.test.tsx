import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import MailSearchCommandBar from "../src/renderer/src/components/mail/mail-search/mail-search-command-bar";
import { Button } from "../src/renderer/src/components/ui/button";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import { createMailSearchQuery } from "../src/renderer/src/mail/search-query";
import type { SearchQuery } from "../src/renderer/src/mail/search-query";

const agent = createAgent();

const onPage = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

const SearchBar = ({
  onShowAll,
}: {
  readonly onShowAll: (query: SearchQuery) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <AppHotkeysProvider>
      <Button onClick={() => setOpen(true)} type="button">
        Open search
      </Button>
      <MailSearchCommandBar
        initialQuery={createMailSearchQuery()}
        onOpenChange={setOpen}
        onOpenThread={vi.fn<() => void>()}
        onShowAll={onShowAll}
        open={open}
      />
    </AppHotkeysProvider>
  );
};

describe("mail search, for an agent", () => {
  it("names every control once, and an agent can filter, search and show all results", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn<(query: SearchQuery) => void>();
    render(<SearchBar onShowAll={onShowAll} />);
    await user.click(screen.getByRole("button", { name: "Open search" }));
    await act(settle);

    const typed = await agent.act({
      steps: [
        {
          action: "setQuery",
          args: ["has:attachment invoice"],
          ref: "Search mail",
        },
      ],
    });
    await act(settle);
    const entries = onPage();
    const labels = entries.map((entry) => entry.label);
    const showAll = entries
      .find((entry) => entry.component === "command")
      ?.items?.find((item) => item.label.startsWith("Show all results"));
    expect({
      duplicates: labels.filter(
        (label, index) => labels.indexOf(label) !== index
      ),
      ok: typed.ok,
      unnamed: entries
        .filter((entry) => !entry.label)
        .map((entry) => `${entry.component} ${entry.ref}`),
    }).toStrictEqual({ duplicates: [], ok: true, unnamed: [] });
    expect(labels).toStrictEqual(
      expect.arrayContaining([
        "Find mail",
        "Search mail",
        "Remove has:attachment filter",
      ])
    );
    expect(showAll?.label).toBe("Show all results has:attachment invoice");

    const shown = await agent.act({
      steps: [{ action: "run", args: [showAll?.value], ref: "Search mail" }],
    });
    expect({ ok: shown.ok, queries: onShowAll.mock.calls }).toStrictEqual({
      ok: true,
      queries: [
        [{ filters: [{ field: "has", value: "attachment" }], text: "invoice" }],
      ],
    });
  });

  it("lets an agent take a filter pill back off", async () => {
    const user = userEvent.setup();
    render(<SearchBar onShowAll={vi.fn<(query: SearchQuery) => void>()} />);
    await user.click(screen.getByRole("button", { name: "Open search" }));
    await act(settle);
    await user.keyboard("from:ana@example.com has:attachment ");
    await act(settle);
    expect(
      screen
        .getAllByRole("button", { name: /^Remove /u })
        .map((button) => button.getAttribute("aria-label"))
    ).toStrictEqual([
      "Remove from:ana@example.com filter",
      "Remove has:attachment filter",
    ]);

    const removed = await agent.act({
      steps: [{ action: "press", ref: "Remove from:ana@example.com filter" }],
    });
    await act(settle);
    expect({
      ok: removed.ok,
      pills: screen
        .getAllByRole("button", { name: /^Remove /u })
        .map((button) => button.getAttribute("aria-label")),
    }).toStrictEqual({ ok: true, pills: ["Remove has:attachment filter"] });
  });
});
