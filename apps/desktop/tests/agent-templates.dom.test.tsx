import { act, render, screen, within } from "@testing-library/react";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { ConfirmDialogProvider } from "../src/renderer/src/components/confirm-dialog";
import { TitlebarSlotContext } from "../src/renderer/src/components/shell/titlebar-slot";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import type { TemplateApi } from "../src/renderer/src/platform/desktop";
import { Route } from "../src/renderer/src/routes/templates/route";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "../src/shared/ipc/templates";

interface TemplateFakes {
  readonly delete: Mock<TemplateApi["delete"]>;
  readonly save: Mock<TemplateApi["save"]>;
  templates: readonly ComposerTemplate[];
}

const fakes = vi.hoisted((): TemplateFakes => ({
  delete: vi.fn<TemplateApi["delete"]>(),
  save: vi.fn<TemplateApi["save"]>(),
  templates: [],
}));

// The route's unsaved-changes guard needs a router; none of these steps
// leave the page.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useBlocker: (() => ({ status: "idle" })) as never,
}));

vi.mock(import("@/state/composer-templates"), async (importOriginal) => ({
  ...(await importOriginal()),
  useComposerTemplates: () => ({
    isLoading: false,
    templates: fakes.templates,
  }),
}));

vi.mock(import("@/platform/desktop"), async (importOriginal) => {
  const templateApi: Pick<TemplateApi, "delete" | "save"> = {
    delete: fakes.delete,
    save: fakes.save,
  };
  return {
    ...(await importOriginal()),
    getTemplateApi: () => templateApi as TemplateApi,
  };
});

let approve = false;
const agent = createAgent({ allow: (step) => !step.confirm || approve });

const template = (id: string, name: string): ComposerTemplate => ({
  accountId: null,
  bcc: [],
  body: { html: `<p>Hello from ${name}</p>`, text: `Hello from ${name}` },
  cc: [],
  createdAt: 1,
  id,
  name,
  subject: `${name} subject`,
  to: [],
  updatedAt: 1,
});

const onPage = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

const renderTemplates = () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  const TemplatesPage = Route.options.component;
  if (TemplatesPage === undefined) {
    throw new Error("The templates route has no component");
  }
  render(
    <AccountsProvider
      accounts={[{ email: "ana@example.com", provider: "gmail" }]}
      onReorder={() => Promise.resolve()}
    >
      <AppHotkeysProvider>
        <ConfirmDialogProvider>
          <TitlebarSlotContext.Provider value={slot}>
            <TemplatesPage />
          </TitlebarSlotContext.Provider>
        </ConfirmDialogProvider>
      </AppHotkeysProvider>
    </AccountsProvider>
  );
};

describe("templates, for an agent", () => {
  beforeEach(() => {
    fakes.templates = [template("t1", "Follow up"), template("t2", "Welcome")];
    fakes.save.mockImplementation((input: ComposerTemplateInput) =>
      Promise.resolve({
        data: { ...input, createdAt: 1, updatedAt: 2 },
        ok: true as const,
      })
    );
    fakes.delete.mockResolvedValue({ data: undefined, ok: true });
  });

  afterEach(() => {
    approve = false;
    fakes.save.mockReset();
    fakes.delete.mockReset();
    document.body.replaceChildren();
  });

  it("names every control, and an agent can open, rename and save a template", async () => {
    renderTemplates();
    await act(settle);

    const opened = await agent.act({
      steps: [{ action: "press", ref: "Welcome" }],
    });
    await act(settle);
    const entries = onPage();
    const labels = entries.map((entry) => entry.label);
    expect({
      duplicates: labels.filter(
        (label, index) => labels.indexOf(label) !== index
      ),
      ok: opened.ok,
      unnamed: entries
        .filter((entry) => !entry.label)
        .map((entry) => `${entry.component} ${entry.ref}`),
    }).toStrictEqual({ duplicates: [], ok: true, unnamed: [] });
    expect(labels).toStrictEqual(
      expect.arrayContaining([
        "New template",
        "Search templates",
        "Follow up",
        "Welcome",
        "Name",
        "Save",
        "Delete template",
        "To",
      ])
    );
    expect(
      screen
        .getByRole("button", { name: "Welcome" })
        .getAttribute("aria-current")
    ).toBe("true");

    const saved = await agent.act({
      steps: [
        { action: "setValue", args: ["Welcome back"], ref: "Name" },
        { action: "press", ref: "Save" },
      ],
    });
    await act(settle);
    expect({
      ok: saved.ok,
      saved: fakes.save.mock.calls.map(([input]) => [input.id, input.name]),
    }).toStrictEqual({ ok: true, saved: [["t2", "Welcome back"]] });
  });

  it("finds templates by the search field", async () => {
    renderTemplates();
    await act(settle);

    const searched = await agent.act({
      steps: [
        { action: "setValue", args: ["follow"], ref: "Search templates" },
      ],
    });
    await act(settle);
    expect({
      ok: searched.ok,
      templates: screen
        .getAllByRole("listitem")
        .map((item) => within(item).getByRole("button").ariaLabel),
    }).toStrictEqual({
      ok: true,
      templates: ["Follow up"],
    });
  });

  it("deletes a template only once a person agrees", async () => {
    renderTemplates();
    await act(settle);
    await agent.act({ steps: [{ action: "press", ref: "Follow up" }] });
    await act(settle);

    const remove = {
      steps: [
        { action: "press", ref: "Delete template" },
        { action: "press", ref: "Delete forever" },
      ],
    };
    const refused = await agent.act(remove);
    await act(settle);
    expect({
      deleted: fakes.delete.mock.calls.length,
      ok: refused.ok,
    }).toStrictEqual({ deleted: 0, ok: false });

    approve = true;
    const allowed = await agent.act({ steps: remove.steps.slice(1) });
    await act(settle);
    expect({
      deleted: fakes.delete.mock.calls,
      ok: allowed.ok,
    }).toStrictEqual({ deleted: [[{ templateId: "t1" }]], ok: true });
  });
});
