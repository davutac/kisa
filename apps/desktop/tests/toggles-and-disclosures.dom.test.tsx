import { act, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import {
  Toggle as TogglePrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "@ui-sdk/react/toggle";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MailForwardedMessage from "../src/renderer/src/components/mail/forwarded-message";
import {
  HistoryButtons,
  NewMessageButton,
} from "../src/renderer/src/components/shell/shell-buttons";
import { useFavoriteLabelsStore } from "../src/renderer/src/components/shell/sidebar/favorite-labels";
import SidebarFavoriteToggle from "../src/renderer/src/components/shell/sidebar/sidebar-favorite-toggle";
import { SidebarScopeMailboxes } from "../src/renderer/src/components/shell/sidebar/sidebar-scope-mailboxes";
import SidebarUnreadToggle from "../src/renderer/src/components/shell/sidebar/sidebar-unread-toggle";
import SidebarWorkspaceButton from "../src/renderer/src/components/shell/sidebar/sidebar-workspace-button";
import {
  Command,
  CommandInput,
  CommandList,
} from "../src/renderer/src/components/ui/command";
import { Toggle, ToggleGroup } from "../src/renderer/src/components/ui/toggle";
import { getHotkeyDisplay } from "../src/renderer/src/hotkeys/commands";
import type { MailboxLabelItem } from "../src/renderer/src/mail/mailbox-labels";
import type { ThreadMessage } from "../src/shared/ipc/mail";

const agentEntries = (label: string) =>
  createAgent()
    .snapshot()
    .filter((entry) => entry.label === label);

const disabledAttributes = (label: string) => {
  const toggle = screen.getByRole("button", { name: label });
  return {
    ariaDisabled: toggle.getAttribute("aria-disabled"),
    dataDisabled: Object.hasOwn(toggle.dataset, "disabled"),
    disabled: toggle.hasAttribute("disabled"),
  };
};

const UNREAD = getHotkeyDisplay("app.toggleUnread").label;
const TEMPLATES = getHotkeyDisplay("app.openTemplates").label;
const COMPOSE = getHotkeyDisplay("app.composeMessage").label;
const BACK = getHotkeyDisplay("app.navigateBack").label;

describe("sidebar toggles", () => {
  beforeEach(() => {
    useFavoriteLabelsStore.setState({ favorites: [] });
  });

  it("lists each on/off button once, as a toggle with its pressed state", () => {
    render(
      <>
        <SidebarUnreadToggle
          onPressedChange={vi.fn<(pressed: boolean) => void>()}
          pressed={false}
        />
        <SidebarWorkspaceButton
          command="app.openTemplates"
          isOpen
          onToggle={vi.fn<() => void>()}
        >
          <span />
        </SidebarWorkspaceButton>
        <NewMessageButton
          canOpen
          isOpen={false}
          onToggle={vi.fn<() => void>()}
          placement="sidebar"
        />
      </>
    );

    expect(
      [UNREAD, TEMPLATES, COMPOSE].map((label) =>
        agentEntries(label).map(({ component, pressed }) => ({
          component,
          pressed,
        }))
      )
    ).toStrictEqual([
      [{ component: "toggle", pressed: false }],
      [{ component: "toggle", pressed: true }],
      [{ component: "toggle", pressed: false }],
    ]);
  });

  it("reports the state an agent or a press asks for", async () => {
    const user = userEvent.setup();
    const onUnread = vi.fn<(pressed: boolean) => void>();
    const onTemplates = vi.fn<() => void>();
    render(
      <>
        <SidebarUnreadToggle onPressedChange={onUnread} pressed={false} />
        <SidebarWorkspaceButton
          command="app.openTemplates"
          isOpen
          onToggle={onTemplates}
        >
          <span />
        </SidebarWorkspaceButton>
      </>
    );

    const result = await createAgent().act({
      steps: [{ action: "setPressed", args: [true], ref: UNREAD }],
    });
    await user.click(screen.getByRole("button", { name: TEMPLATES }));

    expect(result).toMatchObject({ ok: true });
    expect(onUnread.mock.calls.map(([pressed]) => pressed)).toStrictEqual([
      true,
    ]);
    expect(onTemplates).toHaveBeenCalledOnce();
  });

  it("keeps a compose button that can't open reachable for its tooltip, and refuses presses", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn<() => void>();
    render(
      <NewMessageButton
        canOpen={false}
        isOpen={false}
        onToggle={onToggle}
        placement="titlebar"
      />
    );
    const compose = screen.getByRole("button", { name: COMPOSE });

    await user.tab();
    const focused = document.activeElement;
    await user.click(compose);
    await user.keyboard(" ");
    const result = await createAgent().act({
      steps: [{ action: "setPressed", args: [true], ref: COMPOSE }],
    });

    expect(focused).toBe(compose);
    expect({
      ariaDisabled: compose.getAttribute("aria-disabled"),
      ariaPressed: compose.getAttribute("aria-pressed"),
      dataDisabled: Object.hasOwn(compose.dataset, "disabled"),
      nativeDisabled: compose.hasAttribute("disabled"),
    }).toStrictEqual({
      ariaDisabled: "true",
      ariaPressed: "false",
      dataDisabled: true,
      nativeDisabled: false,
    });
    expect(result).toMatchObject({ ok: false });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps Go back and Go forward reachable while there is nowhere to go", async () => {
    const user = userEvent.setup();
    const goBack = vi.fn<() => void>();
    render(
      <HistoryButtons
        history={{
          canGoBack: false,
          canGoForward: false,
          goBack,
          goForward: vi.fn<() => void>(),
        }}
      />
    );
    const back = screen.getByRole("button", { name: BACK });

    await user.tab();
    await act(settle);
    const focused = document.activeElement;
    const tooltipOpen = Object.hasOwn(
      screen.getByRole("tooltip", { hidden: true, name: BACK }).dataset,
      "open"
    );
    await user.keyboard("{Enter}");
    await user.click(back);

    expect({ focused: focused === back, tooltipOpen }).toStrictEqual({
      focused: true,
      tooltipOpen: true,
    });
    expect({
      ariaDisabled: back.getAttribute("aria-disabled"),
      dataDisabled: Object.hasOwn(back.dataset, "disabled"),
    }).toStrictEqual({ ariaDisabled: "true", dataDisabled: true });
    expect(goBack).not.toHaveBeenCalled();
  });

  it("leaves a toggle that isn't focusable while disabled as ui-sdk renders it", () => {
    render(
      <>
        <Toggle aria-label="Kisa alone" disabled />
        <TogglePrimitive aria-label="ui-sdk alone" disabled />
        <ToggleGroup aria-label="Kisa group">
          <Toggle aria-label="Kisa in group" disabled value="a" />
        </ToggleGroup>
        <ToggleGroupPrimitive aria-label="ui-sdk group">
          <TogglePrimitive aria-label="ui-sdk in group" disabled value="a" />
        </ToggleGroupPrimitive>
      </>
    );

    expect([
      disabledAttributes("Kisa alone"),
      disabledAttributes("Kisa in group"),
    ]).toStrictEqual([
      disabledAttributes("ui-sdk alone"),
      disabledAttributes("ui-sdk in group"),
    ]);
  });

  it("adds a label to the favorites and takes it out again", async () => {
    const user = userEvent.setup();
    const favorite = { accountId: "one@example.com", label: "Work" };
    render(
      <SidebarFavoriteToggle favorite={favorite}>
        <span />
      </SidebarFavoriteToggle>
    );
    const star = screen.getByRole("button", { name: "Favorite Work" });

    const result = await createAgent().act({
      steps: [{ action: "setPressed", args: [true], ref: "Favorite Work" }],
    });
    await act(settle);
    const added = useFavoriteLabelsStore.getState().favorites;
    const pressedAfterAdd = star.getAttribute("aria-pressed");
    await user.click(star);

    expect(result).toMatchObject({ ok: true });
    expect(added).toStrictEqual([favorite]);
    expect(pressedAfterAdd).toBe("true");
    expect(useFavoriteLabelsStore.getState().favorites).toStrictEqual([]);
    expect(star.getAttribute("aria-pressed")).toBe("false");
  });
});

const LABELS: readonly MailboxLabelItem[] = [
  { accountIds: ["one@example.com"], key: "work", name: "Work" },
];

const LabelsScope = ({
  onExpandedChange,
}: {
  readonly onExpandedChange: (expanded: boolean) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <SidebarScopeMailboxes
      accountId="one@example.com"
      id="mailboxes"
      isLabelsExpanded={expanded}
      labels={LABELS}
      onLabelsExpandedChange={(next) => {
        onExpandedChange(next);
        setExpanded(next);
      }}
      onSelect={vi.fn<() => void>()}
      scopeAccountIds={["one@example.com"]}
      scopeLabel="one@example.com"
      view={{
        currentPath: "/",
        mailbox: "inbox",
        selectedAccountId: "one@example.com",
      }}
    />
  );
};

describe("sidebar Labels row", () => {
  it("is one disclosure an agent opens and a press closes", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn<(expanded: boolean) => void>();
    render(<LabelsScope onExpandedChange={onExpandedChange} />);
    const row = "Labels, one@example.com";

    const closed = agentEntries(row).map(({ component, open }) => ({
      component,
      open,
    }));
    const result = await createAgent().act({
      steps: [{ action: "setOpen", args: [true], ref: row }],
    });
    await act(settle);
    const work = screen.getByRole("button", { name: "Work, one@example.com" });
    const controls = screen
      .getByRole("button", { name: row })
      .getAttribute("aria-controls");
    const labelList =
      controls === null ? null : document.querySelector(`#${controls}`);
    await user.click(screen.getByRole("button", { name: row }));

    expect(closed).toStrictEqual([{ component: "collapsible", open: false }]);
    expect(result).toMatchObject({ ok: true });
    expect(labelList?.contains(work)).toBeTruthy();
    expect(onExpandedChange.mock.calls).toStrictEqual([[true], [false]]);
    expect(
      screen.queryByRole("button", { name: "Work, one@example.com" })
    ).toBeNull();
  });
});

const FORWARDED: ThreadMessage = {
  attachments: [],
  body: { text: "See below." },
  from: "Ana <ana@example.com>",
  id: "message-1",
  labelIds: [],
  senderAuthenticated: false,
  sentAt: 0,
  snippet: "See below.",
  subject: "Trip",
  to: "bo@example.com",
};

describe(MailForwardedMessage, () => {
  it("shows the forwarded message and hides it again", async () => {
    const user = userEvent.setup();
    render(<MailForwardedMessage message={FORWARDED} />);

    const closed = agentEntries("Show forwarded message").map(
      ({ component, open }) => ({ component, open })
    );
    await user.click(
      screen.getByRole("button", { name: "Show forwarded message" })
    );
    await act(settle);
    const shown = screen.queryByRole("region", { name: "Forwarded message" });
    await user.click(
      screen.getByRole("button", { name: "Hide forwarded message" })
    );
    await act(settle);

    expect(closed).toStrictEqual([{ component: "collapsible", open: false }]);
    expect(shown?.textContent).toContain("Trip");
    expect(
      screen.queryByRole("region", { name: "Forwarded message" })
    ).toBeNull();
  });
});

describe("CommandInput onEscape", () => {
  it("runs on the first Escape without clearing the text, but not while composing", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn<() => void>();
    render(
      <Command>
        <CommandInput aria-label="Search things" onEscape={onEscape} />
        <CommandList />
      </Command>
    );
    const input = screen.getByRole("combobox", { name: "Search things" });

    await user.type(input, "inv");
    fireEvent.keyDown(input, { isComposing: true, key: "Escape" });
    const whileComposing = onEscape.mock.calls.length;
    await user.keyboard("{Escape}");

    expect(whileComposing).toBe(0);
    expect(onEscape).toHaveBeenCalledOnce();
    expect((input as HTMLInputElement).value).toBe("inv");
  });
});
