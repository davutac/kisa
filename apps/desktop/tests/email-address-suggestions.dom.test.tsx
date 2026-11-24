import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import EmailRecipientFields from "../src/renderer/src/components/mail/email-recipient-fields";
import type { EmailRecipients } from "../src/renderer/src/components/mail/email-recipient-fields";
import type { MailApi } from "../src/renderer/src/platform/desktop";
import {
  rankAddressMatches,
  toAddressQuery,
} from "../src/shared/address-match";
import type { MailSenderSuggestions } from "../src/shared/ipc/mail";

type Answer = (senders: MailSenderSuggestions["senders"]) => void;

// Each query waits for the test to answer it, as main answers over IPC.
const index = vi.hoisted(() => {
  const pending = new Map<string, Answer>();
  const listSenders: MailApi["listSenders"] = ({ query = "" }) => {
    const reply =
      Promise.withResolvers<Awaited<ReturnType<MailApi["listSenders"]>>>();
    pending.set(query, (senders) =>
      reply.resolve({ data: { senders }, ok: true })
    );
    return reply.promise;
  };
  return { listSenders, pending };
});

vi.mock(import("@/platform/desktop"), async (importOriginal) => {
  const api: Partial<MailApi> = { listSenders: index.listSenders };
  return { ...(await importOriginal()), getMailApi: () => api as MailApi };
});

const CORRESPONDENTS = [
  { address: "dev@apple.example", messageCount: 3, name: "Apple Developer" },
  { address: "dave.tran@studio.example", messageCount: 2, name: "Dave Tran" },
  { address: "dana@example.com", messageCount: 1 },
  { address: "joann@corp.example", messageCount: 1 },
];

/** Answers `query` once the field has asked for it, then lets it settle. */
const answer = async (query: string) => {
  await vi.waitFor(() => expect(index.pending.has(query)).toBeTruthy());
  await act(() =>
    index.pending.get(query)?.(
      rankAddressMatches(toAddressQuery(query), CORRESPONDENTS)
    )
  );
  index.pending.delete(query);
  await act(settle);
};

const NO_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

const Recipients = () => {
  const [value, setValue] = useState(NO_RECIPIENTS);
  return (
    <EmailRecipientFields
      accountId="me@example.com"
      onChange={setValue}
      value={value}
    />
  );
};

const optionNames = () =>
  screen.queryAllByRole("option").map((option) => option.textContent);

const hint = () =>
  document.querySelector("[data-slot=recipient-hint]")?.textContent ?? null;

const chips = () =>
  screen
    .queryAllByRole("button", { name: /^Remove /u })
    .map((button) => button.getAttribute("aria-label")?.slice(7));

describe("recipient suggestions from the index", () => {
  it("keeps every typed letter while each query's suggestions load", async () => {
    const user = userEvent.setup();
    render(<Recipients />);
    await act(settle);
    const to = screen.getByRole<HTMLInputElement>("combobox", { name: "To" });

    await user.click(to);
    await user.keyboard("d");
    await answer("d");
    expect(optionNames()).toHaveLength(3);

    // Each letter swaps the shown suggestions for a query still loading.
    await user.keyboard("a");
    await answer("da");
    await user.keyboard("v");
    await answer("dav");
    expect({ options: optionNames(), text: to.value }).toStrictEqual({
      options: ["Dave Trandave.tran@studio.example"],
      text: "dav",
    });

    await user.keyboard("{Enter}");
    await act(settle);
    expect({ chips: chips(), text: to.value }).toStrictEqual({
      chips: ["dave.tran@studio.example"],
      text: "",
    });

    await user.keyboard("d");
    await answer("d");
    await user.keyboard("z");
    await answer("dz");
    expect({ options: optionNames(), text: to.value }).toStrictEqual({
      options: [],
      text: "dz",
    });
  });

  it("shows the highlighted suggestion after the draft, for Tab to take", async () => {
    const user = userEvent.setup();
    render(<Recipients />);
    await act(settle);
    const to = screen.getByRole<HTMLInputElement>("combobox", { name: "To" });

    await user.click(to);
    await user.keyboard("d");
    await answer("d");
    await user.keyboard("t");
    // Until `dt` is answered, `d`'s answer narrowed to `dt` stands in.
    const whileLoading = hint();
    await answer("dt");
    await user.keyboard("@");
    await answer("dt@");
    expect({ hint: hint(), text: to.value, whileLoading }).toStrictEqual({
      hint: "dave.tran@studio.exampleTab",
      text: "dt@",
      whileLoading: "dave.tran@studio.exampleTab",
    });

    await user.keyboard("{Backspace}{Backspace}");
    await answer("d");
    const first = hint();
    await user.keyboard("{ArrowDown}");
    await act(settle);
    const second = hint();
    await user.keyboard("{Tab}");
    await act(settle);
    expect({
      added: chips(),
      first,
      hint: hint(),
      second,
      text: to.value,
    }).toStrictEqual({
      added: ["dave.tran@studio.example"],
      first: "dev@apple.exampleTab",
      hint: null,
      second: "dave.tran@studio.exampleTab",
      text: "",
    });
  });

  it("hides the hint while the suggestions are closed", async () => {
    const user = userEvent.setup();
    render(<Recipients />);
    await act(settle);
    const to = screen.getByRole<HTMLInputElement>("combobox", { name: "To" });

    await user.click(to);
    await user.keyboard("dav");
    await answer("d");
    await answer("da");
    await answer("dav");
    const shown = hint();
    await user.keyboard("{Escape}");
    await act(settle);
    const hidden = hint();
    // Reopening offers Tab what the list highlights again.
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await act(settle);
    const highlightedOption = screen
      .queryAllByRole("option")
      .find((option) => Object.hasOwn(option.dataset, "highlighted"));

    expect({
      hidden,
      options: optionNames(),
      reopened: hint(),
      highlighted: highlightedOption?.textContent ?? null,
      shown,
      text: to.value,
    }).toStrictEqual({
      hidden: null,
      options: ["Dave Trandave.tran@studio.example"],
      highlighted: "Dave Trandave.tran@studio.example",
      reopened: "dave.tran@studio.exampleTab",
      shown: "dave.tran@studio.exampleTab",
      text: "dav",
    });
  });

  it.each(["{Enter}", "{Tab}"])(
    "adds a whole typed address on %s rather than a looser match",
    async (key) => {
      const user = userEvent.setup();
      render(<Recipients />);
      await act(settle);
      const to = screen.getByRole<HTMLInputElement>("combobox", { name: "To" });

      await user.click(to);
      await user.type(to, "ann@corp.example");
      await answer("ann@corp.example");
      const shown = { hint: hint(), options: optionNames() };
      await user.keyboard(key);
      await act(settle);

      expect({ added: chips(), shown }).toStrictEqual({
        added: ["ann@corp.example"],
        shown: { hint: null, options: ["joann@corp.example"] },
      });
    }
  );
});
