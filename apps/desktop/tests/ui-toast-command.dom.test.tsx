import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { setPlatform, settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MailSearchCommandBar from "../src/renderer/src/components/mail/mail-search/mail-search-command-bar";
import NewMessageStashPicker, {
  StashItem,
} from "../src/renderer/src/components/mail/new-message-stash-picker";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSearch,
} from "../src/renderer/src/components/ui/command";
import { toast, Toaster } from "../src/renderer/src/components/ui/toast";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import { createNewMailDraft } from "../src/renderer/src/mail/mail-draft";
import { createMailSearchQuery } from "../src/renderer/src/mail/search-query";
import type { SearchQuery } from "../src/renderer/src/mail/search-query";
import { TemplateVariablePicker } from "../src/renderer/src/templates/template-variable-picker";
import {
  UndoProvider,
  useOfferUndo,
} from "../src/renderer/src/undo/undo-provider";
import type {
  UndoOffer,
  UndoOutcome,
} from "../src/renderer/src/undo/undo-provider";
import type { MailDraft } from "../src/shared/ipc/mail";

const agent = createAgent();
const MOD_Z = "{Control>}z{/Control}";

// The title is matched in the toast, not in ui-sdk's announcement of it.
const getToast = (title: string): HTMLElement => {
  const element = screen
    .getAllByText(title)
    .map((text) => text.closest<HTMLElement>("[data-slot=toast]"))
    .find((toastElement) => toastElement !== null);
  if (element === undefined || element === null) {
    throw new Error(`No toast titled ${title}`);
  }
  return element;
};

const highlighted = () =>
  screen
    .getAllByRole("option")
    .find((option) => option.dataset.highlighted !== undefined);

const OfferButton = ({ offer }: { readonly offer: UndoOffer }) => {
  const offerUndo = useOfferUndo();
  return (
    <button onClick={() => offerUndo(offer)} type="button">
      Trash
    </button>
  );
};

const renderUndo = (
  extra: Pick<UndoOffer, "description" | "durationMs"> = {}
) => {
  const outcome = Promise.withResolvers<UndoOutcome>();
  const undo = vi.fn<() => Promise<void>>(() => Promise.resolve());
  render(
    <AppHotkeysProvider>
      <UndoProvider>
        <OfferButton
          offer={{
            ...extra,
            message: "Moved to Trash",
            outcome: outcome.promise,
            undo,
            undoneMessage: "Moved back to Inbox",
          }}
        />
        <Toaster />
      </UndoProvider>
    </AppHotkeysProvider>
  );
  return { outcome, undo };
};

const draftWith = (id: string, subject: string, body: string): MailDraft => {
  const draft = createNewMailDraft("one@example.com");
  return {
    ...draft,
    body: { ...draft.body, text: body },
    createdAt: 0,
    id,
    subject,
    updatedAt: 0,
  };
};

const STASHES = [
  draftWith("stash-lunch", "Lunch?", "Can we meet at noon"),
  draftWith("stash-numbers", "Quarterly numbers", "I attached the invoice"),
  draftWith("stash-trip", "Trip plans", "Flights are booked"),
];

const StashList = ({
  onDiscard = vi.fn<(id: string) => void>(),
  onSelect = vi.fn<(id: string) => void>(),
}: {
  readonly onDiscard?: (id: string) => void;
  readonly onSelect?: (id: string) => void;
}) => (
  <Command>
    <CommandSearch>
      <CommandInput aria-label="Search stashes" />
    </CommandSearch>
    <CommandEmpty>No stash answers to that name.</CommandEmpty>
    <CommandList>
      <CommandGroup>
        {STASHES.map((draft) => (
          <StashItem
            accountsCount={1}
            draft={draft}
            key={draft.id}
            onDiscard={() => onDiscard(draft.id)}
            onSelect={() => onSelect(draft.id)}
          />
        ))}
      </CommandGroup>
    </CommandList>
  </Command>
);

const SearchBar = ({
  onShowAll = vi.fn<(query: SearchQuery) => void>(),
}: {
  readonly onShowAll?: (query: SearchQuery) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <AppHotkeysProvider>
      <button onClick={() => setOpen(true)} type="button">
        Open search
      </button>
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

const openSearchBar = async (
  user: ReturnType<typeof userEvent.setup>,
  text: string
): Promise<void> => {
  await user.click(screen.getByRole("button", { name: "Open search" }));
  await act(settle);
  if (text !== "") {
    await user.keyboard(text);
  }
  await act(settle);
};

describe("toasts", () => {
  beforeEach(() => {
    setPlatform("other");
  });

  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it("shows each toast's title, description and type in the Notifications region", async () => {
    render(<Toaster />);
    act(() => {
      toast("Sending…");
      toast.success("Label added");
      toast.error("Could not move", { description: "Please try again." });
    });
    await act(settle);

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(within(region).getByText("Please try again.")).toBeTruthy();
    expect(getToast("Label added").dataset.type).toBe("success");
    expect(getToast("Could not move").dataset.type).toBe("error");
    expect(getToast("Sending…").dataset.type).toBe("default");
  });

  it("leads a typed toast with its icon, and a plain one with none", async () => {
    render(<Toaster />);
    act(() => {
      toast("Sending…");
      toast.success("Label added");
      toast.error("Could not move");
    });
    await act(settle);

    expect(
      getToast("Label added").querySelector(":scope > svg")
    ).not.toBeNull();
    expect(
      getToast("Could not move").querySelector(":scope > svg")
    ).not.toBeNull();
    expect(getToast("Sending…").querySelector(":scope > svg")).toBeNull();
  });

  it("dismisses one toast by its id", async () => {
    render(<Toaster />);
    let id = "";
    act(() => {
      id = toast("Sending…");
      toast.success("Sent");
    });
    await act(settle);

    act(() => {
      toast.dismiss(id);
    });
    await act(settle);

    expect(screen.queryByText("Sending…")).toBeNull();
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  it("dismisses only a focused toast on Escape, keeping it from the app's Escape commands", async () => {
    const user = userEvent.setup();
    const onDocumentKey = vi.fn<(key: string) => void>();
    const listener = (event: KeyboardEvent) => onDocumentKey(event.key);
    document.addEventListener("keydown", listener);
    render(<Toaster />);
    act(() => {
      toast.success("Label added");
    });
    await act(settle);

    getToast("Label added").focus();
    await user.keyboard("{Escape}");
    await act(settle);
    document.removeEventListener("keydown", listener);

    expect(screen.queryByText("Label added")).toBeNull();
    expect(onDocumentKey).not.toHaveBeenCalled();
  });

  it("runs Undo once from its button and closes the toast", async () => {
    const user = userEvent.setup();
    const { outcome, undo } = renderUndo();

    await user.click(screen.getByRole("button", { name: "Trash" }));
    await user.click(
      within(getToast("Moved to Trash")).getByRole("button", { name: "Undo" })
    );
    await user.keyboard(MOD_Z);
    await act(async () => {
      outcome.resolve({ kind: "confirmed" });
      await settle();
    });

    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Moved to Trash")).toBeNull();
    expect(screen.getByText("Moved back to Inbox")).toBeTruthy();
  });

  it("runs Undo once from Mod+Z while its toast is up", async () => {
    const user = userEvent.setup();
    const { undo } = renderUndo();

    await user.click(screen.getByRole("button", { name: "Trash" }));
    await user.keyboard(MOD_Z);
    await user.keyboard(MOD_Z);

    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Moved to Trash")).toBeNull();
  });

  it("turns a refused action's toast into the error, without Undo", async () => {
    const user = userEvent.setup();
    const { outcome, undo } = renderUndo();

    await user.click(screen.getByRole("button", { name: "Trash" }));
    await act(async () => {
      outcome.resolve({ kind: "failed", message: "Could not move to Trash" });
      await settle();
    });

    const error = getToast("Could not move to Trash");
    expect(error.dataset.type).toBe("error");
    expect(within(error).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText("Moved to Trash")).toBeNull();
    await user.keyboard(MOD_Z);
    expect(undo).not.toHaveBeenCalled();
  });

  it("keeps Undo, for its full eight seconds, when part of an action went through", async () => {
    const user = userEvent.setup();
    const { outcome, undo } = renderUndo();

    await user.click(screen.getByRole("button", { name: "Trash" }));
    await act(async () => {
      outcome.resolve({
        description: "1 of 3 conversations could not be updated.",
        kind: "partial",
        message: "Could not move every conversation",
      });
      await settle();
    });

    const partial = getToast("Could not move every conversation");
    expect(
      within(partial).getByText("1 of 3 conversations could not be updated.")
    ).toBeTruthy();
    expect(toast.toasts()[0]?.duration).toBe(8000);
    await user.click(within(partial).getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it("counts an action's own deadline down in whole seconds, without a close button", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const { outcome } = renderUndo({
        description: "Lunch?",
        durationMs: 3000,
      });
      act(() => {
        screen.getByRole("button", { name: "Trash" }).click();
      });
      const shown = () =>
        getToast("Moved to Trash").querySelector("[data-slot=toast-countdown]")
          ?.textContent;

      const counted = [shown()];
      for (const _ of [1, 2]) {
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        counted.push(shown());
      }
      const closeButtons = within(getToast("Moved to Trash"))
        .getAllByRole("button")
        .map((button) => button.textContent);
      await act(async () => {
        outcome.resolve({
          kind: "done",
          message: "Message sent",
          tone: "success",
        });
        await Promise.resolve();
      });
      const sent = getToast("Message sent");

      expect({
        buttons: closeButtons,
        counted,
        sentButtons: within(sent).queryAllByRole("button").length,
        sentSays: within(sent).queryByText("Lunch?") !== null,
        sentCountdown: sent.querySelector("[data-slot=toast-countdown]"),
      }).toStrictEqual({
        buttons: ["Undo"],
        counted: ["3", "2", "1"],
        sentButtons: 0,
        sentCountdown: null,
        sentSays: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no countdown on an Undo that keeps the usual eight seconds", async () => {
    const user = userEvent.setup();
    renderUndo();

    await user.click(screen.getByRole("button", { name: "Trash" }));

    expect(
      getToast("Moved to Trash").querySelector("[data-slot=toast-countdown]")
    ).toBeNull();
  });

  it("lets an agent find a toast by its title and press Undo", async () => {
    const user = userEvent.setup();
    const { undo } = renderUndo();

    await user.click(screen.getByRole("button", { name: "Trash" }));
    const entry = agent
      .snapshot()
      .find((item) => !item.offPage && item.component === "toast");
    expect(entry?.label).toBe("Moved to Trash");

    const result = await agent.act({
      steps: [{ action: "press", args: ["Undo"], ref: "Moved to Trash" }],
    });
    expect(result).toMatchObject({ ok: true });
    expect(undo).toHaveBeenCalledOnce();
  });
});

describe("command lists", () => {
  it("filters stashes as you type, matching their body as well as the subject", async () => {
    const user = userEvent.setup();
    render(<StashList />);
    const search = screen.getByRole("combobox", { name: "Search stashes" });

    await user.click(search);
    await user.keyboard("invoice");
    await act(settle);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent)
    ).toStrictEqual([expect.stringContaining("Quarterly numbers")]);

    await user.clear(search);
    await user.keyboard("zzzz");
    await act(settle);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No stash answers to that name.")).toBeTruthy();
  });

  it("moves the highlight with the arrows, stopping at the end, and runs it on Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(id: string) => void>();
    render(<StashList onSelect={onSelect} />);

    await user.click(screen.getByRole("combobox", { name: "Search stashes" }));
    expect(highlighted()?.textContent).toContain("Lunch?");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(highlighted()?.textContent).toContain("Trip plans");
    await user.keyboard("{ArrowDown}");
    expect(highlighted()?.textContent).toContain("Trip plans");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onSelect.mock.calls).toStrictEqual([["stash-numbers"]]);
  });

  it("discards a stash from its button without popping it", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn<(id: string) => void>();
    const onSelect = vi.fn<(id: string) => void>();
    render(<StashList onDiscard={onDiscard} onSelect={onSelect} />);

    await user.click(
      screen.getByRole("button", { name: "Discard stash: Lunch?" })
    );

    expect(onDiscard.mock.calls).toStrictEqual([["stash-lunch"]]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("lets an agent find the stash search and its stashes by name, and run one", async () => {
    const onSelect = vi.fn<(id: string) => void>();
    render(<StashList onSelect={onSelect} />);

    const entry = agent
      .snapshot()
      .find((item) => !item.offPage && item.component === "command");
    expect(entry?.label).toBe("Search stashes");
    const trip = entry?.items?.find((item) =>
      item.label.startsWith("Trip plans")
    );
    expect(trip).toBeDefined();

    const result = await agent.act({
      steps: [{ action: "run", args: [trip?.value], ref: "Search stashes" }],
    });
    expect(result).toMatchObject({ ok: true });
    expect(onSelect.mock.calls).toStrictEqual([["stash-trip"]]);
  });

  it("discards the highlighted stash on the composer's discard key, which the composer then skips", async () => {
    setPlatform("other");
    const user = userEvent.setup();
    const onDiscard = vi.fn<(draft: MailDraft) => void>();
    const prevented: boolean[] = [];
    const listener = (event: KeyboardEvent) => {
      if (event.key === "d") {
        prevented.push(event.defaultPrevented);
      }
    };
    const picker = () => (
      <NewMessageStashPicker
        accountsCount={1}
        disabled={false}
        drafts={STASHES}
        getReturnFocus={() => null}
        onDiscard={onDiscard}
        onSelect={vi.fn<(draft: MailDraft) => void>()}
        triggerRef={{ current: null }}
      />
    );
    render(picker());
    const trigger = screen.getByRole("button", { name: /^Stash/u });
    document.addEventListener("keydown", listener);

    await user.click(trigger);
    await act(settle);
    await user.keyboard("{Control>}d{/Control}");
    await act(settle);
    await user.click(trigger);
    await act(settle);
    await user.keyboard("trip{Control>}d{/Control}");
    await act(settle);
    document.removeEventListener("keydown", listener);

    expect({
      discarded: onDiscard.mock.calls.map(([draft]) => draft.subject),
      prevented,
    }).toStrictEqual({
      discarded: ["Lunch?", "Trip plans"],
      prevented: [true, true],
    });
  });

  it("keeps the discard buttons out of the Tab order, for the pointer and agents only", async () => {
    const user = userEvent.setup();
    render(<StashList />);

    await user.click(screen.getByRole("combobox", { name: "Search stashes" }));
    await user.tab();
    const entries = agent.snapshot().filter((entry) => !entry.offPage);

    expect({
      afterTab: document.activeElement?.getAttribute("aria-label") ?? null,
      buttons: entries
        .filter((entry) => entry.component === "button")
        .map(({ label }) => label),
      firstItem: entries
        .find((entry) => entry.component === "command")
        ?.items?.at(0)?.label,
    }).toStrictEqual({
      afterTab: null,
      buttons: [
        "Discard stash: Lunch?",
        "Discard stash: Quarterly numbers",
        "Discard stash: Trip plans",
      ],
      firstItem: expect.stringMatching(
        /^Lunch\? Can we meet at noon No recipient/u
      ),
    });
  });

  it("starts each opening of the stash picker with an empty search", async () => {
    const user = userEvent.setup();
    render(
      <NewMessageStashPicker
        accountsCount={1}
        disabled={false}
        drafts={STASHES}
        getReturnFocus={() => null}
        onDiscard={vi.fn<(draft: MailDraft) => void>()}
        onSelect={vi.fn<(draft: MailDraft) => void>()}
        triggerRef={{ current: null }}
      />
    );
    const trigger = screen.getByRole("button", { name: /^Stash/u });

    await user.click(trigger);
    await act(settle);
    await user.keyboard("trip{Escape}");
    await act(settle);
    await user.click(trigger);
    await act(settle);

    expect({
      options: screen.getAllByRole("option").length,
      query: screen.getByRole<HTMLInputElement>("combobox", {
        name: "Search stashes",
      }).value,
    }).toStrictEqual({ options: STASHES.length, query: "" });
  });

  it("closes the stash picker on the first Escape, leaving the composer's Escape alone", async () => {
    const user = userEvent.setup();
    const escapes = vi.fn<(prevented: boolean) => void>();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        escapes(event.defaultPrevented);
      }
    };
    render(
      <NewMessageStashPicker
        accountsCount={1}
        disabled={false}
        drafts={STASHES}
        getReturnFocus={() => screen.getByRole("button", { name: /^Stash/u })}
        onDiscard={vi.fn<(draft: MailDraft) => void>()}
        onSelect={vi.fn<(draft: MailDraft) => void>()}
        triggerRef={{ current: null }}
      />
    );
    const trigger = screen.getByRole("button", { name: /^Stash/u });

    await user.click(trigger);
    await act(settle);
    await user.keyboard("inv");
    document.addEventListener("keydown", listener);
    await user.keyboard("{Escape}");
    await act(settle);
    document.removeEventListener("keydown", listener);

    expect(
      screen.queryByRole("combobox", { name: "Search stashes" })
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // The composer's Escape skips a key a focused popup already handled.
    expect(escapes.mock.calls).toStrictEqual([[true]]);
  });

  it("closes the variable picker on the first Escape, even with text typed, and returns focus", async () => {
    const user = userEvent.setup();
    render(
      <AppHotkeysProvider>
        <TemplateVariablePicker
          disabled={false}
          editor={null}
          field="message"
        />
      </AppHotkeysProvider>
    );
    const trigger = screen.getByRole("button", {
      name: "Insert variable in message",
    });

    await user.click(trigger);
    await act(settle);
    expect(
      screen.getByRole("dialog", { name: "Insert variable in message" })
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Search variables" })
    );

    await user.keyboard("date");
    await user.keyboard("{Escape}");
    await act(settle);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("mail search command bar", () => {
  it("leads with Show all results, so Enter after typing fills the mailbox list", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn<(query: SearchQuery) => void>();
    render(<SearchBar onShowAll={onShowAll} />);

    await openSearchBar(user, "invoice");

    expect(highlighted()?.textContent).toContain("Show all results");
    await user.keyboard("{Enter}");
    expect(onShowAll.mock.calls).toStrictEqual([
      [{ filters: [], text: "invoice" }],
    ]);
  });

  it("puts a filter's completions first, so Enter adds the pill", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await openSearchBar(user, "has:");
    expect(highlighted()?.textContent).toContain("has:attachment");
    await user.keyboard("{Enter}");
    await act(settle);

    expect(
      screen.getByRole("button", { name: "Remove has:attachment filter" })
    ).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
    // Backspace in the empty field takes the pill back off.
    await user.keyboard("{Backspace}");
    expect(
      screen.queryByRole("button", { name: "Remove has:attachment filter" })
    ).toBeNull();
  });

  it("moves the highlight to a filter's completions once they lead", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn<(query: SearchQuery) => void>();
    render(<SearchBar onShowAll={onShowAll} />);

    await openSearchBar(user, "invoice");
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(highlighted()?.textContent).toContain("Show all results");
    await user.keyboard(" has:");
    await act(settle);
    expect(highlighted()?.textContent).toContain("has:attachment");

    await user.keyboard("{Enter}");
    await act(settle);
    expect(
      screen.getByRole("button", { name: "Remove has:attachment filter" })
    ).toBeTruthy();
    expect(onShowAll).not.toHaveBeenCalled();
  });

  it("explains a filter that has no completions yet", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await openSearchBar(user, "subject:");

    const hint = screen.getByText("Type a value for this filter.");
    expect(hint.closest("[hidden]")).toBeNull();
    expect(hint.closest("[role=listbox]")).toBeNull();
  });

  it("closes on the first Escape, even with text typed, and returns focus", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await openSearchBar(user, "invoice");
    await user.keyboard("{Escape}");
    await act(settle);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Open search" })
    );
  });

  it("keeps the caret in the field when a suggestion is clicked", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await openSearchBar(user, "");
    const field = screen.getByRole<HTMLInputElement>("combobox");
    await user.click(screen.getByRole("option", { name: /^subject:/u }));
    await act(settle);

    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("subject:");
  });
});
