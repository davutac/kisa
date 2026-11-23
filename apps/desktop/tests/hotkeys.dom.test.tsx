import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { matchesShortcut } from "@ui-sdk/core/shortcuts";
import { setPlatform, settle } from "@ui-sdk/core/testing";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConfirmDialogProvider,
  useConfirm,
} from "../src/renderer/src/components/confirm-dialog";
import EmailComposer from "../src/renderer/src/components/mail/email-composer";
import EmailRecipientFields from "../src/renderer/src/components/mail/email-recipient-fields";
import type { EmailRecipients } from "../src/renderer/src/components/mail/email-recipient-fields";
import MailSearchCommandBar from "../src/renderer/src/components/mail/mail-search/mail-search-command-bar";
import { Input } from "../src/renderer/src/components/ui/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "../src/renderer/src/components/ui/menu";
import { toast, Toaster } from "../src/renderer/src/components/ui/toast";
import {
  AppCommand,
  AppHotkeysProvider,
  useAppCommand,
  useHotkeyHintsRevealed,
  useHotkeyLayer,
} from "../src/renderer/src/hotkeys";
import {
  HOTKEY_COMMANDS,
  parseHotkeyBinding,
  toShortcutKeys,
} from "../src/renderer/src/hotkeys/commands";
import type { HotkeyCommandId } from "../src/renderer/src/hotkeys/commands";
import {
  HOTKEY_LAYERS,
  isHotkeyScopeActive,
} from "../src/renderer/src/hotkeys/layer-model";
import type { HotkeyLayer } from "../src/renderer/src/hotkeys/layer-model";
import { createMailSearchQuery } from "../src/renderer/src/mail/search-query";

// ProseMirror measures carets through ranges, which jsdom can't lay out.
Range.prototype.getClientRects = () =>
  Object.assign([] as DOMRect[], { item: (): DOMRect | null => null });
Range.prototype.getBoundingClientRect = () => new DOMRect();

type Run = (command: HotkeyCommandId) => void;

const COMMAND_IDS = Object.keys(HOTKEY_COMMANDS) as HotkeyCommandId[];

const Layer = ({ layer }: { readonly layer: HotkeyLayer }) => {
  useHotkeyLayer(layer, true);
  return null;
};

const Commands = ({
  ids,
  onRun,
}: {
  readonly ids: readonly HotkeyCommandId[];
  readonly onRun: Run;
}) =>
  ids.map((id) => (
    <AppCommand callback={() => onRun(id)} command={id} key={id} />
  ));

const NO_LAYERS: readonly HotkeyLayer[] = [];

const Harness = ({
  children,
  ids,
  layers = NO_LAYERS,
  onRun,
}: {
  readonly children?: ReactNode;
  readonly ids: readonly HotkeyCommandId[];
  readonly layers?: readonly HotkeyLayer[];
  readonly onRun: Run;
}) => (
  <AppHotkeysProvider>
    {layers.map((layer) => (
      <Layer key={layer} layer={layer} />
    ))}
    <Commands ids={ids} onRun={onRun} />
    <input aria-label="Field" />
    <div aria-label="Editor" contentEditable />
    {children}
  </AppHotkeysProvider>
);

const renderCommands = (
  ids: readonly HotkeyCommandId[],
  options: { children?: ReactNode; layers?: readonly HotkeyLayer[] } = {}
) => {
  const onRun = vi.fn<Run>();
  const view = render(<Harness ids={ids} onRun={onRun} {...options} />);
  const runs = () => onRun.mock.calls.map(([id]) => id);
  return { onRun, runs, view };
};

const focus = (name: string) => {
  const field = screen
    .getAllByLabelText(name)
    .find((element) => element.matches("input, [contenteditable]"));
  if (field === undefined) {
    throw new Error(`No field named ${name}`);
  }
  act(() => {
    field.focus();
  });
  if (document.activeElement !== field) {
    throw new Error(`${name} didn't take focus`);
  }
};

const blurAll = () => {
  act(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
};

// What user-event types for a binding, with `Mod` as Control.
const LITERAL_KEYS = new Map([
  ["[", "[["],
  ["{", "{{"],
]);
const SHIFTED_KEYS = new Map([
  ["[", "{"],
  ["]", "}"],
]);

const keysFor = (binding: string): string => {
  const { key, modifiers } = parseHotkeyBinding(binding);
  const shift = modifiers.includes("Shift");
  const held = modifiers.map((modifier) =>
    modifier === "Mod" ? "Control" : modifier
  );
  let typed = shift ? (SHIFTED_KEYS.get(key) ?? key) : key;
  if (/^[A-Z]$/u.test(key) && !shift) {
    typed = key.toLowerCase();
  }
  const press =
    key.length > 1 ? `{${key}}` : (LITERAL_KEYS.get(typed) ?? typed);

  return `${held.map((name) => `{${name}>}`).join("")}${press}${held
    .toReversed()
    .map((name) => `{/${name}}`)
    .join("")}`;
};

const editorOf = (name: string): Editor =>
  (screen.getByRole("textbox", { name }) as HTMLElement & { editor: Editor })
    .editor;

const focusEditorEnd = async (editor: Editor) => {
  await act(() => {
    editor.commands.focus("end");
  });
  await waitFor(() => expect(editor.view.hasFocus()).toBeTruthy());
};

// jsdom gives contenteditable no text input, so typing is the transaction
// ProseMirror's input handling would dispatch.
const typeInto = async (editor: Editor, text: string) => {
  await act(() => {
    editor.view.dispatch(editor.view.state.tr.insertText(text));
  });
};

setPlatform("other");

describe("bindings", () => {
  const CODES = new Map([
    [",", "Comma"],
    ["[", "BracketLeft"],
    ["\\", "Backslash"],
    ["]", "BracketRight"],
  ]);

  // The keydown Chromium sends on a US layout, where Shift types `}` for `]`.
  const chromiumPress = (binding: string, apple: boolean): KeyboardEvent => {
    const { key, modifiers } = parseHotkeyBinding(binding);
    const shift = modifiers.includes("Shift");
    const mod = modifiers.includes("Mod");
    let code = CODES.get(key) ?? key;
    let typed = shift ? (SHIFTED_KEYS.get(key) ?? key) : key;
    if (/^[A-Z]$/u.test(key)) {
      code = `Key${key}`;
      typed = shift ? key : key.toLowerCase();
    } else if (/^\d$/u.test(key)) {
      code = `Digit${key}`;
    }
    return new KeyboardEvent("keydown", {
      code,
      ctrlKey: mod && !apple,
      key: typed,
      metaKey: mod && apple,
      shiftKey: shift,
    });
  };

  it("match the key press each one names, alone among the commands active with it", () => {
    const entries = Object.entries(HOTKEY_COMMANDS);
    const failures: string[] = [];

    for (const apple of [true, false]) {
      for (const [id, command] of entries) {
        for (const binding of command.bindings) {
          const press = chromiumPress(binding, apple);
          for (const top of [null, ...HOTKEY_LAYERS]) {
            if (!isHotkeyScopeActive(command.scope, top)) {
              continue;
            }
            const matched = entries
              .filter(
                ([, other]) =>
                  isHotkeyScopeActive(other.scope, top) &&
                  other.bindings.some((otherBinding) =>
                    toShortcutKeys(otherBinding).some((keys) =>
                      matchesShortcut(press, keys, apple)
                    )
                  )
              )
              .map(([otherId]) => otherId);
            if (matched.length !== 1 || matched[0] !== id) {
              failures.push(
                `${apple ? "apple" : "other"} ${top ?? "none"}: ${id} (${binding}) → [${matched.join(", ")}]`
              );
            }
          }
        }
      }
    }

    expect(failures).toStrictEqual([]);
  });
});

describe("on Apple platforms", () => {
  afterEach(() => {
    setPlatform("other");
  });

  it("take Mod as Command, not Control", async () => {
    setPlatform("apple");
    const user = userEvent.setup();
    const { runs } = renderCommands(["app.searchMail", "app.undo"]);

    await user.keyboard("{Meta>}k{/Meta}{Control>}k{/Control}");
    focus("Field");
    await user.keyboard("{Meta>}z{/Meta}");

    expect(runs()).toStrictEqual(["app.searchMail"]);
  });
});

describe("text fields", () => {
  it("keep plain keys and ignored chords to themselves, so native undo stays", async () => {
    const user = userEvent.setup();
    const { runs } = renderCommands([
      "app.toggleUnread",
      "app.undo",
      "app.searchMail",
    ]);
    const preventedUndos: boolean[] = [];
    const listener = (event: KeyboardEvent) => {
      if (event.key === "z") {
        preventedUndos.push(event.defaultPrevented);
      }
    };
    window.addEventListener("keydown", listener);

    const pressAll = async () => {
      await user.keyboard("u{Control>}z{/Control}{Control>}k{/Control}");
    };
    await pressAll();
    const fromPage = runs();
    focus("Field");
    await pressAll();
    focus("Editor");
    await pressAll();
    window.removeEventListener("keydown", listener);

    expect({
      fromFields: runs().slice(3),
      fromPage,
      preventedUndos,
    }).toStrictEqual({
      fromFields: ["app.searchMail", "app.searchMail"],
      fromPage: ["app.toggleUnread", "app.undo", "app.searchMail"],
      preventedUndos: [true, false, false],
    });
  });

  it("take Escape from an ignored command but not from an allowed one", async () => {
    const user = userEvent.setup();
    const thread = renderCommands(["thread.close"], { layers: ["thread"] });
    focus("Field");
    await user.keyboard("{Escape}");
    blurAll();
    await user.keyboard("{Escape}");
    const threadRuns = thread.runs();
    thread.view.unmount();

    const composer = renderCommands(["composer.close"], {
      layers: ["composer"],
    });
    focus("Field");
    await user.keyboard("{Escape}");

    expect({
      composer: composer.runs(),
      thread: threadRuns,
    }).toStrictEqual({
      composer: ["composer.close"],
      thread: ["thread.close"],
    });
  });

  it("leave a focused control the keys it handles itself", async () => {
    const user = userEvent.setup();
    const onPress = vi.fn<() => void>();
    const { runs } = renderCommands(
      ["mailbox.openThread", "mailbox.nextThread"],
      {
        children: (
          <>
            <button onClick={onPress} type="button">
              Unread only
            </button>
            <Menu>
              <MenuTrigger>Labels</MenuTrigger>
              <MenuContent>
                <MenuItem>Work</MenuItem>
                <MenuItem>Travel</MenuItem>
              </MenuContent>
            </Menu>
          </>
        ),
        layers: ["mailbox"],
      }
    );

    act(() => {
      screen.getByRole("button", { name: "Unread only" }).focus();
    });
    await user.keyboard("{Enter}j");
    const fromButton = runs();
    await user.click(screen.getByRole("button", { name: "Labels" }));
    await act(settle);
    await user.keyboard("j");
    const fromMenu = runs().slice(fromButton.length);

    expect({
      fromButton,
      fromMenu,
      pressed: onPress.mock.calls.length,
    }).toStrictEqual({
      fromButton: ["mailbox.nextThread"],
      fromMenu: [],
      pressed: 1,
    });
  });
});

// Module level, as React Compiler expects of a component it compiles.
const ClosingThread = ({ onRun }: { readonly onRun: Run }) => {
  const [isOpen, setIsOpen] = useState(true);
  useHotkeyLayer("mailbox", true);
  useHotkeyLayer("thread", isOpen);
  useAppCommand("thread.close", () => {
    onRun("thread.close");
    setIsOpen(false);
  });
  useAppCommand("mailbox.clearSelection", () =>
    onRun("mailbox.clearSelection")
  );
  return null;
};

describe("repeat", () => {
  it("runs once per press, ignoring a held key's repeats, unless the command allows them", async () => {
    const user = userEvent.setup();
    const { runs } = renderCommands(
      ["app.composeMessage", "app.openSettings", "mailbox.nextThread"],
      { layers: ["mailbox"] }
    );

    await user.keyboard("{Control>}{n>3}{/n}n{/Control}");
    await user.keyboard("{Control>}{,>3}{/,},{/Control}");
    await user.keyboard("{j>3}{/j}");

    expect(runs()).toStrictEqual([
      "app.composeMessage",
      "app.composeMessage",
      "app.openSettings",
      "app.openSettings",
      "mailbox.nextThread",
      "mailbox.nextThread",
      "mailbox.nextThread",
    ]);
  });

  it("doesn't hand a held key's repeats to a command the press just activated", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    render(
      <AppHotkeysProvider>
        <ClosingThread onRun={onRun} />
      </AppHotkeysProvider>
    );

    await user.keyboard("{Escape>4}{/Escape}");
    const held = onRun.mock.calls.map(([id]) => id);
    await user.keyboard("{Escape}");

    expect({
      held,
      pressedAgain: onRun.mock.lastCall?.[0],
    }).toStrictEqual({
      held: ["thread.close"],
      pressedAgain: "mailbox.clearSelection",
    });
  });
});

const AskToDelete = ({
  onAnswer,
}: {
  readonly onAnswer: (answer: boolean) => void;
}) => {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        onAnswer(await confirm({ title: "Delete forever?" }));
      }}
      type="button"
    >
      Delete
    </button>
  );
};

describe("layers", () => {
  const ids = [
    "app.toggleUnread",
    "app.searchMail",
    "composer.send",
  ] as const satisfies readonly HotkeyCommandId[];

  it("let the top layer silence the commands beneath it, and give them back when it goes", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    const { rerender } = render(<Harness ids={ids} onRun={onRun} />);
    const pressAll = async (layers: readonly HotkeyLayer[]) => {
      rerender(<Harness ids={ids} layers={layers} onRun={onRun} />);
      onRun.mockClear();
      await user.keyboard("u{Control>}k{/Control}{Control>}{Enter}{/Control}");
      return onRun.mock.calls.map(([id]) => id);
    };

    expect({
      blocking: await pressAll(["composer", "blocking"]),
      composer: await pressAll(["composer"]),
      none: await pressAll([]),
      restored: await pressAll([]),
      search: await pressAll(["mailbox", "search"]),
    }).toStrictEqual({
      blocking: [],
      composer: ["composer.send"],
      none: ["app.toggleUnread", "app.searchMail"],
      restored: ["app.toggleUnread", "app.searchMail"],
      search: [],
    });
  });

  it("keep every command off while the search bar is open, and back once Escape closes it", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    const Search = () => {
      const [open, setOpen] = useState(false);
      useAppCommand("app.searchMail", () => {
        onRun("app.searchMail");
        setOpen(true);
      });
      return (
        <MailSearchCommandBar
          initialQuery={createMailSearchQuery()}
          onOpenChange={setOpen}
          onOpenThread={vi.fn<() => void>()}
          onShowAll={vi.fn<() => void>()}
          open={open}
        />
      );
    };
    render(
      <Harness ids={["app.toggleUnread", "app.composeMessage"]} onRun={onRun}>
        <Search />
      </Harness>
    );

    await user.keyboard("{Control>}k{/Control}");
    await act(settle);
    const field = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Search mail",
    });
    await user.keyboard("u{Control>}n{/Control}{Control>}k{/Control}");
    const typed = field.value;
    const whileOpen = onRun.mock.calls.map(([id]) => id);
    await user.keyboard("{Escape}");
    await act(settle);
    const closed = screen.queryByRole("dialog") === null;
    await user.keyboard("u");

    expect({
      closed,
      typed,
      whileOpen,
      after: onRun.mock.lastCall?.[0],
    }).toStrictEqual({
      after: "app.toggleUnread",
      closed: true,
      typed: "u",
      whileOpen: ["app.searchMail"],
    });
  });

  it("keep every command off while a confirmation is open, whose Return still confirms", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    const answers: boolean[] = [];
    render(
      <Harness
        ids={["app.toggleUnread", "app.composeMessage", "mailbox.trashThread"]}
        layers={["mailbox"]}
        onRun={onRun}
      >
        <ConfirmDialogProvider>
          <AskToDelete onAnswer={(answer) => answers.push(answer)} />
        </ConfirmDialogProvider>
      </Harness>
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await act(settle);
    const opened = screen.queryByRole("alertdialog") !== null;
    await user.keyboard("u{Control>}n{/Control}{Control>}d{/Control}");
    const whileOpen = onRun.mock.calls.length;
    await user.keyboard("{Enter}");
    await act(settle);
    await user.keyboard("u");

    expect({
      after: onRun.mock.calls.map(([id]) => id),
      answers,
      opened,
      whileOpen,
    }).toStrictEqual({
      after: ["app.toggleUnread"],
      answers: [true],
      opened: true,
      whileOpen: 0,
    });
  });
});

interface SendProps {
  readonly command: "composer.send" | "threadComposer.send";
  readonly enabled?: boolean;
  readonly layer: HotkeyLayer;
  readonly onRun: Run;
}

const Send = ({ command, enabled = true, layer, onRun }: SendProps) => {
  useHotkeyLayer(layer, true);
  useAppCommand(command, () => onRun(command), { enabled });
  return null;
};

const SendComposer = ({
  consumeModEnter = true,
  ...send
}: SendProps & { readonly consumeModEnter?: boolean }) => (
  <AppHotkeysProvider>
    <Send {...send} />
    <EmailComposer consumeModEnter={consumeModEnter} />
  </AppHotkeysProvider>
);

describe("the composer's Mod+Enter", () => {
  it("sends from the editor without a line break, while Shift+Enter still breaks the line", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    render(
      <SendComposer command="composer.send" layer="composer" onRun={onRun} />
    );
    await act(settle);
    const editor = editorOf("Message");
    await focusEditorEnd(editor);
    await typeInto(editor, "Hello");

    await user.keyboard("{Control>}{Enter}{/Control}");
    const afterSend = editor.getHTML();
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect({
      afterBreak: editor.getHTML(),
      afterSend,
      runs: onRun.mock.calls.length,
    }).toStrictEqual({
      afterBreak: "<p>Hello<br></p>",
      afterSend: "<p>Hello</p>",
      runs: 1,
    });
  });

  it("sends a reply from the thread composer the same way", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    render(
      <SendComposer
        command="threadComposer.send"
        layer="thread-composer"
        onRun={onRun}
      />
    );
    await act(settle);
    const editor = editorOf("Message");
    await focusEditorEnd(editor);
    await typeInto(editor, "Thanks");

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect({ html: editor.getHTML(), runs: onRun.mock.calls }).toStrictEqual({
      html: "<p>Thanks</p>",
      runs: [["threadComposer.send"]],
    });
  });

  it("is a hard break that never sends in an editor without the guard", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<Run>();
    render(
      <SendComposer
        command="composer.send"
        consumeModEnter={false}
        layer="composer"
        onRun={onRun}
      />
    );
    await act(settle);
    const editor = editorOf("Message");
    await focusEditorEnd(editor);
    await typeInto(editor, "Hello");

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect({
      html: editor.getHTML(),
      runs: onRun.mock.calls.length,
    }).toStrictEqual({ html: "<p>Hello<br></p>", runs: 0 });
  });

  it("cancels the line break a browser would type when nothing can send", async () => {
    const user = userEvent.setup();
    render(
      <SendComposer
        command="composer.send"
        enabled={false}
        layer="composer"
        onRun={vi.fn<Run>()}
      />
    );
    await act(settle);
    const editor = editorOf("Message");
    await focusEditorEnd(editor);
    const typeParagraph = () =>
      editor.view.dom.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertParagraph",
        })
      );

    await user.keyboard("{Control>}{Enter}{/Control}");
    const afterModEnter = typeParagraph();
    await user.keyboard("a");
    const afterLetter = typeParagraph();

    expect({ afterLetter, afterModEnter }).toStrictEqual({
      afterLetter: true,
      afterModEnter: false,
    });
  });
});

const NO_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

const Recipients = ({
  onChange,
  suggested,
}: {
  readonly onChange?: (recipients: EmailRecipients) => void;
  readonly suggested?: readonly string[];
}) => {
  const [value, setValue] = useState(NO_RECIPIENTS);
  return (
    <EmailRecipientFields
      accountId=""
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      suggestedAddresses={suggested}
      value={value}
    />
  );
};

describe("recipient fields", () => {
  it("send on Mod+Enter, with the address typed there committed", async () => {
    const user = userEvent.setup();
    const recipients: EmailRecipients[] = [];
    const { runs } = renderCommands(["composer.send"], {
      children: <Recipients onChange={(next) => recipients.push(next)} />,
      layers: ["composer"],
    });

    await user.type(
      screen.getByRole("combobox", { name: "To" }),
      "ada@example.com"
    );
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect({ runs: runs(), to: recipients.at(-1)?.to }).toStrictEqual({
      runs: ["composer.send"],
      to: ["ada@example.com"],
    });
  });

  it("send on Mod+Enter, with the highlighted suggestion added", async () => {
    const user = userEvent.setup();
    const recipients: EmailRecipients[] = [];
    const { runs } = renderCommands(["composer.send"], {
      children: (
        <Recipients
          onChange={(next) => recipients.push(next)}
          suggested={["bob@example.com"]}
        />
      ),
      layers: ["composer"],
    });

    await user.type(screen.getByRole("combobox", { name: "To" }), "bo");
    await act(settle);
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect({ runs: runs(), to: recipients.at(-1)?.to }).toStrictEqual({
      runs: ["composer.send"],
      to: ["bob@example.com"],
    });
  });

  it("close their suggestions on Escape before the reply closes", async () => {
    const user = userEvent.setup();
    const { runs } = renderCommands(["threadComposer.close"], {
      children: <Recipients suggested={["bob@example.com"]} />,
      layers: ["thread", "thread-composer"],
    });

    await user.type(screen.getByRole("combobox", { name: "To" }), "bo");
    await act(settle);
    const listed = screen.queryAllByRole("option").length;
    await user.keyboard("{Escape}");
    await act(settle);
    const afterFirst = {
      options: screen.queryAllByRole("option").length,
      runs: runs(),
    };
    await user.keyboard("{Escape}");

    expect({ afterFirst, afterSecond: runs(), listed }).toStrictEqual({
      afterFirst: { options: 0, runs: [] },
      afterSecond: ["threadComposer.close"],
      listed: 1,
    });
  });
});

describe("Escape", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it("on a focused toast dismisses only the toast", async () => {
    const user = userEvent.setup();
    const { runs } = renderCommands(["thread.close"], {
      children: <Toaster />,
      layers: ["thread"],
    });
    act(() => {
      toast.success("Label added");
    });
    await act(settle);

    act(() => {
      screen
        .getByText("Label added")
        .closest<HTMLElement>("[data-slot=toast]")
        ?.focus();
    });
    await user.keyboard("{Escape}");
    await act(settle);
    const afterToast = {
      runs: runs(),
      toast: screen.queryByText("Label added") !== null,
    };
    blurAll();
    await user.keyboard("{Escape}");

    expect({ afterPage: runs(), afterToast }).toStrictEqual({
      afterPage: ["thread.close"],
      afterToast: { runs: [], toast: false },
    });
  });

  it("is left to a focused widget that already handled it", async () => {
    const user = userEvent.setup();
    const { runs } = renderCommands(["composer.close"], {
      children: (
        <Input
          aria-label="Handles Escape"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
            }
          }}
        />
      ),
      layers: ["composer"],
    });

    focus("Handles Escape");
    await user.keyboard("{Escape}");
    const handled = runs();
    focus("Field");
    await user.keyboard("{Escape}");

    expect({ handled, plain: runs() }).toStrictEqual({
      handled: [],
      plain: ["composer.close"],
    });
  });
});

describe("a targeted command", () => {
  it("runs only for key presses with focus inside its element", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<() => void>();
    const Targeted = ({ attached }: { readonly attached: boolean }) => {
      const ref = useRef<HTMLDivElement>(null);
      useAppCommand("app.searchMail", onRun, { target: ref });
      return (
        <>
          <input aria-label="Outside" />
          {attached ? (
            <div ref={ref}>
              <input aria-label="Inside" />
            </div>
          ) : null}
        </>
      );
    };
    const { rerender } = render(
      <AppHotkeysProvider>
        <Targeted attached={false} />
      </AppHotkeysProvider>
    );

    focus("Outside");
    await user.keyboard("{Control>}k{/Control}");
    const unattached = onRun.mock.calls.length;
    rerender(
      <AppHotkeysProvider>
        <Targeted attached />
      </AppHotkeysProvider>
    );
    focus("Outside");
    await user.keyboard("{Control>}k{/Control}");
    const outside = onRun.mock.calls.length;
    focus("Inside");
    await user.keyboard("{Control>}k{/Control}");

    expect({
      inside: onRun.mock.calls.length,
      outside,
      unattached,
    }).toStrictEqual({ inside: 1, outside: 0, unattached: 0 });
  });
});

const Fields = ({ layer }: { readonly layer: HotkeyLayer }) => (
  <>
    <EmailComposer consumeModEnter={layer !== "templates"} />
    <Recipients />
    <Input aria-label="Subject" />
  </>
);

describe("allowed commands", () => {
  const FIELDS = ["Message", "To", "Subject"] as const;
  const keyCode = Object.getOwnPropertyDescriptor(
    KeyboardEvent.prototype,
    "keyCode"
  );

  // Chromium fills `keyCode`, which ProseMirror's keymaps read for a shifted
  // letter; jsdom and user-event leave it 0.
  beforeAll(() => {
    Object.defineProperty(KeyboardEvent.prototype, "keyCode", {
      configurable: true,
      get(this: KeyboardEvent) {
        const match = /^(?:Key|Digit)(?<key>.)$/u.exec(this.code);
        return match?.groups?.key?.codePointAt(0) ?? 0;
      },
    });
  });

  afterAll(() => {
    if (keyCode === undefined) {
      Reflect.deleteProperty(KeyboardEvent.prototype, "keyCode");
    } else {
      Object.defineProperty(KeyboardEvent.prototype, "keyCode", keyCode);
    }
  });

  it.each([
    ["composer", ["composer"]],
    ["thread-composer", ["thread", "thread-composer"]],
    ["templates", ["templates"]],
  ] as const)(
    "run from the editor, a recipient field and a text field under the %s layer",
    async (layer, layers) => {
      const user = userEvent.setup();
      const { onRun, runs } = renderCommands(COMMAND_IDS, {
        children: <Fields layer={layer} />,
        layers,
      });
      await act(settle);
      const misses: string[] = [];

      for (const field of FIELDS) {
        for (const id of COMMAND_IDS) {
          const command = HOTKEY_COMMANDS[id];
          if (
            command.input !== "allow" ||
            !isHotkeyScopeActive(command.scope, layer)
          ) {
            continue;
          }
          for (const binding of command.bindings) {
            focus(field);
            onRun.mockClear();
            // oxlint-disable-next-line eslint/no-await-in-loop -- Each press finishes before the next.
            await user.keyboard(keysFor(binding));
            if (runs().join(",") !== id) {
              misses.push(
                `${field}: ${id} (${binding}) → [${runs().join(",")}]`
              );
            }
          }
        }
      }

      // StarterKit's strikethrough owns Mod+Shift+S while the editor has focus.
      expect(misses).toStrictEqual(
        layer === "composer"
          ? []
          : ["Message: app.openScheduled (Mod+Shift+S) → []"]
      );
    }
  );
});

const Hints = () => (
  <output aria-label="Hints">{String(useHotkeyHintsRevealed(true))}</output>
);
const revealed = () =>
  screen.getByRole("status", { name: "Hints" }).textContent;
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
// Synchronous key events: Testing Library's async wrapper waits on a timer
// that fake timers never run.
const CONTROL = { code: "ControlLeft", ctrlKey: true, key: "Control" };
const META = { code: "MetaLeft", key: "Meta", metaKey: true };
const down = (init: KeyboardEventInit) => {
  act(() => {
    fireEvent.keyDown(document.body, init);
  });
};
const up = (init: KeyboardEventInit) => {
  act(() => {
    fireEvent.keyUp(document.body, init);
  });
};
const renderHints = (layers: readonly HotkeyLayer[] = NO_LAYERS) =>
  render(
    <AppHotkeysProvider>
      {layers.map((layer) => (
        <Layer key={layer} layer={layer} />
      ))}
      <Hints />
    </AppHotkeysProvider>
  );

describe("holding Mod", () => {
  beforeEach(() => {
    setPlatform("other");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals hints after 400 ms alone, keeps them through account chords, and hides them on release", () => {
    renderHints();

    down(CONTROL);
    wait(399);
    const early = revealed();
    wait(1);
    const shown = revealed();
    down({ code: "Digit2", ctrlKey: true, key: "2" });
    up({ code: "Digit2", ctrlKey: true, key: "2" });
    const afterChord = revealed();
    up({ ...CONTROL, ctrlKey: false });

    expect({ afterChord, early, released: revealed(), shown }).toStrictEqual({
      afterChord: "true",
      early: "false",
      released: "false",
      shown: "true",
    });
  });

  it("never flashes for a chord, and forgets a hold when the window loses focus", () => {
    renderHints();

    down(CONTROL);
    down({ code: "KeyC", ctrlKey: true, key: "c" });
    wait(800);
    const chord = revealed();
    up({ code: "KeyC", ctrlKey: true, key: "c" });
    up({ ...CONTROL, ctrlKey: false });
    down(CONTROL);
    wait(400);
    const held = revealed();
    act(() => {
      fireEvent.blur(window);
    });

    expect({ blurred: revealed(), chord, held }).toStrictEqual({
      blurred: "false",
      chord: "false",
      held: "true",
    });
  });

  it("forgets a key macOS released under ⌘ without a keyup", () => {
    setPlatform("apple");
    renderHints();

    down(META);
    down({ code: "Digit2", key: "2", metaKey: true });
    up({ ...META, metaKey: false });
    down(META);
    wait(400);

    expect(revealed()).toBe("true");
  });

  it("stays hidden while a layer above the app is on top", () => {
    renderHints(["composer"]);

    down(CONTROL);
    wait(400);

    expect(revealed()).toBe("false");
  });
});
