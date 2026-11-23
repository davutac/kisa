import { act, render, screen } from "@testing-library/react";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { ConfirmDialogProvider } from "../src/renderer/src/components/confirm-dialog";
import { ThemeProvider } from "../src/renderer/src/components/shell/theme-provider";
import { TitlebarSlotContext } from "../src/renderer/src/components/shell/titlebar-slot";
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
import { Route } from "../src/renderer/src/routes/settings/route";
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
    settings: withFallback<SettingsApi>({}),
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

const renderSettings = () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  const SettingsPage = Route.options.component;
  if (SettingsPage === undefined) {
    throw new Error("The settings route has no component");
  }
  render(
    <ThemeProvider>
      <AccountsProvider accounts={ACCOUNTS} onReorder={() => Promise.resolve()}>
        <LabelsProvider accountIds={ACCOUNTS.map(({ email }) => email)}>
          <AiProviderStateProvider>
            <AppHotkeysProvider>
              <ConfirmDialogProvider>
                <TitlebarSlotContext.Provider value={slot}>
                  <SettingsPage />
                </TitlebarSlotContext.Provider>
              </ConfirmDialogProvider>
            </AppHotkeysProvider>
          </AiProviderStateProvider>
        </LabelsProvider>
      </AccountsProvider>
    </ThemeProvider>
  );
};

describe("settings, for an agent", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the theme reads the system's color scheme.
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
  });

  afterEach(() => {
    approve = false;
    asked.length = 0;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("names every setting once across two accounts, and an agent can change them", async () => {
    fakes.syncLabels.mockResolvedValue({
      data: { labels: [{ id: "Label_1", name: "Travel", type: "user" }] },
      ok: true,
    });
    renderSettings();
    await act(settle);

    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    const labels = entries.map((entry) => entry.label);
    expect({
      duplicates: labels.filter(
        (label, index) => labels.indexOf(label) !== index
      ),
      unnamed: entries
        .filter((entry) => !entry.label)
        .map((entry) => `${entry.component} ${entry.ref}`),
    }).toStrictEqual({ duplicates: [], unnamed: [] });
    expect(labels).toStrictEqual(
      expect.arrayContaining([
        "Animations",
        "Always open threads in new windows",
        "Keep images from opened emails, 90 days",
        "AI provider used for generation",
        "Edit Reply instructions",
        "Edit Draft cleanup instructions",
        ...ACCOUNTS.flatMap(({ email }) => [
          `New email notifications ${email}`,
          `Edit email signature for ${email}`,
          `Create label for ${email}`,
          `Sync labels for ${email}`,
          `Edit Travel for ${email}`,
          `Delete Travel for ${email}`,
          `Sync now for ${email}`,
          `System labels ${email}`,
          `Disconnect ${email}`,
        ]),
      ])
    );

    const result = await agent.act({
      steps: [
        { action: "setChecked", args: [false], ref: "Animations" },
        { action: "press", ref: "Sync labels for bo@example.com" },
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
      animations: screen
        .getByRole("switch", { name: "Animations" })
        .getAttribute("aria-checked"),
      instructions: screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply instructions",
      }).value,
      ok: result.ok,
      synced: fakes.syncLabels.mock.calls,
    }).toStrictEqual({
      animations: "false",
      instructions: "Keep it short.",
      ok: true,
      synced: [[{ accountId: "bo@example.com" }]],
    });
  });

  it("disconnects an account only once a person agrees, asking once", async () => {
    fakes.disconnectAccount.mockResolvedValue({
      data: ACCOUNTS.slice(1),
      ok: true,
    });
    renderSettings();
    await act(settle);

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
    }).toStrictEqual({
      asked: [true],
      disconnected: [[{ email: "ana@example.com" }]],
      ok: true,
    });
  });
});
