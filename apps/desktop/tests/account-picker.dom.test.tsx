import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { LazyMotion, domMax } from "motion/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AccountPicker from "../src/renderer/src/components/accounts/account-picker";

const accounts = [
  { email: "first@example.com", provider: "gmail" },
  { email: "second@example.com", provider: "imap" },
] as const;

const Picker = ({
  locked = false,
  onSelect,
}: {
  readonly locked?: boolean;
  readonly onSelect: (accountId: string | null) => void;
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <LazyMotion features={domMax}>
      <AccountPicker
        accounts={accounts}
        locked={locked}
        nullOption={{
          description: "Use the account selected in New email",
          label: "Keep current account",
        }}
        onSelect={(accountId) => {
          onSelect(accountId);
          setSelected(accountId);
        }}
        selectedAccountId={selected}
      />
    </LazyMotion>
  );
};

const pressedNames = () =>
  screen
    .getAllByRole("button", { pressed: true })
    .map((toggle) => toggle.getAttribute("aria-label"));

describe(AccountPicker, () => {
  afterEach(cleanup);

  it("moves between accounts with the arrows, and chooses one on a press", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(accountId: string | null) => void>();
    render(<Picker onSelect={onSelect} />);

    await user.tab();
    await user.keyboard("{ArrowRight}");
    const focused = document.activeElement?.getAttribute("aria-label");
    const chosenWhileMoving = onSelect.mock.calls.length;
    await user.keyboard(" ");
    await user.tab();

    expect({
      chosenWhileMoving,
      focused,
      leftTheGroup: document.activeElement === document.body,
      pressed: pressedNames(),
    }).toStrictEqual({
      chosenWhileMoving: 0,
      focused: "Select first@example.com",
      leftTheGroup: true,
      pressed: ["Select first@example.com"],
    });
    expect(onSelect.mock.calls).toStrictEqual([["first@example.com"]]);
  });

  it("chooses the null option back, and keeps one option chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(accountId: string | null) => void>();
    render(<Picker onSelect={onSelect} />);

    await user.click(
      screen.getByRole("button", { name: "Select second@example.com" })
    );
    await user.click(
      screen.getByRole("button", { name: "Select second@example.com" })
    );
    await user.click(
      screen.getByRole("button", { name: "Keep current account" })
    );

    expect(onSelect.mock.calls).toStrictEqual([["second@example.com"], [null]]);
    expect(pressedNames()).toStrictEqual(["Keep current account"]);
  });

  it("lets an agent choose by value, unless the picker is locked", async () => {
    const onSelect = vi.fn<(accountId: string | null) => void>();
    const { rerender } = render(<Picker onSelect={onSelect} />);
    await act(settle);

    const chosen = await createAgent().act({
      steps: [
        {
          action: "setValue",
          args: [["second@example.com"]],
          ref: "From account",
        },
      ],
    });
    rerender(<Picker locked onSelect={onSelect} />);
    await act(settle);
    const whileLocked = await createAgent().act({
      steps: [
        {
          action: "setValue",
          args: [["first@example.com"]],
          ref: "From account",
        },
      ],
    });

    expect({ chosen: chosen.ok, whileLocked: whileLocked.ok }).toStrictEqual({
      chosen: true,
      whileLocked: false,
    });
    expect(onSelect.mock.calls).toStrictEqual([["second@example.com"]]);
  });

  it("keeps locked accounts reachable for their tooltips, but unpressable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(accountId: string | null) => void>();
    render(<Picker locked onSelect={onSelect} />);

    await user.tab();
    const focused = document.activeElement?.getAttribute("aria-disabled");
    await user.keyboard("{ArrowRight}{ArrowRight} ");

    expect(focused).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
