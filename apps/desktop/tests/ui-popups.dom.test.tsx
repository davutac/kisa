import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { MessageSquarePlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfirmDialogProvider,
  useConfirm,
} from "../src/renderer/src/components/confirm-dialog";
import type { ConfirmOptions } from "../src/renderer/src/components/confirm-dialog";
import AiComposerButton from "../src/renderer/src/components/mail/ai-composer-button";
import { getDeleteForeverConfirmation } from "../src/renderer/src/components/mail/delete-forever-confirmation";
import CreateReplyForm from "../src/renderer/src/components/mail/reply-area/create-reply-form";
import { SendWithScheduleMenu } from "../src/renderer/src/components/mail/schedule-send-menu";
import ThreadLabelPicker from "../src/renderer/src/components/mail/thread-label-picker";
import { Button } from "../src/renderer/src/components/ui/button";
import { createMenuController } from "../src/renderer/src/components/ui/menu";
import type { MenuController } from "../src/renderer/src/components/ui/menu";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys";
import { useIsHotkeyScopeActive } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import type { ThreadLabelChange } from "../src/renderer/src/mail/use-thread-actions";

let approve = false;
const agent = createAgent({ allow: (step) => !step.confirm || approve });

const agentControls = () => {
  const entries = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");
  return {
    labels: entries.map((entry) => entry.label),
    unnamed: entries
      .filter((entry) => !entry.label)
      .map((entry) => `${entry.component} ${entry.ref}`),
  };
};

const named = (labels: readonly string[]) => ({
  labels: expect.arrayContaining([...labels]),
  unnamed: [],
});

const isFocused = (element: Element | null) =>
  element !== null && document.activeElement === element;

const AppCommandsState = () => (
  <output aria-label="App shortcuts">
    {useIsHotkeyScopeActive("app") ? "on" : "off"}
  </output>
);

const Asker = ({
  onAnswer,
  options,
}: {
  onAnswer: (confirmed: boolean) => void;
  options: ConfirmOptions;
}) => {
  const confirm = useConfirm();
  return (
    <Button
      onClick={() => {
        void confirm(options).then(onAnswer);
      }}
      type="button"
    >
      Remove thread
    </Button>
  );
};

const renderConfirm = (options: ConfirmOptions) => {
  const onAnswer = vi.fn<(confirmed: boolean) => void>();
  render(
    <AppHotkeysProvider>
      <ConfirmDialogProvider>
        <Asker onAnswer={onAnswer} options={options} />
        <AppCommandsState />
      </ConfirmDialogProvider>
    </AppHotkeysProvider>
  );
  return {
    asker: screen.getByRole("button", { name: "Remove thread" }),
    onAnswer,
    shortcuts: screen.getByRole("status", { name: "App shortcuts" }),
  };
};

const TwoQuestions = ({ answers }: { answers: string[] }) => {
  const confirm = useConfirm();
  return (
    <Button
      onClick={() => {
        void confirm({ title: "Archive Alpha?" }).then((yes) =>
          answers.push(`Alpha ${yes}`)
        );
        void confirm({ title: "Archive Beta?" }).then((yes) =>
          answers.push(`Beta ${yes}`)
        );
      }}
      type="button"
    >
      Review two
    </Button>
  );
};

const deleteForever = getDeleteForeverConfirmation("Quarterly report");

describe("confirm dialog", () => {
  afterEach(() => {
    approve = false;
  });

  it("answers yes from the confirming button and gives focus and shortcuts back", async () => {
    const user = userEvent.setup();
    const { asker, onAnswer, shortcuts } = renderConfirm(deleteForever);

    await user.click(asker);
    await act(settle);
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete conversation?",
    });
    expect({
      cancelFocused: isFocused(
        within(dialog).getByRole("button", { name: "Cancel" })
      ),
      shortcuts: shortcuts.textContent,
      subject: within(dialog).queryByText("Quarterly report") !== null,
    }).toStrictEqual({ cancelFocused: true, shortcuts: "off", subject: true });

    await user.click(
      within(dialog).getByRole("button", { name: "Delete forever" })
    );
    await act(settle);
    expect({
      answers: onAnswer.mock.calls,
      askerFocused: isFocused(asker),
      open: screen.queryByRole("alertdialog") !== null,
      shortcuts: shortcuts.textContent,
    }).toStrictEqual({
      answers: [[true]],
      askerFocused: true,
      open: false,
      shortcuts: "on",
    });
  });

  it("answers no from Cancel and from Escape, returning focus each time", async () => {
    const user = userEvent.setup();
    const { asker, onAnswer } = renderConfirm(deleteForever);

    await user.click(asker);
    await act(settle);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(settle);
    expect({
      answers: onAnswer.mock.calls,
      askerFocused: isFocused(asker),
    }).toStrictEqual({ answers: [[false]], askerFocused: true });

    await user.click(asker);
    await act(settle);
    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      answers: onAnswer.mock.calls,
      askerFocused: isFocused(asker),
      open: screen.queryByRole("alertdialog") !== null,
    }).toStrictEqual({
      answers: [[false], [false]],
      askerFocused: true,
      open: false,
    });
  });

  it("opens a destructive question on Cancel, so Return answers no until focus moves", async () => {
    const user = userEvent.setup();
    const { asker, onAnswer } = renderConfirm(deleteForever);

    await user.click(asker);
    await act(settle);
    expect(
      isFocused(screen.getByRole("button", { name: "Cancel" }))
    ).toBeTruthy();
    await user.keyboard("{Enter}");
    await act(settle);
    expect(onAnswer.mock.calls).toStrictEqual([[false]]);

    await user.click(asker);
    await act(settle);
    await user.keyboard("{Tab}{Enter}");
    await act(settle);
    expect(onAnswer.mock.calls).toStrictEqual([[false], [true]]);

    await user.click(asker);
    await act(settle);
    await user.keyboard(" ");
    await act(settle);
    expect(onAnswer.mock.calls).toStrictEqual([[false], [true], [false]]);
  });

  it("opens any other question on its confirming button, so Return answers yes", async () => {
    const user = userEvent.setup();
    const { asker, onAnswer } = renderConfirm({
      confirmLabel: "Send anyway",
      title: "Send without a subject?",
    });

    await user.click(asker);
    await act(settle);
    expect(
      isFocused(screen.getByRole("button", { name: "Send anyway" }))
    ).toBeTruthy();
    await user.keyboard("{Enter}");
    await act(settle);
    expect(onAnswer.mock.calls).toStrictEqual([[true]]);
  });

  it("keeps the confirming button off until the confirmation text is typed, for each question", async () => {
    const user = userEvent.setup();
    const { asker, onAnswer } = renderConfirm({
      confirmLabel: "Delete account data",
      confirmationText: { value: "ana@example.com" },
      title: "Delete everything?",
    });

    await user.click(asker);
    await act(settle);
    const confirmButton = screen.getByRole("button", {
      name: "Delete account data",
    });
    const field = screen.getByPlaceholderText("ana@example.com");
    expect(confirmButton.hasAttribute("disabled")).toBeTruthy();

    await user.click(field);
    await user.keyboard("{Enter}");
    expect(onAnswer).not.toHaveBeenCalled();

    await user.type(field, "ana@example.com");
    expect(confirmButton.hasAttribute("disabled")).toBeFalsy();
    await user.keyboard("{Enter}");
    await act(settle);
    expect(onAnswer.mock.calls).toStrictEqual([[true]]);

    await user.click(asker);
    await act(settle);
    expect(
      screen.getByPlaceholderText<HTMLInputElement>("ana@example.com").value
    ).toBe("");
  });

  it("asks questions one at a time, in the order they were asked", async () => {
    const user = userEvent.setup();
    const answers: string[] = [];
    render(
      <AppHotkeysProvider>
        <ConfirmDialogProvider>
          <TwoQuestions answers={answers} />
        </ConfirmDialogProvider>
      </AppHotkeysProvider>
    );

    await user.click(screen.getByRole("button", { name: "Review two" }));
    await act(settle);
    expect(
      screen.getByRole("alertdialog", { name: "Archive Alpha?" })
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(settle);
    expect(
      screen.getByRole("alertdialog", { name: "Archive Beta?" })
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await act(settle);
    expect(answers).toStrictEqual(["Alpha false", "Beta true"]);
  });

  it("names its controls, and an agent's confirm waits for a person", async () => {
    const user = userEvent.setup();
    const { asker, onAnswer } = renderConfirm(deleteForever);

    await user.click(asker);
    await act(settle);
    expect(agentControls()).toMatchObject(
      named(["Remove thread", "Delete conversation?"])
    );
    expect(
      screen.getByRole("button", { name: "Delete forever" }).dataset
        .agentConfirm
    ).toBe(
      "Delete conversation? Quarterly report: This conversation will be permanently deleted from the mail server. This action cannot be undone."
    );

    const press = {
      steps: [
        {
          action: "press",
          args: ["Delete forever"],
          ref: "Delete conversation?",
        },
      ],
    };
    const button = agent
      .snapshot()
      .find(
        (entry) =>
          entry.component === "button" && entry.label === "Delete forever"
      );
    const refused = await agent.act(press);
    const refusedButton = await agent.act({
      steps: [{ action: "press", ref: button?.ref ?? "" }],
    });
    await act(settle);
    expect({
      answers: onAnswer.mock.calls,
      message: refused.error?.message.includes("Quarterly report"),
      ok: [refused.ok, refusedButton.ok],
      open: screen.queryByRole("alertdialog") !== null,
    }).toStrictEqual({
      answers: [],
      message: true,
      ok: [false, false],
      open: true,
    });

    approve = true;
    const allowed = await agent.act(press);
    await act(settle);
    expect({ answers: onAnswer.mock.calls, ok: allowed.ok }).toStrictEqual({
      answers: [[true]],
      ok: true,
    });
  });
});

const labels = [
  { id: "label-travel", name: "Travel" },
  { id: "label-receipts", name: "Receipts" },
];

const LabelPickerHarness = ({
  controller,
  onCreateLabel,
  onSetLabel,
}: {
  controller: MenuController;
  onCreateLabel: () => void;
  onSetLabel: (change: ThreadLabelChange) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button type="button">Message body</Button>
      <ThreadLabelPicker
        appliedLabels={["Travel"]}
        controller={controller}
        isLoading={false}
        isOpen={isOpen}
        labels={labels}
        onCreateLabel={onCreateLabel}
        onOpenChange={setIsOpen}
        onSetLabel={onSetLabel}
        pendingLabelIds={new Set()}
      />
    </>
  );
};

const renderLabelPicker = () => {
  const controller = createMenuController();
  const onCreateLabel = vi.fn<() => void>();
  const onSetLabel = vi.fn<(change: ThreadLabelChange) => void>();
  render(
    <LabelPickerHarness
      controller={controller}
      onCreateLabel={onCreateLabel}
      onSetLabel={onSetLabel}
    />
  );
  return {
    controller,
    onCreateLabel,
    onSetLabel,
    trigger: screen.getByRole("button", { name: "Manage labels" }),
  };
};

const receiptsApplied: ThreadLabelChange = {
  applied: true,
  labelId: "label-receipts",
  labelName: "Receipts",
};

describe("thread label picker", () => {
  it("toggles labels from checkbox items, by pointer and by Space, and stays open", async () => {
    const user = userEvent.setup();
    const { onSetLabel, trigger } = renderLabelPicker();

    await user.click(trigger);
    await act(settle);
    const travel = screen.getByRole("menuitemcheckbox", { name: "Travel" });
    const receipts = screen.getByRole("menuitemcheckbox", { name: "Receipts" });
    expect({
      icon: trigger.querySelector("svg") !== null,
      receipts: receipts.getAttribute("aria-checked"),
      travel: travel.getAttribute("aria-checked"),
    }).toStrictEqual({ icon: true, receipts: "false", travel: "true" });

    await user.click(receipts);
    travel.focus();
    await user.keyboard(" ");
    expect({
      changes: onSetLabel.mock.calls,
      open: screen.queryByRole("menu") !== null,
    }).toStrictEqual({
      changes: [
        [receiptsApplied],
        [{ applied: false, labelId: "label-travel", labelName: "Travel" }],
      ],
      open: true,
    });
  });

  it("runs Create new label from the keyboard, closes, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { onCreateLabel, trigger } = renderLabelPicker();

    trigger.focus();
    await user.keyboard("{Enter}");
    await act(settle);
    await user.keyboard("{End}{Enter}");
    await act(settle);
    expect({
      created: onCreateLabel.mock.calls.length,
      open: screen.queryByRole("menu") !== null,
      triggerFocused: isFocused(trigger),
    }).toStrictEqual({ created: 1, open: false, triggerFocused: true });
  });

  it("opens from Mod+L with focus on its first label, and Escape gives focus back", async () => {
    const user = userEvent.setup();
    const { controller } = renderLabelPicker();
    const body = screen.getByRole("button", { name: "Message body" });
    body.focus();

    await act(async () => {
      void controller.open({ focus: "first" });
      await settle();
    });
    expect(
      isFocused(screen.getByRole("menuitemcheckbox", { name: "Travel" }))
    ).toBeTruthy();
    await user.keyboard("{ArrowDown}");
    expect(
      isFocused(screen.getByRole("menuitemcheckbox", { name: "Receipts" }))
    ).toBeTruthy();

    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      bodyFocused: isFocused(body),
      open: screen.queryByRole("menu") !== null,
    }).toStrictEqual({ bodyFocused: true, open: false });
  });

  it("is named for agents, which can toggle a label and create one through it", async () => {
    const { onCreateLabel, onSetLabel } = renderLabelPicker();
    expect(agentControls()).toMatchObject(named(["Manage labels"]));
    expect(
      agent
        .snapshot()
        .filter((entry) => !entry.offPage && entry.label === "Manage labels")
        .map((entry) => entry.component)
    ).toStrictEqual(["menu"]);

    const result = await agent.act({
      steps: [
        { action: "press", args: ["Receipts"], ref: "Manage labels" },
        { action: "press", args: ["Create new label"], ref: "Manage labels" },
      ],
    });
    await act(settle);
    expect({
      changes: onSetLabel.mock.calls,
      created: onCreateLabel.mock.calls.length,
      ok: result.ok,
    }).toStrictEqual({
      changes: [[receiptsApplied]],
      created: 1,
      ok: true,
    });
  });
});

const renderScheduleMenu = (selectedScheduledAt?: number) => {
  vi.useFakeTimers({ now: new Date(2026, 10, 10, 9, 0), toFake: ["Date"] });
  const controller = createMenuController();
  const onChoose = vi.fn<(scheduledAt: number) => void>();
  render(
    <SendWithScheduleMenu
      controller={controller}
      disabled={false}
      onChoose={onChoose}
      selectedScheduledAt={selectedScheduledAt}
    >
      <Button type="button">Send</Button>
    </SendWithScheduleMenu>
  );
  return {
    controller,
    onChoose,
    trigger: screen.getByRole("button", {
      name:
        selectedScheduledAt === undefined
          ? "Schedule send"
          : /^Selected send time: /u,
    }),
  };
};

const openPickDateAndTime = async (
  user: ReturnType<typeof userEvent.setup>,
  controller: MenuController
) => {
  await act(async () => {
    void controller.open({ focus: "first" });
    await settle();
  });
  const firstItemFocused =
    document.activeElement?.getAttribute("role") === "menuitem";
  await user.keyboard("{End}{Enter}");
  await act(settle);
  const dialog = screen.getByRole("dialog", { name: "Pick date and time" });
  const time = within(dialog).getByRole("group", { name: "Time" });
  return {
    dateInput: within(dialog).getByRole<HTMLInputElement>("textbox", {
      name: "Date",
    }),
    dateTrigger: within(dialog).getByRole("button", { name: /^Choose date/u }),
    dialog,
    firstItemFocused,
    hour: within(time).getByRole("spinbutton", { name: "hour" }),
    timeValue: () =>
      time.querySelector<HTMLInputElement>(
        '[data-slot="time-input-hidden-input"]'
      )?.value,
  };
};

describe("schedule send", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chooses a preset from the menu", async () => {
    const user = userEvent.setup();
    const { onChoose, trigger } = renderScheduleMenu();

    await user.click(trigger);
    await act(settle);
    await user.click(screen.getAllByRole("menuitem")[0]);
    await act(settle);
    expect({
      chosen: onChoose.mock.calls.length,
      open: screen.queryByRole("menu") !== null,
      triggerFocused: isFocused(trigger),
    }).toStrictEqual({ chosen: 1, open: false, triggerFocused: true });
  });

  it("opens from Mod+Shift+Enter and moves focus into the date and time dialog", async () => {
    const user = userEvent.setup();
    const { controller } = renderScheduleMenu();

    const { firstItemFocused, hour } = await openPickDateAndTime(
      user,
      controller
    );
    expect({
      firstItemFocused,
      menuOpen: screen.queryByRole("menu") !== null,
      timeFocused: isFocused(hour),
    }).toStrictEqual({
      firstItemFocused: true,
      menuOpen: false,
      timeFocused: true,
    });
  });

  it("picks a date from today on, by pointer and by keyboard, then returns to the time", async () => {
    const user = userEvent.setup();
    const { controller } = renderScheduleMenu();
    const { dateInput, dateTrigger, hour } = await openPickDateAndTime(
      user,
      controller
    );

    await user.click(dateTrigger);
    await act(settle);
    const calendar = screen.getByRole("dialog", { name: "Choose date" });
    expect({
      focused: document.activeElement?.getAttribute("aria-label"),
      yesterday: within(calendar)
        .getByRole("gridcell", { name: "Monday, November 9, 2026" })
        .getAttribute("aria-disabled"),
    }).toStrictEqual({
      focused: "Tuesday, November 10, 2026",
      yesterday: "true",
    });
    expect(agentControls()).toMatchObject(
      named(["Date", "Time", "Use this time"])
    );

    await user.click(
      within(calendar).getByRole("gridcell", {
        name: "Friday, November 20, 2026",
      })
    );
    await act(settle);
    expect({
      calendarOpen: screen.queryByRole("dialog", { name: "Choose date" }),
      date: dateInput.value,
      timeFocused: isFocused(hour),
    }).toStrictEqual({
      calendarOpen: null,
      date: "11/20/2026",
      timeFocused: true,
    });

    await user.click(dateTrigger);
    await act(settle);
    const focusedOnOpen = document.activeElement?.getAttribute("aria-label");
    await user.keyboard("{ArrowRight}{Enter}");
    await act(settle);
    expect({
      date: dateInput.value,
      focusedOnOpen,
      timeFocused: isFocused(hour),
    }).toStrictEqual({
      date: "11/21/2026",
      focusedOnOpen: "Friday, November 20, 2026",
      timeFocused: true,
    });
  });

  it("returns focus to the date button on Escape and schedules the chosen day", async () => {
    const user = userEvent.setup();
    const { controller, onChoose } = renderScheduleMenu();
    const { dateTrigger, dialog, timeValue } = await openPickDateAndTime(
      user,
      controller
    );

    await user.click(dateTrigger);
    await act(settle);
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    await act(settle);
    await user.click(dateTrigger);
    await act(settle);
    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      dateFocused: isFocused(dateTrigger),
      dialogOpen: screen.queryByRole("dialog", { name: "Pick date and time" }),
    }).toStrictEqual({ dateFocused: true, dialogOpen: dialog });

    await user.click(
      within(dialog).getByRole("button", { name: "Use this time" })
    );
    await act(settle);
    const chosen = new Date(onChoose.mock.calls[0]?.[0] ?? 0);
    const hours = String(chosen.getHours()).padStart(2, "0");
    const minutes = String(chosen.getMinutes()).padStart(2, "0");
    expect({
      day: [chosen.getFullYear(), chosen.getMonth(), chosen.getDate()],
      time: `${hours}:${minutes}`,
    }).toStrictEqual({ day: [2026, 10, 12], time: timeValue() });
  });

  it("takes a typed date, refuses one before today, and schedules on Enter", async () => {
    const user = userEvent.setup();
    const { controller, onChoose } = renderScheduleMenu();
    const { dateInput, dialog } = await openPickDateAndTime(user, controller);

    await user.clear(dateInput);
    await user.type(dateInput, "11/9/2026{Enter}");
    await act(settle);
    // Refused by the picker itself, so the form never submits to say why.
    const yesterday = {
      alert: screen.queryByRole("alert"),
      chosen: onChoose.mock.calls.length,
      dialogOpen: screen.queryByRole("dialog", { name: "Pick date and time" }),
      invalid: dateInput.getAttribute("aria-invalid"),
    };
    await user.clear(dateInput);
    await user.type(dateInput, "11/21/2026{Enter}");
    await act(settle);
    const chosen = new Date(onChoose.mock.calls[0]?.[0] ?? 0);

    expect({
      day: [chosen.getFullYear(), chosen.getMonth(), chosen.getDate()],
      dialogOpen: screen.queryByRole("dialog", { name: "Pick date and time" }),
      yesterday,
    }).toStrictEqual({
      day: [2026, 10, 21],
      dialogOpen: null,
      yesterday: {
        alert: null,
        chosen: 0,
        dialogOpen: dialog,
        invalid: "true",
      },
    });
  });

  it("schedules on Enter in the time, as a form does", async () => {
    const user = userEvent.setup();
    const { controller, onChoose } = renderScheduleMenu();
    const { hour } = await openPickDateAndTime(user, controller);

    await user.type(hour, "{ArrowUp}{Enter}");
    await act(settle);

    expect({
      chosen: onChoose.mock.calls.length,
      dialogOpen: screen.queryByRole("dialog", { name: "Pick date and time" }),
    }).toStrictEqual({ chosen: 1, dialogOpen: null });
  });

  it("keeps the minutes while the hour is typed again by hand", async () => {
    const user = userEvent.setup();
    const { controller, onChoose } = renderScheduleMenu();
    const { hour, timeValue } = await openPickDateAndTime(user, controller);
    const initial = timeValue();
    const shownHour = (hour as HTMLInputElement).value;

    await user.type(hour, "{Backspace}{Backspace}");
    const whileEmpty = timeValue();
    await user.type(hour, shownHour);
    await act(settle);
    const retyped = timeValue();
    await user.click(screen.getByRole("button", { name: "Use this time" }));
    await act(settle);

    expect({ retyped, whileEmpty }).toStrictEqual({
      retyped: initial,
      whileEmpty: "",
    });
    expect(onChoose).toHaveBeenCalledOnce();
  });

  it("starts each opening of the date and time dialog from the initial time", async () => {
    const user = userEvent.setup();
    const { controller } = renderScheduleMenu();
    const first = await openPickDateAndTime(user, controller);
    const initial = first.timeValue();

    await user.type(first.hour, "{ArrowUp}");
    const changed = first.timeValue();
    await user.click(
      within(first.dialog).getByRole("button", { name: "Cancel" })
    );
    await act(settle);
    const second = await openPickDateAndTime(user, controller);

    expect({
      changed: changed !== initial,
      reopened: second.timeValue(),
    }).toStrictEqual({ changed: true, reopened: initial });
  });

  it("lets an agent choose a date from today on", async () => {
    const user = userEvent.setup();
    const { controller } = renderScheduleMenu();
    const { dateInput } = await openPickDateAndTime(user, controller);

    const chosen = await agent.act({
      steps: [{ action: "setValue", args: ["2026-11-25"], ref: "Date" }],
    });
    await act(settle);
    const afterChoosing = dateInput.value;
    await agent.act({
      steps: [{ action: "setValue", args: ["2026-11-01"], ref: "Date" }],
    });
    await act(settle);
    expect({
      afterChoosing,
      afterPast: dateInput.value,
      ok: chosen.ok,
    }).toStrictEqual({
      afterChoosing: "11/25/2026",
      afterPast: "11/25/2026",
      ok: true,
    });
  });

  it("says the chosen send time in the trigger's name, which is never pressed", () => {
    const { trigger } = renderScheduleMenu(
      new Date(2026, 10, 12, 8, 30).getTime()
    );

    expect(trigger.getAttribute("aria-pressed")).toBeNull();
  });

  it("names the split button's controls for agents", () => {
    renderScheduleMenu();
    expect(agentControls()).toMatchObject(named(["Schedule send", "Send"]));
  });
});

const CreateReplyHarness = ({
  onCreate,
}: {
  onCreate: (instructions?: string) => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        Shortcut
      </Button>
      <AiComposerButton
        command="threadComposer.createReply"
        disabled={false}
        icon={MessageSquarePlusIcon}
        isWorking={false}
        label="Create reply"
        modelLabel="Test model"
        popover={{
          content: (
            <CreateReplyForm
              onClose={() => setOpen(false)}
              onCreate={onCreate}
              textareaRef={textareaRef}
            />
          ),
          handleOpenChange: setOpen,
          initialFocus: textareaRef,
          open,
        }}
        workingLabel="Creating…"
      />
    </>
  );
};

describe("create reply popover", () => {
  it("focuses the instructions when opened by its button or its shortcut", async () => {
    const user = userEvent.setup();
    render(<CreateReplyHarness onCreate={() => Promise.resolve()} />);
    const trigger = screen.getByRole("button", { name: "Create reply" });

    await user.click(trigger);
    await act(settle);
    expect(
      isFocused(screen.getByRole("textbox", { name: "Reply instructions" }))
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    await act(settle);
    expect({
      open: screen.queryByRole("dialog") !== null,
      triggerFocused: isFocused(trigger),
    }).toStrictEqual({ open: false, triggerFocused: true });

    await user.click(screen.getByRole("button", { name: "Shortcut" }));
    await act(settle);
    expect(
      isFocused(screen.getByRole("textbox", { name: "Reply instructions" }))
    ).toBeTruthy();
    expect(agentControls()).toMatchObject(
      named(["Create reply", "Shortcut", "Reply instructions"])
    );
  });
});

describe("disabled AI composer button", () => {
  it.each([
    ["without a popover", false],
    ["with a popover", true],
  ] as const)(
    "stays focusable and named, and ignores presses, %s",
    async (_case, hasPopover) => {
      const user = userEvent.setup();
      const onClick = vi.fn<() => void>();
      const handleOpenChange = vi.fn<(open: boolean) => void>();
      render(
        <AiComposerButton
          command="threadComposer.createReply"
          disabled
          icon={MessageSquarePlusIcon}
          isWorking={false}
          label="Create reply"
          modelLabel="Test model"
          onClick={onClick}
          popover={
            hasPopover
              ? {
                  content: <p>Instructions</p>,
                  handleOpenChange,
                  initialFocus: { current: null },
                  open: false,
                }
              : undefined
          }
          workingLabel="Creating…"
        />
      );
      await act(settle);
      const button = screen.getByRole("button", { name: "Create reply" });

      await user.tab();
      expect(isFocused(button)).toBeTruthy();
      expect(button.getAttribute("aria-disabled")).toBe("true");
      await user.click(button);
      await user.keyboard("{Enter}");
      await act(settle);
      expect(onClick).not.toHaveBeenCalled();
      expect(handleOpenChange).not.toHaveBeenCalled();
    }
  );
});
