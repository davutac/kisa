import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import type { EditorChange } from "@ui-sdk/react/trigger-menu";
import { createRef, useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CleanDraftVersion } from "../src/renderer/src/components/mail/clean-draft-history";
import CleanDraftHistoryStrip from "../src/renderer/src/components/mail/clean-draft-history-strip";
import EmailComposer from "../src/renderer/src/components/mail/email-composer";
import EmailRecipientFields from "../src/renderer/src/components/mail/email-recipient-fields";
import type { EmailRecipients } from "../src/renderer/src/components/mail/email-recipient-fields";
import { OutgoingAttachmentList } from "../src/renderer/src/components/mail/outgoing-attachments";
import type { ComposerFocusHandle } from "../src/renderer/src/components/mail/use-composer-focus";
import { createTiptapTextAdapter } from "../src/renderer/src/editor/tiptap-text-adapter";
import {
  AppHotkeysProvider,
  useAppCommand,
  useHotkeyLayer,
} from "../src/renderer/src/hotkeys";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "../src/shared/ipc/templates";

// ProseMirror measures carets through ranges, which jsdom can't lay out.
Range.prototype.getClientRects = () =>
  Object.assign([] as DOMRect[], { item: (): DOMRect | null => null });
Range.prototype.getBoundingClientRect = () => new DOMRect();

const agent = createAgent();

const snapshot = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

const labels = () => snapshot().map((entry) => entry.label ?? "");

const ComposerLayer = ({ onClose }: { onClose: () => void }) => {
  useHotkeyLayer("composer", true);
  useAppCommand("composer.close", onClose);
  return null;
};

const editorOf = (element: HTMLElement): Editor =>
  (element as HTMLElement & { editor: Editor }).editor;

const editorIn = (name: string): Editor =>
  editorOf(screen.getByRole("textbox", { name }));

// jsdom gives contenteditable no text input, so typing is the transaction
// ProseMirror's input handling would dispatch for each character.
const typeInto = async (editor: Editor, text: string) => {
  await act(() => {
    const { view } = editor;
    for (const character of text) {
      view.dispatch(view.state.tr.insertText(character));
    }
  });
  await act(settle);
};

const focusEnd = async (editor: Editor) => {
  await act(() => {
    editor.commands.focus("end");
  });
  await waitFor(() => expect(editor.view.hasFocus()).toBeTruthy());
};

const optionNames = () =>
  screen
    .queryAllByRole("option")
    .map(
      (option) =>
        `${option.textContent ?? ""}${Object.hasOwn(option.dataset, "highlighted") ? " *" : ""}`
    );

const template = (
  id: string,
  name: string,
  overrides: Partial<ComposerTemplate> = {}
): ComposerTemplate => ({
  accountId: null,
  bcc: [],
  body: { html: `<p>${name} body</p>`, text: `${name} body` },
  cc: [],
  createdAt: 1,
  id,
  name,
  subject: "",
  to: [],
  updatedAt: 1,
  ...overrides,
});

const TEMPLATES = [
  template("weekly", "Weekly update", {
    subject: "This week",
    to: ["team@example.com"],
  }),
  template("welcome", "Welcome"),
  template("invoice", "Invoice"),
];

const SlashComposer = ({
  onApply,
  onClose,
}: {
  onApply: (template: ComposerTemplateInput) => void;
  onClose: () => void;
}) => {
  const handle = useRef<ComposerFocusHandle | null>(null);
  return (
    <AppHotkeysProvider>
      <ComposerLayer onClose={onClose} />
      <EmailComposer
        enableTemplateSlashMenu
        focusHandleRef={(next) => {
          handle.current = next;
        }}
        onApplyTemplate={(applied) => {
          onApply(applied);
          // The new-email workspace writes the applied body back the same way.
          handle.current?.replaceContent?.(applied.body.html);
        }}
        templates={TEMPLATES}
      />
    </AppHotkeysProvider>
  );
};

const renderSlashComposer = async () => {
  const onApply = vi.fn<(template: ComposerTemplateInput) => void>();
  const onClose = vi.fn<() => void>();
  render(<SlashComposer onApply={onApply} onClose={onClose} />);
  await act(settle);
  const editor = editorIn("Message");
  await focusEnd(editor);
  return { editor, onApply, onClose };
};

describe("the template slash menu", () => {
  it("opens on a slash, filters by name, and inserts with the arrows and Enter", async () => {
    const user = userEvent.setup();
    const { editor, onApply } = await renderSlashComposer();

    await typeInto(editor, "/");
    const opened = optionNames();
    await typeInto(editor, "we");
    const filtered = optionNames();
    await user.keyboard("{ArrowDown}");
    const moved = optionNames();
    expect({ filtered, moved, opened }).toStrictEqual({
      filtered: ["Weekly updateThis week *", "Welcome"],
      moved: ["Weekly updateThis week", "Welcome *"],
      opened: ["Invoice *", "Weekly updateThis week", "Welcome"],
    });
    expect(
      snapshot()
        .filter((entry) => entry.component === "trigger-menu")
        .map((entry) => entry.label)
    ).toStrictEqual(["Templates"]);

    await user.keyboard("{ArrowUp}{Enter}");
    await act(settle);

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({
      id: "weekly",
      subject: "This week",
      to: ["team@example.com"],
    });
    expect({
      html: editor.getHTML(),
      options: screen.queryAllByRole("option"),
    }).toStrictEqual({ html: "<p>Weekly update body</p>", options: [] });
  });

  it("closes only the menu on Escape, and keeps a dismissed match closed", async () => {
    const user = userEvent.setup();
    const { editor, onClose } = await renderSlashComposer();

    await typeInto(editor, "Hi /in");
    expect(optionNames()).toStrictEqual(["Invoice *"]);

    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      closed: onClose.mock.calls.length,
      options: optionNames(),
      text: editor.getText(),
    }).toStrictEqual({ closed: 0, options: [], text: "Hi /in" });

    await typeInto(editor, "v");
    expect(optionNames()).toStrictEqual([]);

    await typeInto(editor, " /w");
    expect(optionNames()).toStrictEqual([
      "Weekly updateThis week *",
      "Welcome",
    ]);

    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lists names that contain the query, not only ones that start with it", async () => {
    const { editor } = await renderSlashComposer();

    await typeInto(editor, "/pdate");

    expect(optionNames()).toStrictEqual(["Weekly updateThis week *"]);
  });

  it("restarts undo at the template, leaving only the body the workspace writes back", async () => {
    const user = userEvent.setup();
    const { editor } = await renderSlashComposer();

    await typeInto(editor, "Draft /wee");
    await user.keyboard("{Enter}");
    await act(settle);

    expect(undoDepth(editor.state)).toBe(1);
    await act(() => {
      editor.commands.undo();
    });
    expect(editor.getText()).not.toContain("/wee");
    expect(undoDepth(editor.state)).toBe(0);
  });

  it("opens only at the start of a paragraph or after a space or line break", async () => {
    const { editor } = await renderSlashComposer();

    await typeInto(editor, "a/w");
    const afterLetter = optionNames();
    await typeInto(editor, " (/w");
    const afterParenthesis = optionNames();
    await typeInto(editor, " https:/w");
    const afterColon = optionNames();
    await act(() => {
      editor.commands.setHardBreak();
    });
    await typeInto(editor, "/inv");

    expect({
      afterColon,
      afterLetter,
      afterLineBreak: optionNames(),
      afterParenthesis,
    }).toStrictEqual({
      afterColon: [],
      afterLetter: [],
      afterLineBreak: ["Invoice *"],
      afterParenthesis: [],
    });
  });

  it("doesn't open for content the app writes into the editor", async () => {
    const { editor } = await renderSlashComposer();

    await act(() => {
      editor.commands.setContent("<p>Use /inv</p>");
      editor.commands.focus("end");
    });
    await act(settle);

    expect(optionNames()).toStrictEqual([]);
  });
});

const AdapterEditor = ({
  onChange,
}: {
  onChange: (change: EditorChange) => void;
}) => {
  const editor = useEditor({
    content: "<p></p>",
    extensions: [StarterKit],
    shouldRerenderOnTransaction: false,
  });
  useEffect(
    () =>
      editor === null
        ? undefined
        : createTiptapTextAdapter(editor).subscribe(onChange),
    [editor, onChange]
  );
  return <EditorContent editor={editor} />;
};

const renderAdapterEditor = async (
  onChange: (change: EditorChange) => void = () => null
) => {
  render(<AdapterEditor onChange={onChange} />);
  await act(settle);
  const editor = editorOf(screen.getByRole("textbox"));
  await focusEnd(editor);
  return editor;
};

describe("the Tiptap text adapter", () => {
  it("reads ProseMirror positions, with a line break as one character", async () => {
    const editor = await renderAdapterEditor();
    await typeInto(editor, "a");
    await act(() => {
      editor.commands.setHardBreak();
    });
    await typeInto(editor, "/x");
    const adapter = createTiptapTextAdapter(editor);

    expect(adapter.textBefore(10)).toStrictEqual({
      offset: 0,
      text: `\na${String.fromCodePoint(0xff_fc)}/x`,
    });
    expect(adapter.textBefore(2)).toStrictEqual({ offset: 3, text: "/x" });
    expect(adapter.selection()).toStrictEqual({ end: 5, start: 5 });
  });

  it("replaces a match as one undo step, apart from the typing around it", async () => {
    const changes: EditorChange[] = [];
    const editor = await renderAdapterEditor((change) => changes.push(change));
    await typeInto(editor, "hi /al");
    const adapter = createTiptapTextAdapter(editor);

    await act(() => {
      adapter.replace({ end: 7, start: 4 }, "/alpha ");
    });
    await typeInto(editor, "x");
    const texts = [editor.getText()];
    await act(() => {
      for (const _step of [1, 2, 3]) {
        editor.commands.undo();
        texts.push(editor.getText());
      }
    });
    expect(texts).toStrictEqual(["hi /alpha x", "hi /alpha ", "hi /al", ""]);

    await act(() => {
      editor.commands.setContent("<p>Replaced</p>");
    });
    expect({
      app: changes.at(-1),
      typed: changes.find(
        (change) => change.type === "input" && change.inserted === "/"
      ),
    }).toMatchObject({
      app: { type: "input", user: false },
      typed: { range: { end: 4, start: 4 }, user: true },
    });
  });
});

const renderToolbar = async () => {
  render(<EmailComposer />);
  await act(settle);
  return {
    editor: editorIn("Message"),
    toolbar: screen.getByRole("toolbar", { name: "Formatting" }),
  };
};

const focusedName = () => document.activeElement?.getAttribute("aria-label");

const tabStops = (element: HTMLElement) =>
  element.querySelectorAll('[tabindex="0"]').length;

describe("the formatting toolbar", () => {
  it("is one tab stop that arrow keys move through", async () => {
    const user = userEvent.setup();
    const { editor, toolbar } = await renderToolbar();
    await focusEnd(editor);

    const visited: (string | null | undefined)[] = [];
    await user.tab();
    visited.push(focusedName());
    const stopsOnEntry = tabStops(toolbar);
    await user.keyboard("{ArrowRight}");
    visited.push(focusedName());
    await user.keyboard("{End}");
    visited.push(focusedName());
    const redoDisabled = document.activeElement?.getAttribute("aria-disabled");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    visited.push(focusedName());
    await user.keyboard("{Home}");
    visited.push(focusedName());

    expect({
      redoDisabled,
      stops: [stopsOnEntry, tabStops(toolbar)],
      visited,
    }).toStrictEqual({
      redoDisabled: "true",
      stops: [1, 1],
      visited: ["Bold", "Italic", "Redo", "Horizontal rule", "Bold"],
    });
  });

  it("shows marks as pressed toggles and applies them with Space", async () => {
    const user = userEvent.setup();
    const { editor, toolbar } = await renderToolbar();
    await focusEnd(editor);
    const bold = within(toolbar).getByRole("button", { name: "Bold" });
    const italic = within(toolbar).getByRole("button", { name: "Italic" });
    const pressed = () =>
      [bold, italic].map((toggle) => toggle.getAttribute("aria-pressed"));
    const before = pressed();

    await user.tab();
    await user.keyboard(" ");
    await act(settle);
    const after = pressed();
    const bolded = editor.isActive("bold");
    await act(() => {
      editor.commands.toggleItalic();
    });

    expect({
      after,
      before,
      bolded,
      fromEditor: pressed(),
      slots: [bold.dataset.slot, italic.dataset.slot],
    }).toStrictEqual({
      after: ["true", "false"],
      before: ["false", "false"],
      bolded: true,
      fromEditor: ["true", "true"],
      slots: ["toggle", "toggle"],
    });
  });

  it("opens the link field from its toolbar button", async () => {
    const user = userEvent.setup();
    const { editor, toolbar } = await renderToolbar();
    await focusEnd(editor);

    await user.tab();
    await user.keyboard("{ArrowRight>5/}");
    expect(document.activeElement).toBe(
      within(toolbar).getByRole("button", { name: "Link" })
    );
    await user.keyboard("{Enter}");
    await act(settle);
    const address = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Link address",
    });
    await user.keyboard("example.com{ArrowLeft}{Home}{ArrowRight}{End}");

    expect({
      caret: address.selectionStart,
      focused: document.activeElement === address,
      value: address.value,
    }).toStrictEqual({ caret: 11, focused: true, value: "example.com" });
  });

  it("names the link button for editing once the caret is in a link, without a pressed state", async () => {
    const { editor, toolbar } = await renderToolbar();
    await focusEnd(editor);
    const before = within(toolbar).getByRole("button", { name: "Link" });
    const pressedBefore = before.getAttribute("aria-pressed");

    await act(() => {
      editor
        .chain()
        .focus()
        .insertContent('<a href="https://example.com">site</a>')
        .setTextSelection(editor.state.doc.content.size - 2)
        .run();
    });
    await act(settle);
    const edit = within(toolbar).getByRole("button", { name: "Edit link" });

    expect({
      entries: snapshot()
        .filter((entry) => entry.label === "Edit link")
        .map(({ component }) => component),
      haspopup: edit.getAttribute("aria-haspopup"),
      pressed: [pressedBefore, edit.getAttribute("aria-pressed")],
    }).toStrictEqual({
      entries: ["popover"],
      haspopup: "dialog",
      pressed: [null, null],
    });
  });

  it("disables every control while the composer is busy, keeping one tab stop", async () => {
    render(<EmailComposer disabled />);
    await act(settle);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });

    expect(
      within(toolbar)
        .getAllByRole("button")
        .every((button) => button.getAttribute("aria-disabled") === "true")
    ).toBeTruthy();
    expect(tabStops(toolbar)).toBe(1);

    const user = userEvent.setup();
    await user.click(within(toolbar).getByRole("button", { name: "Link" }));
    await user.tab();
    await user.keyboard("{ArrowRight>5/}{Enter}");
    await act(settle);
    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
  });

  it("lists every control for an agent, which can press and toggle them", async () => {
    const { editor } = await renderToolbar();
    await focusEnd(editor);

    expect(labels()).toStrictEqual(
      expect.arrayContaining([
        "Formatting",
        "Bold",
        "Italic",
        "Underline",
        "Strikethrough",
        "Inline code",
        "Link",
        "Bulleted list",
        "Numbered list",
        "Quote",
        "Code block",
        "Horizontal rule",
        "Undo",
        "Redo",
      ])
    );
    expect(snapshot().filter((entry) => !entry.label)).toStrictEqual([]);

    const result = await agent.act({
      steps: [
        { action: "press", args: ["Horizontal rule"], ref: "Formatting" },
        { action: "setPressed", args: [true], ref: "Italic" },
      ],
    });
    await act(settle);

    expect({
      error: result.error?.message,
      italic: screen
        .getByRole("button", { name: "Italic" })
        .getAttribute("aria-pressed"),
      rule: editor.getHTML().includes("<hr>"),
    }).toStrictEqual({ error: undefined, italic: "true", rule: true });
  });
});

const NO_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

const Recipients = ({
  initial = NO_RECIPIENTS,
  onChange,
  onClose,
  onSubmit,
  suggested,
}: {
  initial?: EmailRecipients;
  onChange: (recipients: EmailRecipients) => void;
  onClose: () => void;
  onSubmit: () => void;
  suggested?: readonly string[];
}) => {
  const [value, setValue] = useState(initial);
  return (
    <AppHotkeysProvider>
      <ComposerLayer onClose={onClose} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <EmailRecipientFields
          accountId=""
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          suggestedAddresses={suggested}
          value={value}
        />
      </form>
    </AppHotkeysProvider>
  );
};

const renderRecipients = async (
  props: { initial?: EmailRecipients; suggested?: readonly string[] } = {}
) => {
  const onChange = vi.fn<(recipients: EmailRecipients) => void>();
  const onClose = vi.fn<() => void>();
  const onSubmit = vi.fn<() => void>();
  render(
    <Recipients
      onChange={onChange}
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    />
  );
  await act(settle);
  const to = screen.getByRole<HTMLInputElement>("combobox", { name: "To" });
  const latest = () => onChange.mock.lastCall?.[0];
  return { latest, onChange, onClose, onSubmit, to };
};

const chips = () =>
  screen
    .queryAllByRole("button", { name: /^Remove /u })
    .map((button) => button.getAttribute("aria-label")?.slice(7));

describe("the recipient fields", () => {
  it("commits typed addresses on Enter, separators and blur, never submitting the form", async () => {
    const user = userEvent.setup();
    const { latest, onSubmit, to } = await renderRecipients();

    await user.click(to);
    await user.keyboard("{Enter}");
    await user.type(to, "ada@example.com{Enter}");
    await user.type(to, "grace@example.com,");
    await user.type(to, "alan@example.com;");
    await user.type(to, "edsger@example.com ");
    await user.type(to, "barbara@example.com");
    await user.tab();
    await act(settle);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(latest()).toStrictEqual({
      bcc: [],
      cc: [],
      to: [
        "ada@example.com",
        "grace@example.com",
        "alan@example.com",
        "edsger@example.com",
        "barbara@example.com",
      ],
    });
    expect(chips()).toStrictEqual(latest()?.to);
    expect(to.value).toBe("");
  });

  it("adds every address pasted at once, skipping ones already there", async () => {
    const user = userEvent.setup();
    const { latest, to } = await renderRecipients({
      initial: { bcc: [], cc: [], to: ["ada@example.com"] },
    });

    await user.click(to);
    await user.paste(
      "Ada <ADA@example.com>, grace@example.com; alan@example.com"
    );
    await user.keyboard("{Enter}");

    expect(latest()?.to).toStrictEqual([
      "ada@example.com",
      "grace@example.com",
      "alan@example.com",
    ]);
  });

  it("marks an invalid address, keeps it for editing, and clears it on request", async () => {
    const user = userEvent.setup();
    const { onChange, onSubmit, to } = await renderRecipients();

    const state = () => ({
      described: to.hasAttribute("aria-describedby"),
      focused: document.activeElement === to,
      invalid: to.getAttribute("aria-invalid"),
      text: to.value,
    });
    await user.type(to, "nobody{Enter}");
    const entered = state();
    await user.tab();
    const blurred = state();
    await user.click(
      screen.getByRole("button", { name: "Clear invalid email address" })
    );

    expect({ blurred, cleared: state(), entered }).toStrictEqual({
      blurred: {
        described: true,
        focused: false,
        invalid: "true",
        text: "nobody",
      },
      cleared: { described: false, focused: true, invalid: null, text: "" },
      entered: {
        described: true,
        focused: true,
        invalid: "true",
        text: "nobody",
      },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("removes a chip with its button and the last one with Backspace", async () => {
    const user = userEvent.setup();
    const { latest, to } = await renderRecipients({
      initial: {
        bcc: [],
        cc: [],
        to: ["ada@example.com", "grace@example.com", "alan@example.com"],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Remove grace@example.com" })
    );
    expect(latest()?.to).toStrictEqual(["ada@example.com", "alan@example.com"]);

    await user.click(to);
    await user.keyboard("{Backspace}");
    expect(latest()?.to).toStrictEqual(["ada@example.com"]);
    expect(chips()).toStrictEqual(["ada@example.com"]);
  });

  it("suggests known addresses, chosen with Enter, Tab or a click", async () => {
    const user = userEvent.setup();
    const { latest, onSubmit, to } = await renderRecipients({
      suggested: ["bob@example.com", "bea@example.com", "ada@example.com"],
    });

    await user.type(to, "b");
    await act(settle);
    const suggestions = optionNames();
    await user.keyboard("{ArrowDown}{Enter}");
    const byEnter = { text: to.value, to: latest()?.to };

    await user.type(to, "bo");
    await act(settle);
    await user.keyboard("{Tab}");
    const byTab = { focused: document.activeElement === to, to: latest()?.to };

    await user.type(to, "a");
    await act(settle);
    await user.click(screen.getByRole("option", { name: "ada@example.com" }));
    await act(settle);

    expect({
      byClick: { invalid: to.hasAttribute("aria-invalid"), to: latest()?.to },
      byEnter,
      byTab,
      suggestions,
    }).toStrictEqual({
      byClick: {
        invalid: false,
        to: ["bea@example.com", "bob@example.com", "ada@example.com"],
      },
      byEnter: { text: "", to: ["bea@example.com"] },
      byTab: { focused: true, to: ["bea@example.com", "bob@example.com"] },
      suggestions: ["bob@example.com *", "bea@example.com"],
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes the suggestions on Escape without closing the composer or losing the text", async () => {
    const user = userEvent.setup();
    const { onClose, to } = await renderRecipients({
      suggested: ["bob@example.com"],
    });

    await user.type(to, "bo");
    await act(settle);
    expect(optionNames()).toStrictEqual(["bob@example.com *"]);

    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      closed: onClose.mock.calls.length,
      options: optionNames(),
      text: to.value,
    }).toStrictEqual({ closed: 0, options: [], text: "bo" });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands the composer its To input and takes focus when asked", async () => {
    const toRef = createRef<HTMLInputElement>();
    render(
      <EmailRecipientFields
        accountId=""
        autoFocus
        inputRefs={{ to: toRef }}
        onChange={() => null}
        value={NO_RECIPIENTS}
      />
    );
    await act(settle);
    const to = screen.getByRole("combobox", { name: "To" });

    expect({
      focused: document.activeElement === to,
      ref: toRef.current === to,
    }).toStrictEqual({ focused: true, ref: true });
  });

  it("names each field for an agent, which can fill them", async () => {
    const user = userEvent.setup();
    const { latest } = await renderRecipients();
    await user.click(screen.getByRole("button", { name: "Cc" }));
    await act(settle);
    const controls = screen
      .getByRole("button", { name: "Cc" })
      .getAttribute("aria-controls");
    const ccRow = document.querySelector(`[id="${controls ?? ""}"]`);
    expect(
      ccRow?.contains(screen.getByRole("combobox", { name: "Cc" }))
    ).toBeTruthy();

    expect(labels()).toStrictEqual(expect.arrayContaining(["To", "Cc"]));
    expect(snapshot().filter((entry) => !entry.label)).toStrictEqual([]);

    const result = await agent.act({
      steps: [
        {
          action: "setValue",
          args: [["ada@example.com", "Grace <grace@example.com>"]],
          ref: "To",
        },
      ],
    });
    await act(settle);

    expect(result.error?.message).toBeUndefined();
    expect(latest()?.to).toStrictEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });
});

const ORIGINAL: CleanDraftVersion = {
  body: "original",
  id: "original",
  label: "Original",
  status: "ready",
  subject: "original",
};
const FIRST_CLEAN: CleanDraftVersion = {
  body: "clean",
  id: "clean-1-request",
  label: "#1 Clean",
  status: "ready",
  subject: "clean",
};
const PENDING_CLEAN: CleanDraftVersion = {
  ...ORIGINAL,
  id: "clean-2-request",
  label: "#2 Clean",
  status: "loading",
};

const renderStrip = async () => {
  const onDismiss = vi.fn<(version: CleanDraftVersion) => void>();
  const onSelect = vi.fn<(version: CleanDraftVersion) => void>();
  render(
    <CleanDraftHistoryStrip
      disabled={false}
      onDismiss={onDismiss}
      onSelect={onSelect}
      selectedVersionId="original"
      versions={[ORIGINAL, FIRST_CLEAN, PENDING_CLEAN]}
    />
  );
  await act(settle);
  return { onDismiss, onSelect };
};

describe("the draft history strip", () => {
  it("picks one version with the arrows and Enter, from one tab stop", async () => {
    const user = userEvent.setup();
    const { onDismiss, onSelect } = await renderStrip();
    const strip = screen.getByRole("toolbar", { name: "Draft history" });
    const group = screen.getByRole("group", { name: "Draft version" });
    const visited: (string | null | undefined)[] = [];

    await user.tab();
    visited.push(focusedName());
    await user.keyboard("{ArrowRight}");
    visited.push(focusedName());
    const selectedByArrow = onSelect.mock.calls.length;
    await user.keyboard("{Enter}{ArrowRight}");
    visited.push(focusedName());
    await user.keyboard("{Enter}{ArrowRight}");
    visited.push(focusedName());
    const pending = document.activeElement;
    await user.keyboard("{Enter}");

    expect({
      grouped: strip.contains(group),
      pending: [pending?.getAttribute("aria-disabled"), pending?.textContent],
      pressed: within(group)
        .getAllByRole("button", { pressed: true })
        .map((toggle) => toggle.getAttribute("aria-label")),
      selectedByArrow,
      stops: tabStops(strip),
      visited,
    }).toStrictEqual({
      grouped: true,
      pending: ["true", "#2 Cleaning…"],
      pressed: ["Use Original draft"],
      selectedByArrow: 0,
      stops: 1,
      visited: [
        "Use Original draft",
        "Use #1 Clean draft",
        "Dismiss #1 Clean draft",
        "Use #2 Clean draft",
      ],
    });
    expect(onSelect.mock.calls).toStrictEqual([[FIRST_CLEAN]]);
    expect(onDismiss.mock.calls).toStrictEqual([[FIRST_CLEAN]]);
  });

  it("lets an agent find and pick a version", async () => {
    const { onSelect } = await renderStrip();

    expect(labels()).toStrictEqual(
      expect.arrayContaining([
        "Draft history",
        "Draft version",
        "Use Original draft",
        "Use #1 Clean draft",
        "Dismiss #1 Clean draft",
      ])
    );
    expect(snapshot().filter((entry) => !entry.label)).toStrictEqual([]);

    const result = await agent.act({
      steps: [
        { action: "setPressed", args: [true], ref: "Use #1 Clean draft" },
      ],
    });
    expect(result.error?.message).toBeUndefined();
    expect(onSelect.mock.calls).toStrictEqual([[FIRST_CLEAN]]);
  });
});

describe("the outgoing attachment list", () => {
  it("names each remove button for its file", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn<(attachmentId: string) => void>();
    render(
      <OutgoingAttachmentList
        attachments={[
          {
            filename: "report.pdf",
            id: "report",
            mediaType: "application/pdf",
            referenceId: "reference-report",
            size: 2048,
          },
          {
            filename: "notes.txt",
            id: "notes",
            mediaType: "text/plain",
            referenceId: "reference-notes",
            size: 12,
          },
        ]}
        onRemove={onRemove}
      />
    );
    await act(settle);

    await user.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    expect(onRemove).toHaveBeenCalledWith("report");
    expect(labels()).toStrictEqual(
      expect.arrayContaining(["Remove report.pdf", "Remove notes.txt"])
    );

    const result = await agent.act({
      steps: [{ action: "press", ref: "Remove notes.txt" }],
    });
    expect(result.error?.message).toBeUndefined();
    expect(onRemove).toHaveBeenLastCalledWith("notes");
  });
});
