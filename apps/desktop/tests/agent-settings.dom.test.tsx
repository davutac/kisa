import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { setPlatform, settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { ConfirmDialogProvider } from "../src/renderer/src/components/confirm-dialog";
import SettingsDialog from "../src/renderer/src/components/settings/settings-dialog";
import { getSettingsPageLabel } from "../src/renderer/src/components/settings/settings-pages";
import { buildSettingsSearchIndex } from "../src/renderer/src/components/settings/settings-search";
import SidebarSettingsButton from "../src/renderer/src/components/shell/sidebar/sidebar-settings-button";
import { ThemeProvider } from "../src/renderer/src/components/shell/theme-provider";
import { createDialogController } from "../src/renderer/src/components/ui/dialog";
import type { DialogController } from "../src/renderer/src/components/ui/dialog";
import { Toaster } from "../src/renderer/src/components/ui/toast";
import { useAppCommand } from "../src/renderer/src/hotkeys";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import type {
  AccountsApi,
  AiApi,
  AppSettingsApi,
  LoginItemSettingsApi,
  MailApi,
  RuntimeCapabilities,
  SettingsApi,
  UpdateApi,
  WindowApi,
} from "../src/renderer/src/platform/desktop";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import { AiProviderStateProvider } from "../src/renderer/src/state/ai-provider-state";
import { LabelsProvider } from "../src/renderer/src/state/labels";
import type { Account } from "../src/shared/ipc/accounts";

interface SettingsFakes {
  readonly disconnectAccount: Mock<AccountsApi["disconnectAccount"]>;
  readonly syncLabels: Mock<MailApi["syncLabels"]>;
}

const fakes = vi.hoisted((): SettingsFakes => ({
  disconnectAccount: vi.fn<AccountsApi["disconnectAccount"]>(),
  syncLabels: vi.fn<MailApi["syncLabels"]>(),
}));

// What the test doesn't answer replies like an unreachable main process,
// which every settings row already handles, and subscriptions are no-ops.
const { withFallback } = vi.hoisted(() => ({
  withFallback: <Api extends object>(answered: Partial<Api>): Api =>
    new Proxy(answered, {
      get: (target, key) => {
        if (key in target) {
          return Reflect.get(target, key);
        }
        return String(key).startsWith("on")
          ? () => () => {}
          : () => Promise.resolve({ error: "Unavailable", ok: false });
      },
    }) as Api,
}));

vi.mock(import("@/platform/desktop"), async (importOriginal) => {
  const accounts = withFallback<AccountsApi>({
    disconnectAccount: fakes.disconnectAccount,
  });
  const ai = withFallback<AiApi>({
    getSettings: () =>
      Promise.resolve({
        data: {
          activeProvider: "claude" as const,
          cleanupUserInstructions: "",
          providerModels: {
            claude: "claude-sonnet-5",
            codex: "gpt-5.6-luna",
            opencode: null,
          },
          providerReasoning: { claude: null, codex: "low", opencode: null },
          replyUserInstructions: "",
        },
        ok: true as const,
      }),
    listProviders: () =>
      Promise.resolve({
        data: [
          {
            authentication: "authenticated" as const,
            installed: true,
            models: [
              {
                id: "claude-sonnet-5",
                isDefault: true,
                name: "Sonnet 5",
                reasoningOptions: [],
              },
            ],
            provider: "claude" as const,
          },
          {
            authentication: "unknown" as const,
            installed: false,
            models: [],
            provider: "codex" as const,
          },
          {
            authentication: "unknown" as const,
            installed: false,
            models: [],
            provider: "opencode" as const,
          },
        ],
        ok: true as const,
      }),
  });
  const appSettings = withFallback<AppSettingsApi>({
    set: (settings) => Promise.resolve({ data: settings, ok: true as const }),
  });
  const mail = withFallback<MailApi>({
    getIndexProgress: () => Promise.resolve({ accounts: [] }),
    listLabels: () =>
      Promise.resolve({
        data: { labels: [{ id: "Label_1", name: "Travel", type: "user" }] },
        ok: true as const,
      }),
    syncLabels: fakes.syncLabels,
  });
  const capabilities: RuntimeCapabilities = {
    accounts,
    ai,
    appSettings,
    isWeb: false,
    loginItemSettings: withFallback<LoginItemSettingsApi>({}),
    mail,
    settings: withFallback<SettingsApi>({
      beginDatabaseImport: () =>
        Promise.resolve({ data: { sessionId: "import-1" }, ok: true as const }),
    }),
    updates: withFallback<UpdateApi>({}),
    versions: { app: "0.1.0", chrome: "1", electron: "2", node: "3" },
    window: withFallback<WindowApi>({}),
  };
  return {
    ...(await importOriginal()),
    getAiApi: () => capabilities.ai,
    getMailApi: () => capabilities.mail,
    getRuntimeCapabilities: () => capabilities,
  };
});

let approve = false;
const asked: string[] = [];
const agent = createAgent({
  allow: (step) => {
    if (step.confirm !== undefined) {
      asked.push(step.confirm);
    }
    return !step.confirm || approve;
  },
});

const ACCOUNTS: readonly Account[] = [
  { email: "ana@example.com", provider: "gmail" },
  { email: "bo@example.com", provider: "icloud" },
];

setPlatform("other");

const Providers = ({
  accounts = ACCOUNTS,
  children,
}: {
  readonly accounts?: readonly Account[];
  readonly children: ReactNode;
}) => (
  <ThemeProvider>
    <AccountsProvider accounts={accounts} onReorder={() => Promise.resolve()}>
      <LabelsProvider accountIds={accounts.map(({ email }) => email)}>
        <AiProviderStateProvider>
          <AppHotkeysProvider>
            <ConfirmDialogProvider>
              {children}
              <Toaster />
            </ConfirmDialogProvider>
          </AppHotkeysProvider>
        </AiProviderStateProvider>
      </LabelsProvider>
    </AccountsProvider>
  </ThemeProvider>
);

const renderSettings = async (controller = createDialogController()) => {
  const view = render(
    <Providers>
      <SettingsDialog controller={controller} />
    </Providers>
  );
  act(() => {
    controller.setOpen(true);
  });
  await act(settle);
  return { controller, view };
};

const showPage = async (page: string): Promise<void> => {
  const result = await agent.act({
    steps: [{ action: "setValue", args: [page], ref: "Sections" }],
  });
  await act(settle);
  expect(result).toMatchObject({ ok: true });
};

const namedControls = () => {
  const entries = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");
  const labels = entries.map((entry) => entry.label ?? "");
  return {
    duplicates: labels.filter(
      (label, index) => labels.indexOf(label) !== index
    ),
    labels,
    unnamed: entries
      .filter((entry) => !entry.label)
      .map((entry) => `${entry.component} ${entry.ref}`),
  };
};

const selectedTab = (): string | null =>
  screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent ??
  null;

// jsdom has no matchMedia; the theme reads the system's color scheme, and a
// search result its reduced-motion preference.
const stubMatchMedia = (): void => {
  window.matchMedia = (media: string): MediaQueryList => {
    const list = new EventTarget();
    return Object.assign(list, {
      addListener: () => {},
      matches: false,
      media,
      onchange: null,
      removeListener: () => {},
    });
  };
};

describe("settings, for an agent", () => {
  beforeAll(stubMatchMedia);

  afterEach(() => {
    approve = false;
    asked.length = 0;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("lists a page for the app's settings and for each account", async () => {
    await renderSettings();

    expect({
      dialogs: screen
        .getAllByRole("dialog")
        .map((dialog) => dialog.getAttribute("aria-modal")),
      pages: screen.getAllByRole("tab").map((tab) => tab.textContent),
      selected: selectedTab(),
      title: screen.getByRole("dialog", { name: "Settings" }).id !== "",
    }).toStrictEqual({
      dialogs: ["true"],
      pages: [
        "General",
        "AI writing",
        "Data",
        ...ACCOUNTS.map(({ email }) => email),
      ],
      selected: "General",
      title: true,
    });
  });

  it("names every setting once on each page, and an agent can change them", async () => {
    fakes.syncLabels.mockResolvedValue({
      data: { labels: [{ id: "Label_1", name: "Travel", type: "user" }] },
      ok: true,
    });
    await renderSettings();

    const pages = [
      {
        expected: [
          "Search settings",
          "Sections",
          "Close settings",
          "Add account",
          "Animations",
          "Always open threads in new windows",
        ],
        page: "general",
      },
      {
        expected: [
          "AI provider used for generation",
          "Edit Reply instructions",
          "Edit Draft cleanup instructions",
        ],
        page: "ai",
      },
      { expected: ["Keep images from opened emails, 90 days"], page: "data" },
      ...ACCOUNTS.map(({ email }) => ({
        expected: [
          `New email notifications ${email}`,
          `Edit email signature for ${email}`,
          `Create label for ${email}`,
          `Sync labels for ${email}`,
          `Edit Travel for ${email}`,
          `Delete Travel for ${email}`,
          `Sync now for ${email}`,
          `System labels ${email}`,
          `Disconnect ${email}`,
        ],
        page: `account:${email}`,
      })),
    ];
    const seen: Record<
      string,
      {
        readonly duplicates: readonly string[];
        readonly missing: readonly string[];
        readonly unnamed: readonly string[];
      }
    > = {};
    for (const { expected, page } of pages) {
      // oxlint-disable-next-line no-await-in-loop -- one page at a time
      await showPage(page);
      const { duplicates, labels, unnamed } = namedControls();
      seen[page] = {
        duplicates,
        missing: expected.filter((label) => !labels.includes(label)),
        unnamed,
      };
    }
    expect(seen).toStrictEqual(
      Object.fromEntries(
        pages.map(({ page }) => [
          page,
          { duplicates: [], missing: [], unnamed: [] },
        ])
      )
    );

    await showPage("general");
    const animations = await agent.act({
      steps: [{ action: "setChecked", args: [false], ref: "Animations" }],
    });
    await act(settle);
    expect({
      checked: screen
        .getByRole("switch", { name: "Animations" })
        .getAttribute("aria-checked"),
      ok: animations.ok,
    }).toStrictEqual({ checked: "false", ok: true });

    const result = await agent.act({
      steps: [
        {
          action: "setValue",
          args: ["account:bo@example.com"],
          ref: "Sections",
        },
        { action: "press", ref: "Sync labels for bo@example.com" },
        { action: "setValue", args: ["ai"], ref: "Sections" },
        { action: "press", ref: "Edit Reply instructions" },
        {
          action: "setValue",
          args: ["Keep it short."],
          ref: "Reply instructions",
        },
      ],
    });
    await act(settle);
    expect({
      instructions: screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply instructions",
      }).value,
      ok: result.ok,
      synced: fakes.syncLabels.mock.calls,
    }).toStrictEqual({
      instructions: "Keep it short.",
      ok: true,
      synced: [[{ accountId: "bo@example.com" }]],
    });
  });

  it("disconnects an account only once a person agrees, asking once, and stays open", async () => {
    fakes.disconnectAccount.mockResolvedValue({
      data: ACCOUNTS.slice(1),
      ok: true,
    });
    const { controller } = await renderSettings();
    await showPage("account:ana@example.com");

    const disconnect = {
      steps: [
        { action: "press", ref: "Disconnect ana@example.com" },
        { action: "press", args: ["Disconnect"], ref: "Disconnect account?" },
      ],
    };
    const refused = await agent.act(disconnect);
    await act(settle);
    expect({
      disconnected: fakes.disconnectAccount.mock.calls.length,
      ok: refused.ok,
    }).toStrictEqual({ disconnected: 0, ok: false });

    approve = true;
    asked.length = 0;
    const allowed = await agent.act({ steps: disconnect.steps.slice(1) });
    await act(settle);
    expect({
      asked: asked.map((sentence) =>
        sentence.startsWith("Disconnect account? ana@example.com:")
      ),
      disconnected: fakes.disconnectAccount.mock.calls,
      ok: allowed.ok,
      settingsOpen: controller.isOpen(),
    }).toStrictEqual({
      asked: [true],
      disconnected: [[{ email: "ana@example.com" }]],
      ok: true,
      settingsOpen: true,
    });
  });

  it("keeps Settings open when a person answers a question it asked", async () => {
    const user = userEvent.setup();
    const { controller } = await renderSettings();
    await showPage("account:ana@example.com");

    await user.click(
      screen.getByRole("button", { name: "Disconnect ana@example.com" })
    );
    await act(settle);
    // The question renders outside Settings, so the modal must not have
    // made it inert.
    const question = screen.getByRole("alertdialog", {
      name: "Disconnect account?",
    });
    const isQuestionLive = question.closest("[inert]") === null;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(settle);

    expect({
      disconnected: fakes.disconnectAccount.mock.calls.length,
      isQuestionLive,
      settingsOpen: controller.isOpen(),
    }).toStrictEqual({
      disconnected: 0,
      isQuestionLive: true,
      settingsOpen: true,
    });
  });

  it("stays open under the database import, which Escape can't close", async () => {
    const user = userEvent.setup();
    const { controller } = await renderSettings();
    await showPage("data");

    await user.click(screen.getByRole("button", { name: "Import database" }));
    await act(settle);
    const overlay = screen.getByRole("dialog", { name: "Import database" });
    await user.keyboard("{Escape}");
    await act(settle);

    expect({
      importOpen: overlay.isConnected,
      settingsOpen: controller.isOpen(),
    }).toStrictEqual({ importOpen: true, settingsOpen: true });
  });

  it("shows General once the account whose page is shown is gone", async () => {
    const controller = createDialogController();
    const { view } = await renderSettings(controller);
    await showPage("account:ana@example.com");
    expect(selectedTab()).toBe("ana@example.com");

    view.rerender(
      <Providers accounts={ACCOUNTS.slice(1)}>
        <SettingsDialog controller={controller} />
      </Providers>
    );
    await act(settle);

    expect({
      pages: screen.getAllByRole("tab").map((tab) => tab.textContent),
      selected: selectedTab(),
    }).toStrictEqual({
      pages: ["General", "AI writing", "Data", "bo@example.com"],
      selected: "General",
    });
  });

  it("reopens on the page it was left on", async () => {
    const { controller } = await renderSettings();
    await showPage("data");

    act(() => {
      controller.setOpen(false);
    });
    await act(settle);
    act(() => {
      controller.setOpen(true);
    });
    await act(settle);

    expect(selectedTab()).toBe("Data");
  });
});

const ShortcutProbe = ({ onRun }: { readonly onRun: () => void }) => {
  useAppCommand("app.searchMail", onRun);
  return null;
};

const renderWithTrigger = (
  controller: DialogController,
  onSearch = vi.fn<() => void>()
) =>
  render(
    <Providers>
      <ShortcutProbe onRun={onSearch} />
      <SidebarSettingsButton controller={controller} />
      <SettingsDialog controller={controller} />
    </Providers>
  );

describe("opening settings", () => {
  beforeAll(stubMatchMedia);

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("lists the sidebar button once, as the dialog it opens", async () => {
    const controller = createDialogController();
    renderWithTrigger(controller);
    await act(settle);

    const entries = agent
      .snapshot()
      .filter((entry) => entry.label === "Settings");
    const result = await agent.act({
      steps: [{ action: "setOpen", args: [true], ref: "Settings" }],
    });
    await act(settle);

    expect({
      components: entries.map(({ component }) => component),
      ok: result.ok,
      open: controller.isOpen(),
    }).toStrictEqual({ components: ["dialog"], ok: true, open: true });
  });

  it("opens from the sidebar, pauses the window's shortcuts, and closes back to the button", async () => {
    const user = userEvent.setup();
    const controller = createDialogController();
    const onSearch = vi.fn<() => void>();
    renderWithTrigger(controller, onSearch);
    await act(settle);

    const button = screen.getByRole("button", { name: "Settings" });
    await user.click(button);
    await act(settle);
    await user.keyboard("{Control>}k{/Control}");
    const whileOpen = onSearch.mock.calls.length;

    await user.keyboard("{Escape}");
    await act(settle);
    await user.keyboard("{Control>}k{/Control}");

    expect({
      afterClose: onSearch.mock.calls.length,
      focus: document.activeElement === button,
      open: controller.isOpen(),
      whileOpen,
    }).toStrictEqual({ afterClose: 1, focus: true, open: false, whileOpen: 0 });
  });
});

const isHighlighted = (element: Element | null): boolean =>
  element instanceof HTMLElement &&
  element.dataset.searchHighlighted !== undefined;

const searchField = (): HTMLInputElement =>
  screen.getByRole<HTMLInputElement>("combobox", { name: "Search settings" });

describe("searching settings", () => {
  beforeAll(stubMatchMedia);

  afterEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("opens on the selected page, and / or Shift+/ moves to the search", async () => {
    const user = userEvent.setup();
    const { controller } = await renderSettings();
    const startedOn = document.activeElement?.textContent;

    await user.keyboard("/");
    const afterSlash = document.activeElement === searchField();
    const typed = searchField().value;

    act(() => {
      screen.getByRole("tab", { name: "General" }).focus();
    });
    // A German layout types `/` with Shift.
    await user.keyboard("{Shift>}/{/Shift}");

    expect({
      afterShiftSlash: document.activeElement === searchField(),
      afterSlash,
      open: controller.isOpen(),
      startedOn,
      typed,
    }).toStrictEqual({
      afterShiftSlash: true,
      afterSlash: true,
      open: true,
      startedOn: "General",
      typed: "",
    });
  });

  it("leads a result to its page and its row, and lets the highlight go with focus", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.type(searchField(), "signature bo");
    await act(settle);
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    await user.keyboard("{Enter}");
    await act(settle);
    const row = document.activeElement;
    const reached = {
      highlighted: isHighlighted(row),
      query: searchField().value,
      selected: selectedTab(),
      tabsShown: screen.queryByRole("tab", { name: "General" }) !== null,
    };

    await user.tab();

    expect({
      highlightAfterLeaving: isHighlighted(row),
      options,
      reached,
    }).toStrictEqual({
      highlightAfterLeaving: false,
      options: ["Email signature bo@example.com"],
      reached: {
        highlighted: true,
        query: "",
        selected: "bo@example.com",
        tabsShown: true,
      },
    });
  });

  // Twenty-six searches, each its own render.
  it("reaches every setting it lists", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    await renderSettings();
    const targets = buildSettingsSearchIndex({
      accounts: ACCOUNTS,
      hasAi: true,
      hasAppSettings: true,
      hasLoginItem: true,
      hasMail: true,
      hasSettings: true,
      hasUpdates: true,
      hasWindow: true,
    }).filter((item) => item.target !== null);

    const missed: string[] = [];
    for (const item of targets) {
      // oxlint-disable-next-line no-await-in-loop -- one search at a time
      await user.clear(searchField());
      // oxlint-disable-next-line no-await-in-loop -- one search at a time
      await user.paste(item.title);
      // oxlint-disable-next-line no-await-in-loop -- one search at a time
      await act(settle);
      // oxlint-disable-next-line no-await-in-loop -- one search at a time
      await user.click(
        screen.getByRole("option", {
          name: `${item.title} ${getSettingsPageLabel(item.page)}`,
        })
      );
      // oxlint-disable-next-line no-await-in-loop -- one search at a time
      await act(settle);
      if (
        !isHighlighted(document.activeElement) ||
        selectedTab() !== getSettingsPageLabel(item.page)
      ) {
        missed.push(item.id);
      }
    }

    expect({ count: targets.length, missed }).toStrictEqual({
      count: 26,
      missed: [],
    });
  });

  it("says when nothing matches, and Escape clears the search before closing", async () => {
    const user = userEvent.setup();
    const { controller } = await renderSettings();

    await user.type(searchField(), "zebra");
    await act(settle);
    const empty = screen.getByText("No settings match").isConnected;
    await user.keyboard("{Escape}");
    await act(settle);
    const afterFirst = {
      open: controller.isOpen(),
      query: searchField().value,
      tabsShown: screen.queryByRole("tab", { name: "General" }) !== null,
    };
    await user.keyboard("{Escape}");
    await act(settle);

    expect({ afterFirst, empty, open: controller.isOpen() }).toStrictEqual({
      afterFirst: { open: true, query: "", tabsShown: true },
      empty: true,
      open: false,
    });
  });

  it("leaves / to a dialog Settings opened", async () => {
    const user = userEvent.setup();
    await renderSettings();
    await showPage("ai");

    await user.click(
      screen.getByRole("button", { name: "Edit Reply instructions" })
    );
    await act(settle);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    act(() => {
      cancel.focus();
    });
    await user.keyboard("/");

    expect(document.activeElement === cancel).toBeTruthy();
  });
});
