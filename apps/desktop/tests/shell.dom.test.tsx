import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MailboxBreadcrumb from "../src/renderer/src/components/mail/mailbox-breadcrumb";
import TitlebarIndexButton from "../src/renderer/src/components/mail/titlebar-index-button";
import { ModeToggle } from "../src/renderer/src/components/shell/mode-toggle";
import SidebarAccounts from "../src/renderer/src/components/shell/sidebar/sidebar-accounts";
import SidebarFrame from "../src/renderer/src/components/shell/sidebar/sidebar-frame";
import { ThemeProvider } from "../src/renderer/src/components/shell/theme-provider";
import { TitlebarSlotContext } from "../src/renderer/src/components/shell/titlebar-slot";
import {
  getHotkeyAriaLabel,
  OPEN_ACCOUNT_COMMAND_IDS,
} from "../src/renderer/src/hotkeys/commands";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import { LabelsProvider } from "../src/renderer/src/state/labels";
import type { Account } from "../src/shared/ipc/accounts";
import type { MailIndexProgress } from "../src/shared/ipc/mail";

// jsdom has no `matchMedia`; this one answers the color-scheme queries and
// tells their listeners when the system's preference flips.
const media = vi.hoisted(() => {
  const lists = new Set<{ list: EventTarget; matches: () => boolean }>();
  const state = { dark: false };
  const matchMedia = (query: string): EventTarget => {
    const list = new EventTarget();
    const matches = (): boolean =>
      query.includes("dark")
        ? state.dark
        : query.includes("light") && !state.dark;
    Object.defineProperties(list, {
      addListener: {
        value: (listener: EventListener) =>
          list.addEventListener("change", listener),
      },
      matches: { get: matches },
      media: { value: query },
      onchange: { value: null, writable: true },
      removeListener: {
        value: (listener: EventListener) =>
          list.removeEventListener("change", listener),
      },
    });
    lists.add({ list, matches });
    return list;
  };
  Object.defineProperty(window, "matchMedia", { value: matchMedia });
  return {
    prefer: (dark: boolean): void => {
      state.dark = dark;
      for (const { list, matches } of lists) {
        list.dispatchEvent(
          Object.assign(new Event("change"), { matches: matches() })
        );
      }
    },
    reset: (): void => {
      state.dark = false;
    },
  };
});

const indexing = vi.hoisted(() => ({
  accounts: [] as MailIndexProgress[],
}));

vi.mock(import("../src/renderer/src/mail/use-mail-index-progress"), () => ({
  useAccountIndexProgress: (accountId: string) =>
    indexing.accounts.find((entry) => entry.accountId === accountId),
  useMailIndexProgress: () => indexing.accounts,
  useMailIndexState: () => ({ accounts: indexing.accounts, etas: new Map() }),
}));

const navigation = vi.hoisted(() => ({
  openAccount: vi.fn<(accountEmail: string) => void>(),
  openAllAccounts: vi.fn<() => void>(),
  openMailbox: vi.fn<() => void>(),
}));

vi.mock(import("../src/renderer/src/mail/use-mailbox-navigation"), () => ({
  useMailboxNavigation: () => navigation,
}));

const agent = createAgent();

const ADA: Account = { email: "ada@example.com", provider: "gmail" };
const BEN: Account = { email: "ben@example.com", provider: "icloud" };
const CY: Account = { email: "cy@example.com", provider: "imap" };
const VIEW = {
  currentPath: "/",
  mailbox: "inbox",
  selectedAccountId: null,
} as const;

const running = (
  accountId: string,
  estimatedMessages?: number
): MailIndexProgress => ({
  accountId,
  estimatedMessages,
  indexedMessages: 42,
  indexedThreads: 10,
  status: "running",
});

const resetShell = (): void => {
  window.localStorage.clear();
  document.documentElement.className = "dark";
  indexing.accounts = [];
  media.reset();
  navigation.openAccount.mockClear();
  navigation.openAllAccounts.mockClear();
  navigation.openMailbox.mockClear();
};

const attributes = (element: Element, names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));

const isDark = (): boolean =>
  document.documentElement.classList.contains("dark");

const Frame = ({
  children,
  isOpen = true,
}: {
  readonly children?: ReactNode;
  readonly isOpen?: boolean;
}) => (
  <LazyMotion features={domMax}>
    <SidebarFrame
      isHotkeyHintsRevealed={false}
      isOpen={isOpen}
      minWidthAnchorRef={{ current: null }}
      sidebarRef={() => {}}
    >
      {children ?? <p>Rows</p>}
    </SidebarFrame>
  </LazyMotion>
);

// jsdom has no pointer capture, which a drag takes on its first move.
const grabbable = (element: HTMLElement): HTMLElement => {
  element.setPointerCapture = () => {};
  element.releasePointerCapture = () => {};
  element.hasPointerCapture = () => true;
  return element;
};

// jsdom has no Typed OM, which the sidebar reads its strip's insets from.
const stubStyleMaps = (): (() => void) => {
  Object.defineProperty(Element.prototype, "computedStyleMap", {
    configurable: true,
    value: () => new Map(),
  });
  Object.defineProperty(globalThis, "CSSUnitValue", {
    configurable: true,
    value: class {
      readonly unit = "px";
    },
  });
  return () => {
    Reflect.deleteProperty(Element.prototype, "computedStyleMap");
    Reflect.deleteProperty(globalThis, "CSSUnitValue");
  };
};

const storedWidth = (): string | null =>
  window.localStorage.getItem("kisa.sidebar.width");

const panelWidth = (): string | undefined =>
  screen.getByText("Rows").parentElement?.style.width;

describe("sidebar resize handle", () => {
  beforeEach(resetShell);

  it("starts at the remembered width, clamped to the limits", () => {
    window.localStorage.setItem("kisa.sidebar.width", "900");
    render(<Frame />);

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(
      attributes(handle, ["aria-valuenow", "aria-valuemax", "tabindex"])
    ).toStrictEqual({
      "aria-valuemax": "360",
      "aria-valuenow": "360",
      tabindex: "0",
    });
    expect(panelWidth()).toBe("360px");
  });

  it("steps with the arrow keys and remembers each step", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "300");
    const user = userEvent.setup();
    render(<Frame />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(handle.getAttribute("aria-valuenow")).toBe("316");
    expect(panelWidth()).toBe("316px");
    expect(storedWidth()).toBe("316");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(storedWidth()).toBe("284");
  });

  it("jumps to either limit with Home and End, and stops at 360 pixels", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "300");
    const user = userEvent.setup();
    render(<Frame />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    handle.focus();
    await user.keyboard("{Home}");
    expect(handle.getAttribute("aria-valuenow")).toBe(
      handle.getAttribute("aria-valuemin")
    );
    expect(storedWidth()).toBe("160");

    await user.keyboard("{End}{ArrowRight}");
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    expect(storedWidth()).toBe("360");
  });

  it("restores the default width on a double-click", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "320");
    const user = userEvent.setup();
    render(<Frame />);

    await user.dblClick(
      screen.getByRole("separator", { name: "Resize sidebar" })
    );
    expect(storedWidth()).toBe("240");
  });

  it("follows a drag and remembers the width on release", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "240");
    render(<Frame />);
    const handle = grabbable(
      screen.getByRole("separator", { name: "Resize sidebar" })
    );

    fireEvent.pointerDown(handle, { button: 0, clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 300, pointerId: 1 });
    await act(settle);
    expect(
      attributes(handle, ["aria-valuenow", "data-dragging"])
    ).toStrictEqual({ "aria-valuenow": "300", "data-dragging": "" });
    expect(storedWidth()).toBe("240");

    fireEvent.pointerUp(handle, { button: 0, clientX: 300, pointerId: 1 });
    await act(settle);
    expect(Object.hasOwn(handle.dataset, "dragging")).toBeFalsy();
    expect(storedWidth()).toBe("300");
  });

  it("puts the width back on Escape during a drag", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "240");
    const onEscape = vi.fn<() => void>();
    document.addEventListener("keydown", onEscape);
    render(<Frame />);
    const handle = grabbable(
      screen.getByRole("separator", { name: "Resize sidebar" })
    );

    fireEvent.pointerDown(handle, { button: 0, clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 300, pointerId: 1 });
    await act(settle);
    fireEvent.keyDown(handle, { key: "Escape" });
    await act(settle);
    document.removeEventListener("keydown", onEscape);

    expect(
      attributes(handle, ["aria-valuenow", "data-dragging"])
    ).toStrictEqual({ "aria-valuenow": "240", "data-dragging": null });
    expect(storedWidth()).toBe("240");
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("measures the minimum again when a resize starts", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "290");
    const user = userEvent.setup();
    // The strip's insets read as 0; the anchor's edge sets the minimum.
    const restore = stubStyleMaps();
    const strip = document.createElement("div");
    const anchor = document.createElement("button");
    strip.append(anchor);
    const edge = { right: 250 };
    anchor.getBoundingClientRect = () =>
      DOMRect.fromRect({ height: 20, width: 20, x: edge.right - 20, y: 0 });
    try {
      render(
        <LazyMotion features={domMax}>
          <SidebarFrame
            isHotkeyHintsRevealed={false}
            isOpen
            minWidthAnchorRef={{ current: anchor }}
            sidebarRef={() => {}}
          >
            <p>Rows</p>
          </SidebarFrame>
        </LazyMotion>
      );
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });
      expect(handle.getAttribute("aria-valuemin")).toBe("250");

      // The window-controls inset grew since the sidebar mounted.
      edge.right = 280;
      handle.focus();
      await user.keyboard("{ArrowLeft}");
      expect(
        attributes(handle, ["aria-valuemin", "aria-valuenow"])
      ).toStrictEqual({ "aria-valuemin": "280", "aria-valuenow": "280" });
    } finally {
      restore();
    }
  });

  it("has no handle while the sidebar is hidden", () => {
    render(<Frame isOpen={false} />);

    expect(screen.queryByRole("separator")).toBeNull();
  });
});

const Accounts = ({
  accounts,
  onReorder,
}: {
  readonly accounts: readonly Account[];
  readonly onReorder: (accounts: readonly Account[]) => Promise<void>;
}) => (
  <AccountsProvider accounts={accounts} onReorder={onReorder}>
    <LabelsProvider accountIds={accounts.map(({ email }) => email)}>
      {/* With motion on, so a move runs the rows' layout animation. */}
      <LazyMotion features={domMax}>
        <MotionConfig reducedMotion="never">
          <SidebarAccounts
            onOpenAccount={(email) => navigation.openAccount(email)}
            onOpenAllAccounts={() => navigation.openAllAccounts()}
            onSelectMailbox={() => navigation.openMailbox()}
            view={VIEW}
          />
        </MotionConfig>
      </LazyMotion>
    </LabelsProvider>
  </AccountsProvider>
);

const reorderSpy = () =>
  vi.fn<(accounts: readonly Account[]) => Promise<void>>(() =>
    Promise.resolve()
  );

const reorderedEmails = (
  spy: ReturnType<typeof reorderSpy>
): readonly string[] | undefined =>
  spy.mock.calls.at(-1)?.[0].map(({ email }) => email);

const reorderHandle = (account: Account): HTMLElement =>
  screen.getByRole("button", { name: `Reorder ${account.email}` });

const rowShortcut = (name: string): string | null =>
  screen.getByRole("button", { name }).getAttribute("aria-keyshortcuts");

const accountNumber = (index: number): string =>
  getHotkeyAriaLabel(OPEN_ACCOUNT_COMMAND_IDS[index] ?? "app.openAccount1");

describe("account reordering", () => {
  beforeEach(resetShell);

  it("moves an account with the keyboard and keeps its number until the drop", async () => {
    const user = userEvent.setup();
    const onReorder = reorderSpy();
    render(<Accounts accounts={[ADA, BEN, CY]} onReorder={onReorder} />);

    reorderHandle(BEN).focus();
    await user.keyboard(" {ArrowUp}");
    expect(rowShortcut(BEN.email)).toBe(accountNumber(1));
    await user.keyboard(" ");

    expect(onReorder).toHaveBeenCalledOnce();
    expect(reorderedEmails(onReorder)).toStrictEqual([
      BEN.email,
      ADA.email,
      CY.email,
    ]);
    expect(navigation.openAccount).not.toHaveBeenCalled();
  });

  it("numbers the accounts by the order they come back in", () => {
    const { rerender } = render(
      <Accounts accounts={[ADA, BEN, CY]} onReorder={reorderSpy()} />
    );
    expect(rowShortcut(ADA.email)).toBe(accountNumber(0));

    rerender(<Accounts accounts={[BEN, ADA, CY]} onReorder={reorderSpy()} />);
    expect(rowShortcut(BEN.email)).toBe(accountNumber(0));
    expect(rowShortcut(ADA.email)).toBe(accountNumber(1));
    expect(
      within(screen.getByRole("list", { name: "Accounts" }))
        .getAllByRole("button", { name: /^Reorder /u })
        .map((handle) => handle.getAttribute("aria-label"))
    ).toStrictEqual([
      `Reorder ${BEN.email}`,
      `Reorder ${ADA.email}`,
      `Reorder ${CY.email}`,
    ]);
  });

  it("puts an account back on Escape", async () => {
    const user = userEvent.setup();
    const onReorder = reorderSpy();
    render(<Accounts accounts={[ADA, BEN]} onReorder={onReorder} />);

    reorderHandle(ADA).focus();
    await user.keyboard(" {ArrowDown}{Escape}");

    expect(onReorder).not.toHaveBeenCalled();
    expect(rowShortcut(ADA.email)).toBe(accountNumber(0));
  });

  it("opens the account on a plain click of its icon", async () => {
    const user = userEvent.setup();
    render(<Accounts accounts={[ADA, BEN]} onReorder={reorderSpy()} />);

    await user.click(reorderHandle(BEN));

    expect(navigation.openAccount).toHaveBeenCalledWith(BEN.email);
  });

  it("drags an account by its icon without opening it on release", async () => {
    const onReorder = reorderSpy();
    render(<Accounts accounts={[ADA, BEN, CY]} onReorder={onReorder} />);
    // jsdom lays nothing out: stack the rows 32 pixels apart.
    for (const [index, account] of [ADA, BEN, CY].entries()) {
      const handle = grabbable(reorderHandle(account));
      for (const element of [handle, handle.parentElement]) {
        if (element !== null) {
          element.getBoundingClientRect = () =>
            DOMRect.fromRect({ height: 32, width: 200, x: 0, y: index * 32 });
        }
      }
    }
    const handle = reorderHandle(ADA);

    fireEvent.pointerDown(handle, { button: 0, clientX: 8, clientY: 16 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 8, clientY: 40 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 8, clientY: 90 });
    await act(settle);
    fireEvent.pointerUp(handle, { button: 0, clientX: 8, clientY: 90 });
    fireEvent.click(handle, { detail: 1 });
    await act(settle);

    expect(reorderedEmails(onReorder)).toStrictEqual([
      BEN.email,
      CY.email,
      ADA.email,
    ]);
    expect(navigation.openAccount).not.toHaveBeenCalled();
  });

  it("ends a move when an account disconnects, keeping the rest in order", async () => {
    const user = userEvent.setup();
    const onReorder = reorderSpy();
    const { rerender } = render(
      <Accounts accounts={[ADA, BEN, CY]} onReorder={onReorder} />
    );

    reorderHandle(CY).focus();
    await user.keyboard(" {ArrowUp}");
    rerender(<Accounts accounts={[ADA, CY]} onReorder={onReorder} />);
    await act(settle);

    expect(screen.queryByRole("button", { name: BEN.email })).toBeNull();
    expect(reorderHandle(CY).getAttribute("aria-pressed")).toBe("false");
    expect(rowShortcut(ADA.email)).toBe(accountNumber(0));
    expect(rowShortcut(CY.email)).toBe(accountNumber(1));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("reorders what is left after a disconnect", async () => {
    const user = userEvent.setup();
    const onReorder = reorderSpy();
    const { rerender } = render(
      <Accounts accounts={[ADA, BEN, CY]} onReorder={onReorder} />
    );
    rerender(<Accounts accounts={[ADA, CY]} onReorder={onReorder} />);

    reorderHandle(CY).focus();
    await user.keyboard(" {ArrowUp} ");

    expect(reorderedEmails(onReorder)).toStrictEqual([CY.email, ADA.email]);
  });

  it("reorders an account whose sign-in was refused like any other", async () => {
    indexing.accounts = [{ ...running(BEN.email), status: "paused" }];
    const user = userEvent.setup();
    const onReorder = reorderSpy();
    render(<Accounts accounts={[ADA, BEN]} onReorder={onReorder} />);

    expect(rowShortcut(`${BEN.email}, cannot sign in`)).toBe(accountNumber(1));
    reorderHandle(BEN).focus();
    await user.keyboard(" {Home} ");

    expect(reorderedEmails(onReorder)).toStrictEqual([BEN.email, ADA.email]);
  });

  it("shows an indexing account's progress as a ring in its icon", () => {
    indexing.accounts = [running(ADA.email, 100), running(BEN.email)];
    render(<Accounts accounts={[ADA, BEN]} onReorder={reorderSpy()} />);

    const known = within(reorderHandle(ADA)).getByRole("progressbar", {
      hidden: true,
    });
    const unknown = within(reorderHandle(BEN)).getByRole("progressbar", {
      hidden: true,
    });
    expect(known.getAttribute("aria-valuetext")).toBe("42%");
    expect(
      attributes(unknown, ["aria-valuenow", "data-indeterminate"])
    ).toStrictEqual({ "aria-valuenow": null, "data-indeterminate": "" });
  });
});

const renderTheme = async () => {
  vi.resetModules();
  const [{ ThemeProvider: Provider, useTheme }, { ModeToggle: Toggle }] =
    await Promise.all([
      import("../src/renderer/src/components/shell/theme-provider"),
      import("../src/renderer/src/components/shell/mode-toggle"),
    ]);
  const Resolved = () => <output>{useTheme().resolvedTheme}</output>;
  return render(
    <Provider>
      <Toggle />
      <Resolved />
    </Provider>
  );
};

const resolvedTheme = (): string | null =>
  screen.getByRole("status").textContent;

describe("theme", () => {
  beforeEach(resetShell);

  it("starts dark when nothing is saved", async () => {
    document.documentElement.className = "";
    await renderTheme();

    expect(isDark()).toBeTruthy();
    expect(resolvedTheme()).toBe("dark");
    expect(
      screen.getByRole("button", {
        name: "Change theme, current theme is Dark",
      })
    ).toBeTruthy();
  });

  it("reads the theme next-themes saved", async () => {
    window.localStorage.setItem("vite-ui-theme", "light");
    await renderTheme();

    expect(isDark()).toBeFalsy();
    expect(resolvedTheme()).toBe("light");
    expect(
      screen.getByRole("button", {
        name: "Change theme, current theme is Light",
      })
    ).toBeTruthy();
  });

  it("saves the chosen theme under the same key and moves the dark class", async () => {
    const user = userEvent.setup();
    await renderTheme();

    await user.click(screen.getByRole("button", { name: /^Change theme/u }));
    await user.click(screen.getByRole("menuitemradio", { name: "Light" }));
    await act(settle);

    expect(window.localStorage.getItem("vite-ui-theme")).toBe("light");
    expect(isDark()).toBeFalsy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("marks the current theme in the menu and switches back to dark", async () => {
    window.localStorage.setItem("vite-ui-theme", "light");
    const user = userEvent.setup();
    await renderTheme();

    await user.click(screen.getByRole("button", { name: /^Change theme/u }));
    expect(
      screen
        .getByRole("menuitemradio", { name: "Light" })
        .getAttribute("aria-checked")
    ).toBe("true");
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));

    expect(window.localStorage.getItem("vite-ui-theme")).toBe("dark");
    expect(isDark()).toBeTruthy();
  });

  it("follows a theme chosen in another window", async () => {
    await renderTheme();
    expect(isDark()).toBeTruthy();

    window.localStorage.setItem("vite-ui-theme", "light");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "vite-ui-theme",
          newValue: "light",
          storageArea: window.localStorage,
        })
      );
    });

    expect(isDark()).toBeFalsy();
    expect(resolvedTheme()).toBe("light");
  });

  it("follows the system's scheme while System is chosen", async () => {
    window.localStorage.setItem("vite-ui-theme", "system");
    await renderTheme();
    expect(isDark()).toBeFalsy();
    expect(resolvedTheme()).toBe("light");

    act(() => media.prefer(true));
    expect(isDark()).toBeTruthy();
    expect(resolvedTheme()).toBe("dark");

    act(() => media.prefer(false));
    expect(isDark()).toBeFalsy();
  });
});

describe("indexing progress in the titlebar", () => {
  beforeEach(resetShell);

  it("names the button once and exposes the value without announcing it", () => {
    indexing.accounts = [running(ADA.email, 100)];
    const { container } = render(<TitlebarIndexButton />);

    const button = screen.getByRole("button", { name: "Indexing mail" });
    const progress = within(button).getByRole("progressbar", {
      name: "Indexing mail",
    });
    expect(
      attributes(progress, ["aria-valuenow", "aria-valuetext"])
    ).toStrictEqual({ "aria-valuenow": "0.42", "aria-valuetext": "42%" });
    expect(button.textContent).toContain("42%");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("keeps the name while the value moves", () => {
    indexing.accounts = [running(ADA.email, 100)];
    const { rerender } = render(<TitlebarIndexButton />);
    const button = screen.getByRole("button", { name: "Indexing mail" });

    indexing.accounts = [{ ...running(ADA.email, 100), indexedMessages: 43 }];
    rerender(<TitlebarIndexButton />);

    expect(screen.getByRole("button", { name: "Indexing mail" })).toBe(button);
    expect(
      within(button)
        .getByRole("progressbar", { name: "Indexing mail" })
        .getAttribute("aria-valuetext")
    ).toBe("43%");
  });

  it("spins without a value until the total is known", () => {
    indexing.accounts = [running(ADA.email)];
    render(<TitlebarIndexButton />);

    const progress = screen.getByRole("progressbar", { name: "Indexing mail" });
    expect(
      attributes(progress, ["aria-valuenow", "data-indeterminate"])
    ).toStrictEqual({ "aria-valuenow": null, "data-indeterminate": "" });
    expect(
      screen.getByRole("button", { name: "Indexing mail" }).textContent
    ).toContain("Indexing");
  });
});

const Breadcrumb = ({ slot }: { readonly slot: HTMLElement }) => (
  <AccountsProvider accounts={[ADA]} onReorder={() => Promise.resolve()}>
    <LabelsProvider accountIds={[ADA.email]}>
      <TitlebarSlotContext.Provider value={slot}>
        <MailboxBreadcrumb
          mailbox="sent"
          thread={{
            backLabel: "Back to Sent",
            onBack: () => navigation.openMailbox(),
            subject: "Quarterly report",
          }}
        />
      </TitlebarSlotContext.Provider>
    </LabelsProvider>
  </AccountsProvider>
);

describe("mailbox breadcrumb", () => {
  beforeEach(resetShell);

  it("names its crumbs and runs them as buttons", async () => {
    const user = userEvent.setup();
    const slot = document.createElement("div");
    document.body.append(slot);
    try {
      render(<Breadcrumb slot={slot} />);
      const scope = screen.getByRole("button", { name: "All accounts" });
      const back = screen.getByRole("button", { name: "Sent" });

      expect(
        attributes(back, ["aria-keyshortcuts", "data-slot"])
      ).toStrictEqual({
        "aria-keyshortcuts": getHotkeyAriaLabel("thread.close"),
        "data-slot": "button",
      });
      await user.click(scope);
      await user.click(back);
      expect(navigation.openAllAccounts).toHaveBeenCalledOnce();
      expect(navigation.openMailbox).toHaveBeenCalledOnce();
      expect(
        agent
          .snapshot()
          .filter((entry) => !entry.offPage)
          .map((entry) => entry.label)
      ).toStrictEqual(["All accounts", "Sent"]);
    } finally {
      slot.remove();
    }
  });
});

describe("agent", () => {
  beforeEach(resetShell);

  it("lets an agent show and hide an account's mailboxes without opening the account", async () => {
    render(<Accounts accounts={[ADA, BEN]} onReorder={reorderSpy()} />);
    await act(settle);
    const row = () => screen.getByRole("button", { name: ADA.email });

    const shown = await agent.act({
      steps: [{ action: "setOpen", args: [true], ref: ADA.email }],
    });
    await act(settle);
    const whileShown = {
      controls: document.querySelector(
        `[id="${row().getAttribute("aria-controls") ?? ""}"]`
      )?.textContent,
      expanded: row().getAttribute("aria-expanded"),
    };
    const hidden = await agent.act({
      steps: [{ action: "setOpen", args: [false], ref: ADA.email }],
    });
    await act(settle);

    expect({
      ok: [shown.ok, hidden.ok],
      whileShown,
    }).toStrictEqual({
      ok: [true, true],
      whileShown: {
        controls: expect.stringContaining("Sent"),
        expanded: "true",
      },
    });
    expect({
      expanded: row().getAttribute("aria-expanded"),
      opened: navigation.openAccount.mock.calls,
    }).toStrictEqual({ expanded: "false", opened: [] });
  });

  it("finds every shell control by name, reorders accounts and changes the theme", async () => {
    window.localStorage.setItem("kisa.sidebar.width", "240");
    indexing.accounts = [running(ADA.email, 100)];
    const onReorder = reorderSpy();
    render(
      <ThemeProvider>
        <Frame>
          <Accounts accounts={[ADA, BEN, CY]} onReorder={onReorder} />
        </Frame>
        <TitlebarIndexButton />
        <ModeToggle />
      </ThemeProvider>
    );
    await act(settle);

    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    expect(entries.filter((entry) => !entry.label)).toStrictEqual([]);
    expect(entries.map((entry) => entry.label)).toStrictEqual(
      expect.arrayContaining([
        "Resize sidebar",
        "Accounts",
        "All accounts",
        ADA.email,
        BEN.email,
        CY.email,
        "Indexing mail",
        "Change theme, current theme is Dark",
      ])
    );

    const result = await agent.act({
      steps: [
        { action: "press", ref: ADA.email },
        { action: "move", args: [CY.email, 0], ref: "Accounts" },
        { action: "setValue", args: [300], ref: "Resize sidebar" },
        { action: "press", args: ["Light"], ref: "Change theme" },
      ],
    });
    expect(result.error?.message ?? "ok").toBe("ok");
    expect({
      opened: navigation.openAccount.mock.calls,
      order: reorderedEmails(onReorder),
      theme: window.localStorage.getItem("vite-ui-theme"),
      width: storedWidth(),
    }).toStrictEqual({
      opened: [[ADA.email]],
      order: [CY.email, ADA.email, BEN.email],
      theme: "light",
      width: "300",
    });
  });
});
