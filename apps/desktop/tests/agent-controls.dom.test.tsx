import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FieldErrorIndicator from "../src/renderer/src/components/forms/field-error-indicator";
import MailCopyEmailButton from "../src/renderer/src/components/mail/copy-email-button";
import LabelColorField from "../src/renderer/src/components/mail/label-color-field";
import MailLabelBadge from "../src/renderer/src/components/mail/mail-label-badge";
import NewMessageFooter from "../src/renderer/src/components/mail/new-message/new-message-footer";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "../src/renderer/src/components/mail/new-message/new-message-store";
import NewMessageTitlebar from "../src/renderer/src/components/mail/new-message/new-message-titlebar";
import type { useNewMessageWorkspace } from "../src/renderer/src/components/mail/new-message/use-new-message-workspace";
import { SendWithScheduleMenu } from "../src/renderer/src/components/mail/schedule-send-menu";
import MailThreadDraftActions from "../src/renderer/src/components/mail/thread-draft-actions";
import { TitlebarSlotContext } from "../src/renderer/src/components/shell/titlebar-slot";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../src/renderer/src/components/ui/alert-dialog";
import { Button } from "../src/renderer/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../src/renderer/src/components/ui/dialog";
import {
  createMenuController,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "../src/renderer/src/components/ui/menu";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "../src/renderer/src/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../src/renderer/src/components/ui/tooltip";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import { getHotkeyDisplay } from "../src/renderer/src/hotkeys/commands";
import {
  formatScheduledAt,
  getSchedulePresets,
} from "../src/renderer/src/scheduled/schedule-time";

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

const onPage = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

const kindsNamed = (label: string) =>
  onPage()
    .filter((entry) => entry.label === label)
    .map((entry) => entry.component);

type Workspace = ReturnType<typeof useNewMessageWorkspace>;

const scheduledControls = () => ({
  canSchedule: true,
  isDirty: false,
  isEdit: false,
  onDiscard: vi.fn<() => Promise<boolean>>(),
  onPendingScheduleChange: vi.fn<(pending: boolean) => void>(),
  onSave: vi.fn<() => Promise<boolean>>(),
  onSchedule: vi.fn<(scheduledAt: number) => Promise<boolean>>(),
  scheduledAt: undefined,
});

describe("agent-ready controls", () => {
  afterEach(() => {
    approve = false;
    asked.length = 0;
    vi.restoreAllMocks();
  });

  describe("Kisa's Button as a popup trigger", () => {
    it("is listed once, as the popup it opens, and stays a button for people", async () => {
      render(
        <>
          <Menu>
            <MenuTrigger render={<Button aria-label="Row actions" />} />
            <MenuContent>
              <MenuItem>Archive</MenuItem>
            </MenuContent>
          </Menu>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>
              Pick color
            </PopoverTrigger>
            <PopoverContent>
              <PopoverTitle>Colors</PopoverTitle>
            </PopoverContent>
          </Popover>
          <Dialog>
            <DialogTrigger render={<Button />}>Edit signature</DialogTrigger>
            <DialogContent>
              <DialogTitle>Signature</DialogTitle>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger render={<Button />}>
              Remove all
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Remove everything?</AlertDialogTitle>
              <AlertDialogClose value="confirm">Yes</AlertDialogClose>
            </AlertDialogContent>
          </AlertDialog>
          <Tooltip>
            <TooltipTrigger render={<Button aria-label="Mark as read" />} />
            <TooltipContent>Mark as read</TooltipContent>
          </Tooltip>
        </>
      );
      await act(settle);

      expect({
        dialog: kindsNamed("Edit signature"),
        menu: kindsNamed("Row actions"),
        plain: kindsNamed("Mark as read"),
        popover: kindsNamed("Pick color"),
        warning: kindsNamed("Remove all"),
      }).toStrictEqual({
        dialog: ["dialog"],
        menu: ["menu"],
        plain: ["button"],
        popover: ["popover"],
        warning: ["alert-dialog"],
      });
      const trigger = screen.getByRole("button", { name: "Pick color" });
      expect({
        expanded: trigger.getAttribute("aria-expanded"),
        look: trigger.className.includes("bg-input/20"),
        slot: trigger.dataset.slot,
        type: trigger.getAttribute("type"),
      }).toStrictEqual({
        expanded: "false",
        look: true,
        slot: "button",
        type: "button",
      });

      const result = await agent.act({
        steps: [{ action: "press", args: ["Archive"], ref: "Row actions" }],
      });
      expect(result.ok).toBeTruthy();
    });

    it("stays shut while disabled, for people and for agents", async () => {
      render(
        <SendWithScheduleMenu
          controller={createMenuController()}
          disabled
          onChoose={vi.fn<(scheduledAt: number) => void>()}
          selectedScheduledAt={undefined}
        >
          <Button type="button">Send</Button>
        </SendWithScheduleMenu>
      );
      await act(settle);

      const trigger = screen.getByRole("button", { name: "Schedule send" });
      const pressed = await agent.act({
        steps: [{ action: "press", ref: "Schedule send" }],
      });
      // setOpen is not refused by a disabled trigger; the menu cancels it.
      const opened = await agent.act({
        steps: [{ action: "setOpen", args: [true], ref: "Schedule send" }],
      });
      await act(settle);
      expect({
        disabled: [trigger.hasAttribute("disabled"), trigger.dataset.disabled],
        ok: [pressed.ok, opened.ok],
        open: screen.queryByRole("menu") !== null,
      }).toStrictEqual({
        disabled: [true, ""],
        ok: [false, true],
        open: false,
      });
    });
  });

  describe("the new email's Send and Schedule", () => {
    it("sends, or schedules for the chosen time, only once a person agrees", async () => {
      const onSend = vi.fn<() => Promise<void>>().mockResolvedValue();
      const scheduled = scheduledControls();
      scheduled.onSchedule.mockResolvedValue(true);
      render(
        <AppHotkeysProvider>
          <NewMessageFooter
            canSend
            canStash
            delivery={{
              recipients: { bcc: [], cc: [], to: ["ana@example.com"] },
              subject: "Lunch?",
            }}
            isScheduling={false}
            isSending={false}
            onSend={onSend}
            onStash={vi.fn<() => void>()}
            scheduled={scheduled}
            sendShortcutLabel="Send"
          />
        </AppHotkeysProvider>
      );
      await act(settle);
      expect(
        onPage().find((entry) => entry.label === "Send email")?.confirm
      ).toBe("Sends “Lunch?” to ana@example.com");

      const send = { steps: [{ action: "press", ref: "Send email" }] };
      const refused = await agent.act(send);
      approve = true;
      const sent = await agent.act(send);
      expect({
        ok: [refused.ok, sent.ok],
        sends: onSend.mock.calls.length,
      }).toStrictEqual({ ok: [false, true], sends: 1 });

      const [preset] = getSchedulePresets(new Date());
      asked.length = 0;
      const chosen = await agent.act({
        steps: [
          { action: "press", args: [preset?.label], ref: "Schedule send" },
        ],
      });
      await act(settle);
      const schedule = screen.getByRole("button", { name: "Schedule email" });
      expect({
        asked,
        confirm: schedule.dataset.agentConfirm,
        ok: chosen.ok,
        scheduled: scheduled.onSchedule.mock.calls.length,
      }).toStrictEqual({
        asked: [],
        confirm: `Schedules “Lunch?” to ana@example.com for ${formatScheduledAt(preset?.scheduledAt ?? 0)}`,
        ok: true,
        scheduled: 0,
      });

      const scheduledNow = await agent.act({
        steps: [{ action: "press", ref: "Schedule email" }],
      });
      expect({
        asked: asked.length,
        ok: scheduledNow.ok,
        scheduled: scheduled.onSchedule.mock.calls,
      }).toStrictEqual({
        asked: 1,
        ok: true,
        scheduled: [[preset?.scheduledAt]],
      });
    });
  });

  describe("controls that were plain buttons", () => {
    it("copies an address when an agent presses Copy", async () => {
      const writeText = vi.fn<(text: string) => Promise<void>>();
      writeText.mockResolvedValue();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(<MailCopyEmailButton email="ana@example.com" />);
      await act(settle);

      const copied = await agent.act({
        steps: [{ action: "press", ref: "Copy ana@example.com" }],
      });
      expect({
        copied: writeText.mock.calls,
        ok: copied.ok,
        text: screen.getByRole("button", { name: "Copy ana@example.com" })
          .textContent,
      }).toStrictEqual({
        copied: [["ana@example.com"]],
        ok: true,
        text: "ana@example.com",
      });
    });

    it("edits and removes a label from its badge's own buttons", async () => {
      const onClick = vi.fn<() => void>();
      const onRemove = vi.fn<() => void>();
      render(
        <MailLabelBadge
          label="Travel"
          onClick={onClick}
          onClickAriaLabel="Edit Travel for ana@example.com"
          onRemove={onRemove}
          removeAriaLabel="Delete Travel for ana@example.com"
        />
      );
      await act(settle);

      const result = await agent.act({
        steps: [
          { action: "press", ref: "Edit Travel for ana@example.com" },
          { action: "press", ref: "Delete Travel for ana@example.com" },
        ],
      });
      expect({
        edits: onClick.mock.calls.length,
        ok: result.ok,
        removes: onRemove.mock.calls.length,
      }).toStrictEqual({ edits: 1, ok: true, removes: 1 });
    });

    it("reads a label's preview as text, without a name on its plain badge", () => {
      render(
        <LabelColorField
          disabled={false}
          label="Travel"
          onValueChange={vi.fn<(color: string) => void>()}
          value="#4a86e8"
        />
      );

      const preview = screen.getByText("Travel", { selector: "span.truncate" });
      expect({
        badgeName: preview
          .closest("[data-slot=badge]")
          ?.hasAttribute("aria-label"),
        read: screen.getByRole("group", { name: "Label color" }).textContent,
        style: preview.closest("[data-slot=badge]")?.getAttribute("style"),
      }).toMatchObject({
        badgeName: false,
        read: expect.stringContaining("Label preview:Travel"),
        style: expect.stringContaining("color: rgb(0, 0, 0)"),
      });
    });

    it("picks a label's color by hex, a random roll, or an agent, and refuses a translucent one", async () => {
      const user = userEvent.setup();
      const picks: string[] = [];
      const Field = () => {
        const [color, setColor] = useState("#4a86e8");
        return (
          <LabelColorField
            disabled={false}
            label="Travel"
            onValueChange={(next) => {
              picks.push(next);
              setColor(next);
            }}
            value={color}
          />
        );
      };
      render(<Field />);

      const closed = onPage().map(({ component, label }) => ({
        component,
        label,
      }));
      await user.click(screen.getByRole("button", { name: "Pick color" }));
      await act(settle);
      const eyeDropper = screen.getByRole("button", {
        name: "Pick from screen",
      });
      const hex = screen.getByRole("textbox", { name: "Hex color" });
      await user.clear(hex);
      await user.type(hex, "#22C55E{Enter}");
      const typed = picks.at(-1);
      await user.clear(hex);
      await user.type(hex, "rgb(0 0 255 / 50%){Enter}");
      const afterTranslucent = picks.length;
      await user.click(screen.getByRole("button", { name: "Random color" }));
      const agentChoice = await createAgent().act({
        steps: [{ action: "setValue", args: ["#FF0000"], ref: "Label color" }],
      });

      expect({
        agent: agentChoice.ok,
        closed,
        eyeDropperUnsupported: Object.hasOwn(eyeDropper.dataset, "unsupported"),
        last: picks.at(-1),
        typed,
        translucentRefused: afterTranslucent === 1,
        random: picks[1],
      }).toStrictEqual({
        agent: true,
        closed: [
          { component: "popover", label: "Pick color" },
          { component: "button", label: "Random color" },
          { component: "color-picker", label: "Label color" },
        ],
        eyeDropperUnsupported: true,
        last: "#ff0000",
        typed: "#22c55e",
        random: expect.stringMatching(/^#[0-9a-f]{6}$/u),
        translucentRefused: true,
      });
    });

    it("goes back to Scheduled from a scheduled email's title", async () => {
      const slot = document.createElement("div");
      document.body.append(slot);
      const leave = vi.fn<() => Promise<void>>().mockResolvedValue();
      const workspace: Partial<Workspace> = {
        availableStashes: [],
        canSend: true,
        canStash: false,
        isBusy: false,
        isCleaning: false,
        leave,
        scheduled: {
          ...scheduledControls(),
          isEdit: true,
          scheduledAt: new Date(2030, 4, 20, 13).getTime(),
        } as Workspace["scheduled"],
        sendDisplay: getHotkeyDisplay("composer.send"),
      };
      render(
        <AppHotkeysProvider>
          <NewMessageStoreProvider
            store={createNewMessageStore("me@example.com")}
          >
            <TitlebarSlotContext.Provider value={slot}>
              <NewMessageTitlebar
                accountsCount={1}
                titleId="composer-title"
                workspace={workspace as Workspace}
              />
            </TitlebarSlotContext.Provider>
          </NewMessageStoreProvider>
        </AppHotkeysProvider>
      );
      await act(settle);

      const result = await agent.act({
        steps: [{ action: "press", ref: "Back to Scheduled" }],
      });
      expect({ left: leave.mock.calls.length, ok: result.ok }).toStrictEqual({
        left: 1,
        ok: true,
      });
      slot.remove();
    });

    it("discards a saved reply only once a person agrees", async () => {
      const onDiscard = vi.fn<() => void>();
      render(
        <MailThreadDraftActions
          action="reply"
          disabled={false}
          onContinue={vi.fn<() => void>()}
          onDiscard={onDiscard}
        />
      );
      await act(settle);
      expect(
        onPage().find((entry) => entry.label === "Discard draft")?.confirm
      ).toBe("Deletes this saved draft and what it says");

      const discard = { steps: [{ action: "press", ref: "Discard draft" }] };
      const refused = await agent.act(discard);
      approve = true;
      const allowed = await agent.act(discard);
      expect({
        discarded: onDiscard.mock.calls.length,
        ok: [refused.ok, allowed.ok],
      }).toStrictEqual({ discarded: 1, ok: [false, true] });
    });

    it("lists a field's error for agents by its message", async () => {
      render(<FieldErrorIndicator id="name-error" message="Name is taken" />);
      await act(settle);

      expect(kindsNamed("Name is taken")).toStrictEqual(["button"]);
      expect(screen.getByRole("alert").textContent).toBe("Name is taken");
    });
  });
});
