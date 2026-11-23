import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AccountSetupApp from "../src/renderer/src/account-setup/account-setup-app";
import { SendWithScheduleMenu } from "../src/renderer/src/components/mail/schedule-send-menu";
import MailThreadItem from "../src/renderer/src/components/mail/thread-item";
import AiInstructionsDialog from "../src/renderer/src/components/settings/ai-instructions-dialog";
import AiProviderRow from "../src/renderer/src/components/settings/ai-provider-row";
import SettingsAccountCategorizationRow from "../src/renderer/src/components/settings/settings-account-categorization-row";
import SettingsAccountNotificationsRow from "../src/renderer/src/components/settings/settings-account-notifications-row";
import SettingsAccountSystemLabelsRow from "../src/renderer/src/components/settings/settings-account-system-labels-row";
import { Button } from "../src/renderer/src/components/ui/button";
import {
  Field,
  FieldError,
  FieldLabel,
} from "../src/renderer/src/components/ui/field";
import { Input } from "../src/renderer/src/components/ui/input";
import { Label } from "../src/renderer/src/components/ui/label";
import { createMenuController } from "../src/renderer/src/components/ui/menu";
import { RadioGroup } from "../src/renderer/src/components/ui/radio";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRows,
  SettingsRowTitle,
} from "../src/renderer/src/components/ui/settings";
import { Switch } from "../src/renderer/src/components/ui/switch";
import type { SettingsApi } from "../src/renderer/src/platform/desktop";
import TemplatesSidebar from "../src/renderer/src/routes/templates/-components/templates-sidebar";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import { AiProviderStateProvider } from "../src/renderer/src/state/ai-provider-state";
import { LabelsProvider } from "../src/renderer/src/state/labels";
import type { AccountSetupBridge } from "../src/shared/ipc/account-setup";
import type { Account } from "../src/shared/ipc/accounts";
import type { AiProvider, AiProviderStatus } from "../src/shared/ipc/ai";
import type { MailThreadSummary } from "../src/shared/ipc/mail";
import { InMailList } from "./fixtures/mail-list";

// The Add account window's preload declares this; the test program doesn't
// include preload declarations.
declare global {
  interface Window {
    accountSetup?: AccountSetupBridge;
  }
}

const agent = createAgent();

const namedComponents = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

const unnamedComponents = (): string[] =>
  namedComponents()
    .filter((entry) => !entry.label)
    .map((entry) => `${entry.component} ${entry.ref}`);

const snapshotLabels = (): string[] =>
  namedComponents().map((entry) => entry.label ?? "");

const refsFor = (label: string): string[] =>
  namedComponents()
    .filter((entry) => entry.label === label)
    .map((entry) => entry.ref);

// A stand-in typed by the test, never a real credential.
const FAKE_PASSWORD = "fake-app-password-for-tests";

const installAccountSetupBridge = () => {
  const bridge = {
    cancelMicrosoftSignIn: vi.fn<AccountSetupBridge["cancelMicrosoftSignIn"]>(
      () => Promise.resolve()
    ),
    close: vi.fn<AccountSetupBridge["close"]>(() => Promise.resolve()),
    lookupMailDomain: vi.fn<AccountSetupBridge["lookupMailDomain"]>(() =>
      Promise.resolve({ data: null, ok: true })
    ),
    signInWithMicrosoft: vi.fn<AccountSetupBridge["signInWithMicrosoft"]>(() =>
      Promise.resolve({ data: undefined, ok: true })
    ),
    submit: vi.fn<AccountSetupBridge["submit"]>(() =>
      Promise.resolve({ data: undefined, ok: true })
    ),
  } satisfies AccountSetupBridge;
  window.accountSetup = bridge;
  return bridge;
};

// The fake bridge knows no provider for the domain, so servers are asked.
const showServerFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(
    screen.getByRole("textbox", { name: "Email address" }),
    "ada@example.org"
  );
  return screen.findAllByRole(
    "combobox",
    { name: "Security" },
    { timeout: 2000 }
  );
};

const getPorts = () =>
  screen.getAllByRole<HTMLInputElement>("textbox", { name: "Port" });

describe("the Add account window", () => {
  afterEach(() => {
    delete window.accountSetup;
  });

  it("names every field, lets an agent fill them, and sends the same sign-in", async () => {
    const user = userEvent.setup();
    const bridge = installAccountSetupBridge();
    render(<AccountSetupApp />);
    await showServerFields(user);

    expect(unnamedComponents()).toStrictEqual([]);
    expect(snapshotLabels()).toStrictEqual(
      expect.arrayContaining([
        "Name",
        "Email address",
        "App password",
        "Server",
        "Port",
        "Security",
      ])
    );

    const [imapServer = "", smtpServer = ""] = refsFor("Server");
    const [imapSecurity = ""] = refsFor("Security");
    const result = await agent.act({
      steps: [
        { action: "setValue", args: ["Ada Lovelace"], ref: "Name" },
        { action: "setValue", args: [FAKE_PASSWORD], ref: "App password" },
        { action: "setValue", args: ["imap.example.org"], ref: imapServer },
        { action: "setValue", args: ["smtp.example.org"], ref: smtpServer },
        { action: "setValue", args: ["STARTTLS"], ref: imapSecurity },
      ],
    });
    await act(settle);
    const password = screen.getByLabelText<HTMLInputElement>("App password");

    // The agent may fill the password but never read it back.
    expect({
      autocomplete: password.autocomplete,
      imapPort: getPorts()[0]?.value,
      leaksInSnapshot: JSON.stringify(agent.snapshot()).includes(FAKE_PASSWORD),
      leaksInValues: JSON.stringify(result.values).includes(FAKE_PASSWORD),
      ok: result.ok,
      type: password.type,
    }).toStrictEqual({
      autocomplete: "off",
      imapPort: "143",
      leaksInSnapshot: false,
      leaksInValues: false,
      ok: true,
      type: "password",
    });

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(bridge.submit).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.org",
      name: "Ada Lovelace",
      password: FAKE_PASSWORD,
      servers: {
        imap: expect.objectContaining({
          host: "imap.example.org",
          security: "starttls",
        }),
        smtp: expect.objectContaining({
          host: "smtp.example.org",
          security: "starttls",
        }),
      },
    });
  });

  it("marks the first problem invalid, describes it, and moves focus there", async () => {
    const user = userEvent.setup();
    installAccountSetupBridge();
    render(<AccountSetupApp />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const email = screen.getByRole("textbox", { name: "Email address" });
    expect({
      alert: screen.getByRole("alert").textContent,
      describedBy: email.getAttribute("aria-describedby"),
      fieldInvalid:
        email.closest<HTMLElement>("[data-slot=field]")?.dataset.invalid,
      focused: document.activeElement === email,
      invalid: email.getAttribute("aria-invalid"),
      nameInvalid: screen
        .getByRole("textbox", { name: "Name" })
        .getAttribute("aria-invalid"),
    }).toStrictEqual({
      alert: "Enter your email address.",
      describedBy: expect.stringContaining("account-setup-problem"),
      fieldInvalid: "",
      focused: true,
      invalid: "true",
      nameInvalid: null,
    });

    await showServerFields(user);
    const password = screen.getByLabelText("App password");
    expect({
      alert: screen.getByRole("alert").textContent,
      emailInvalid: email.getAttribute("aria-invalid"),
      passwordInvalid: password.getAttribute("aria-invalid"),
    }).toStrictEqual({
      alert: "Enter the app password.",
      emailInvalid: null,
      passwordInvalid: "true",
    });

    await user.type(password, FAKE_PASSWORD);
    expect(password.getAttribute("aria-invalid")).toBeNull();
  });

  it("chooses a security mode by pointer and keyboard, keeping focus on it", async () => {
    const user = userEvent.setup();
    installAccountSetupBridge();
    render(<AccountSetupApp />);
    const [imapSecurity] = await showServerFields(user);
    const trigger = imapSecurity ?? document.body;

    await user.click(trigger);
    await act(settle);
    await user.click(screen.getByRole("option", { name: "STARTTLS" }));
    await act(settle);
    expect({
      focused: document.activeElement === trigger,
      port: getPorts()[0]?.value,
      security: trigger.textContent,
    }).toStrictEqual({ focused: true, port: "143", security: "STARTTLS" });

    await user.keyboard("{Enter}");
    await act(settle);
    await user.keyboard("{ArrowUp}{Enter}");
    await act(settle);
    expect({
      focused: document.activeElement === trigger,
      port: getPorts()[0]?.value,
      security: trigger.textContent,
    }).toStrictEqual({ focused: true, port: "993", security: "SSL/TLS" });
  });

  it("closes an open security list on Escape before the window", async () => {
    const user = userEvent.setup();
    const bridge = installAccountSetupBridge();
    render(<AccountSetupApp />);
    const [, smtpSecurity] = await showServerFields(user);
    const trigger = smtpSecurity ?? document.body;

    await user.click(trigger);
    await act(settle);
    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      closedWindow: bridge.close.mock.calls.length,
      expanded: trigger.getAttribute("aria-expanded"),
    }).toStrictEqual({ closedWindow: 0, expanded: "false" });

    await user.keyboard("{Escape}");
    expect(bridge.close).toHaveBeenCalledOnce();
  });

  it("lists the switch under the address for agents, which can press it", async () => {
    const user = userEvent.setup();
    const bridge = installAccountSetupBridge();
    bridge.lookupMailDomain.mockResolvedValue({ data: "gmail", ok: true });
    render(<AccountSetupApp />);
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "ada@example.org"
    );
    await screen.findByRole(
      "button",
      { name: "Enter server settings instead" },
      { timeout: 2000 }
    );
    expect(snapshotLabels()).toContain("Enter server settings instead");

    const result = await agent.act({
      steps: [{ action: "press", ref: "Enter server settings instead" }],
    });
    await act(settle);
    expect({
      ok: result.ok,
      servers: screen.getAllByRole("textbox", { name: "Server" }).length,
      switchBack: screen.queryByRole("button", {
        name: /settings instead$/u,
      })?.textContent,
    }).toStrictEqual({
      ok: true,
      servers: 2,
      switchBack: "Use Gmail settings instead",
    });
  });
});

const THREAD: MailThreadSummary = {
  accountId: "person@example.com",
  attachments: [],
  from: "Ada Lovelace <ada@example.com>",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt: new Date(2026, 0, 2, 9, 30).getTime(),
  messageCount: 1,
  snippet: "Notes on the engine",
  subject: "Analytical engine",
  threadId: "thread-1",
};

const renderThreadRow = () => {
  const onActivate = vi.fn<() => void>();
  const onCheckedChange = vi.fn<(checked: string[]) => void>();
  const onToggleSelection = vi.fn<() => void>();
  render(
    <AccountsProvider accounts={[]} onReorder={vi.fn<() => Promise<void>>()}>
      <LabelsProvider accountIds={[]}>
        <InMailList
          checkable
          onActivate={onActivate}
          onCheckedChange={onCheckedChange}
          rowKey={`${THREAD.accountId}:${THREAD.threadId}`}
        >
          <MailThreadItem
            isSelected
            onToggleSelection={onToggleSelection}
            thread={THREAD}
            top={0}
          />
        </InMailList>
      </LabelsProvider>
    </AccountsProvider>
  );
  return {
    checkbox: screen.getByRole("checkbox", {
      name: "Select Analytical engine",
    }),
    onActivate,
    onCheckedChange,
    onToggleSelection,
  };
};

describe("a conversation row's selection checkbox", () => {
  it("leaves a mouse click to pointer-down, so the click doesn't toggle again", async () => {
    const user = userEvent.setup();
    const { checkbox, onActivate, onCheckedChange, onToggleSelection } =
      renderThreadRow();

    await user.click(checkbox);

    expect({
      opened: onActivate.mock.calls.length,
      painted: onCheckedChange.mock.calls,
      toggles: onToggleSelection.mock.calls.length,
    }).toStrictEqual({
      opened: 0,
      painted: [
        [[`${THREAD.accountId}:${THREAD.threadId}`], expect.anything()],
      ],
      toggles: 0,
    });
  });

  it("toggles once on Space and once for an agent", async () => {
    const user = userEvent.setup();
    const { checkbox, onCheckedChange, onToggleSelection } = renderThreadRow();

    checkbox.focus();
    await user.keyboard(" ");
    expect(onToggleSelection).toHaveBeenCalledOnce();

    expect(snapshotLabels()).toContain("Select Analytical engine");
    const result = await agent.act({
      steps: [
        {
          action: "setChecked",
          args: [true],
          ref: "Select Analytical engine",
        },
      ],
    });
    expect({
      ok: result.ok,
      painted: onCheckedChange.mock.calls.length,
      toggles: onToggleSelection.mock.calls.length,
    }).toStrictEqual({ ok: true, painted: 0, toggles: 2 });
  });
});

const ACCOUNTS: Account[] = [
  { displayName: "Work", email: "ada@work.example", provider: "gmail" },
  { displayName: "Personal", email: "ada@home.example", provider: "icloud" },
];

const ACCOUNT_SWITCHES = [
  {
    field: "notificationsEnabled",
    initial: true,
    row: "New email notifications",
  },
  {
    field: "categorizationEnabled",
    initial: false,
    row: "Automatic categorization",
  },
  { field: "showSystemLabels", initial: true, row: "System labels" },
] as const;

const notUsed = () => Promise.reject(new Error("Not used by these rows"));

const createSettingsApi = () => {
  const updateAccountSettings = vi.fn<SettingsApi["updateAccountSettings"]>(
    () => Promise.resolve({ data: [], ok: true })
  );
  const settingsApi: SettingsApi = {
    beginDatabaseImport: notUsed,
    cancelDatabaseImport: notUsed,
    discardDatabaseImport: notUsed,
    dropDatabaseImportFile: notUsed,
    exportDatabaseRecoveryKey: notUsed,
    getDatabaseImportStatus: notUsed,
    importDatabase: notUsed,
    listAccountSettings: notUsed,
    onAccountSettingsChanged: () => () => {},
    onDatabaseImportProgress: () => () => {},
    restartForDatabaseImport: notUsed,
    selectDatabaseImportFile: notUsed,
    updateAccountSettings,
  };
  return { settingsApi, updateAccountSettings };
};

// Mirrors SettingsAccountSection, whose heading id each row's switch names.
const renderAccountRows = (settingsApi: SettingsApi) =>
  render(
    <AiProviderStateProvider>
      {ACCOUNTS.map((account) => (
        <section key={account.email}>
          <h2 id={`account-${account.email}-title`}>{account.displayName}</h2>
          <SettingsRows>
            <SettingsAccountNotificationsRow
              account={account}
              settingsApi={settingsApi}
            />
            <SettingsAccountCategorizationRow
              account={account}
              settingsApi={settingsApi}
            />
            <SettingsAccountSystemLabelsRow
              account={account}
              settingsApi={settingsApi}
            />
          </SettingsRows>
        </section>
      ))}
    </AiProviderStateProvider>
  );

const SWITCH_NAMES = ACCOUNTS.flatMap((account) =>
  ACCOUNT_SWITCHES.map(({ row }) => `${row} ${account.displayName}`)
);

// Mirrors the settings page's app-wide rows, which name a switch by its title.
const AnimationsRow = ({
  onChange,
}: {
  onChange: (checked: boolean) => void;
}) => {
  const [checked, setChecked] = useState(true);
  return (
    <SettingsRows>
      <SettingsRow>
        <SettingsRowContent>
          <SettingsRowTitle id="animations-title">Animations</SettingsRowTitle>
        </SettingsRowContent>
        <SettingsRowActions>
          <Switch
            aria-labelledby="animations-title"
            checked={checked}
            onCheckedChange={(next) => {
              setChecked(next);
              onChange(next);
            }}
          />
        </SettingsRowActions>
      </SettingsRow>
    </SettingsRows>
  );
};

describe("settings switches", () => {
  it("names each account's switches by row and account, once each", () => {
    renderAccountRows(createSettingsApi().settingsApi);

    expect(unnamedComponents()).toStrictEqual([]);
    expect(
      snapshotLabels().filter((label) => SWITCH_NAMES.includes(label))
    ).toStrictEqual(SWITCH_NAMES);
  });

  it("saves each switch on Space, for its own account", async () => {
    const user = userEvent.setup();
    const { settingsApi, updateAccountSettings } = createSettingsApi();
    renderAccountRows(settingsApi);

    for (const name of SWITCH_NAMES) {
      screen.getByRole("switch", { name }).focus();
      // A person presses one switch at a time, and each save settles first.
      // oxlint-disable-next-line no-await-in-loop
      await user.keyboard(" ");
      // oxlint-disable-next-line no-await-in-loop
      await act(settle);
    }

    expect(
      updateAccountSettings.mock.calls.map(([request]) => request)
    ).toStrictEqual(
      ACCOUNTS.flatMap((account) =>
        ACCOUNT_SWITCHES.map(({ field, initial }) => ({
          accountId: account.email,
          [field]: !initial,
        }))
      )
    );
  });

  it("saves a switch an agent turns off", async () => {
    const { settingsApi, updateAccountSettings } = createSettingsApi();
    renderAccountRows(settingsApi);

    const result = await agent.act({
      steps: [
        {
          action: "setChecked",
          args: [false],
          ref: "New email notifications Personal",
        },
      ],
    });
    await act(settle);

    expect(result).toMatchObject({ ok: true });
    expect(updateAccountSettings).toHaveBeenCalledExactlyOnceWith({
      accountId: "ada@home.example",
      notificationsEnabled: false,
    });
  });

  it("names an app-wide switch by its row title and keeps it in sync", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(checked: boolean) => void>();
    render(<AnimationsRow onChange={onChange} />);
    const animations = screen.getByRole("switch", { name: "Animations" });

    animations.focus();
    await user.keyboard(" ");
    expect(animations.getAttribute("aria-checked")).toBe("false");

    const result = await agent.act({
      steps: [{ action: "setChecked", args: [true], ref: "Animations" }],
    });
    expect(result).toMatchObject({ ok: true });
    expect(onChange.mock.calls.map(([checked]) => checked)).toStrictEqual([
      false,
      true,
    ]);
  });
});

const PROVIDER_STATUSES = {
  claude: {
    authentication: "authenticated",
    installed: true,
    models: [
      {
        id: "claude-haiku-4-5",
        isDefault: true,
        name: "Haiku 4.5",
        reasoningOptions: [],
      },
    ],
    provider: "claude",
  },
  codex: {
    authentication: "authenticated",
    installed: true,
    models: [
      {
        id: "gpt-5.6-luna",
        isDefault: true,
        name: "GPT-5.6 Luna",
        reasoningOptions: [],
      },
    ],
    provider: "codex",
  },
} satisfies Partial<Record<AiProvider, AiProviderStatus>>;

// Mirrors SettingsAiSection's group around its provider rows.
const AiProviders = ({
  onChange,
}: {
  onChange: (provider: AiProvider) => void;
}) => {
  const [active, setActive] = useState<AiProvider | null>(null);
  return (
    <RadioGroup
      aria-label="AI provider used for generation"
      onValueChange={(provider) => {
        if (provider !== null) {
          setActive(provider);
          onChange(provider);
        }
      }}
      value={active}
    >
      {(["codex", "claude"] as const).map((provider) => (
        <AiProviderRow
          activeProvider={active}
          currentModel={PROVIDER_STATUSES[provider].models[0]?.id ?? null}
          currentReasoning={null}
          isLoading={false}
          key={provider}
          onSelectModel={() => {}}
          onSelectReasoning={() => {}}
          provider={provider}
          status={PROVIDER_STATUSES[provider]}
        />
      ))}
    </RadioGroup>
  );
};

describe("the AI provider radios", () => {
  it("names each radio by its provider and chooses with the pointer, arrows and an agent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(provider: AiProvider) => void>();
    render(<AiProviders onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Claude" }));
    await user.keyboard("{ArrowUp}");
    expect(
      screen.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")
    ).toBe("true");

    const group = namedComponents().find(
      (entry) => entry.label === "AI provider used for generation"
    );
    expect(group?.items?.map((item) => item.label)).toStrictEqual([
      "Codex",
      "Claude",
    ]);
    const result = await agent.act({
      steps: [
        {
          action: "setValue",
          args: ["Claude"],
          ref: "AI provider used for generation",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    expect(onChange.mock.calls.map(([provider]) => provider)).toStrictEqual([
      "claude",
      "codex",
      "claude",
    ]);
  });
});

const TemplatesSearch = ({
  onQueryChange,
}: {
  onQueryChange: (query: string) => void;
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  return (
    <TemplatesSidebar
      isLoading={false}
      onQueryChange={onQueryChange}
      onSelect={() => {}}
      query=""
      searchInputRef={searchInputRef}
      templates={[]}
    />
  );
};

describe("text fields", () => {
  it("edits AI instructions in their dialog's textarea and saves the trimmed text", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(instructions: string) => void>();
    render(
      <AiInstructionsDialog
        description="Set user instructions for writing replies."
        onSave={onSave}
        placeholder="Write like a person."
        title="Reply instructions"
        value="Be brief."
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Edit Reply instructions" })
    );
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Reply instructions",
    });
    expect(textarea.value).toBe("Be brief.");
    await user.type(textarea, " Sign as Ada.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(
      screen.getByRole("button", { name: "Edit Reply instructions" })
    );
    // The dialog shares the name, but only the textarea takes setValue.
    const result = await agent.act({
      steps: [
        {
          action: "setValue",
          args: ["  Answer in French.  "],
          ref: "Reply instructions",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      onSave.mock.calls.map(([instructions]) => instructions)
    ).toStrictEqual(["Be brief. Sign as Ada.", "Answer in French."]);
  });

  it("names a field from a hidden or visible label", async () => {
    render(
      <>
        <Label className="sr-only" htmlFor="confirm-text">
          Enter the confirmation text
        </Label>
        <Input id="confirm-text" />
        <Label htmlFor="label-name">Label name</Label>
        <Input id="label-name" />
      </>
    );

    expect(snapshotLabels()).toStrictEqual(
      expect.arrayContaining(["Enter the confirmation text", "Label name"])
    );
    const result = await agent.act({
      steps: [{ action: "setValue", args: ["Receipts"], ref: "Label name" }],
    });
    expect(result).toMatchObject({ ok: true });
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Label name" })
        .value
    ).toBe("Receipts");
  });

  it("shows a required field's error after an empty submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<() => void>();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Field>
          <FieldLabel>Template name</FieldLabel>
          <Input required />
          <FieldError match="valueMissing">Name the template.</FieldError>
        </Field>
        <Button type="submit">Save template</Button>
      </form>
    );
    const name = screen.getByRole("textbox", { name: "Template name" });
    expect(screen.queryByText("Name the template.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save template" }));
    await act(settle);
    expect({
      error: screen.queryByText("Name the template.")?.textContent,
      fieldInvalid:
        name.closest<HTMLElement>("[data-slot=field]")?.dataset.invalid,
      invalid: name.getAttribute("aria-invalid"),
      submits: onSubmit.mock.calls.length,
    }).toStrictEqual({
      error: "Name the template.",
      fieldInvalid: "",
      invalid: "true",
      submits: 0,
    });

    await user.type(name, "Weekly update");
    await act(settle);
    expect(screen.queryByText("Name the template.")).toBeNull();
  });

  it("focuses the templates search from its icon and leaves the ring to the group", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn<(query: string) => void>();
    const { container } = render(
      <TemplatesSearch onQueryChange={onQueryChange} />
    );
    const group =
      container.querySelector<HTMLElement>("[data-slot=input-group]") ??
      document.body;
    const search = within(group).getByRole("searchbox");

    await user.click(group.querySelector("svg") ?? group);
    expect({
      focused: document.activeElement === search,
      groupRing: group.className.includes(
        "has-[[data-slot=input]:focus-visible]:ring-2"
      ),
      inputRing: search.className.includes("focus-visible:ring-2"),
    }).toStrictEqual({ focused: true, groupRing: true, inputRing: false });

    const name = search.getAttribute("aria-label") ?? "";
    expect(snapshotLabels()).toContain(name);
    const result = await agent.act({
      steps: [{ action: "setValue", args: ["Invoice"], ref: name }],
    });
    expect(result).toMatchObject({ ok: true });
    expect(onQueryChange).toHaveBeenLastCalledWith("Invoice");
  });
});

describe("the custom send time dialog", () => {
  it("names its date and time fields, and marks both invalid together", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn<(scheduledAt: number) => void>();
    render(
      <SendWithScheduleMenu
        controller={createMenuController()}
        disabled={false}
        onChoose={onChoose}
        selectedScheduledAt={undefined}
      >
        <Button type="button">Send</Button>
      </SendWithScheduleMenu>
    );
    await user.click(screen.getByRole("button", { name: "Schedule send" }));
    await act(settle);
    await user.click(
      screen.getByRole("menuitem", { name: "Pick date & time" })
    );
    await act(settle);
    const date = screen.getByRole("textbox", { name: "Date" });
    const time = screen.getByRole("group", { name: "Time" });
    const initialTime = time.querySelector<HTMLInputElement>(
      '[data-slot="time-input-hidden-input"]'
    )?.value;
    expect(snapshotLabels()).toStrictEqual(
      expect.arrayContaining(["Date", "Time"])
    );

    await agent.act({ steps: [{ action: "clear", ref: "Time" }] });
    await act(settle);
    await user.click(screen.getByRole("button", { name: "Use this time" }));
    expect({
      alertId: screen.getByRole("alert").id,
      dateDescribedBy: date.getAttribute("aria-describedby"),
      dateFieldInvalid:
        date.closest<HTMLElement>("[data-slot=field]")?.dataset.invalid,
      dateInvalid: date.getAttribute("aria-invalid"),
      timeDescribedBy: time.getAttribute("aria-describedby"),
      timeFieldInvalid:
        time.closest<HTMLElement>("[data-slot=field]")?.dataset.invalid,
      timeInvalid: time.getAttribute("aria-invalid"),
    }).toStrictEqual({
      alertId: "scheduled-send-time-error",
      dateDescribedBy: expect.stringContaining("scheduled-send-time-error"),
      dateFieldInvalid: "",
      dateInvalid: "true",
      timeDescribedBy: expect.stringContaining("scheduled-send-time-error"),
      timeFieldInvalid: "",
      timeInvalid: "true",
    });

    const result = await agent.act({
      steps: [{ action: "setValue", args: [initialTime], ref: "Time" }],
    });
    expect(result).toMatchObject({ ok: true });
    await user.click(screen.getByRole("button", { name: "Use this time" }));
    expect(onChoose).toHaveBeenCalledOnce();
  });
});
