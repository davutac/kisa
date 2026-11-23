import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { registerShortcut } from "@ui-sdk/react/shortcuts";
import { ArchiveIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../src/renderer/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../src/renderer/src/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../src/renderer/src/components/ui/tooltip";

const agent = createAgent();

const RenameDialog = ({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) => (
  <Dialog onOpenChange={onOpenChange}>
    <DialogTrigger render={<Button variant="outline" />}>
      Rename label
    </DialogTrigger>
    <DialogContent>
      <DialogTitle>Rename Travel</DialogTitle>
      <DialogDescription>
        Labels are renamed in every account.
      </DialogDescription>
    </DialogContent>
  </Dialog>
);

const tooltipClosesAtOnce = (): boolean => {
  const content = document.querySelector<HTMLElement>(
    '[data-slot="tooltip-content"]'
  );
  return content !== null && Object.hasOwn(content.dataset, "closesAtOnce");
};

describe("ui primitives", () => {
  it("opens a dialog from its trigger and names its close button", async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);

    await user.click(screen.getByRole("button", { name: "Rename label" }));

    const dialog = screen.getByRole("dialog", { name: "Rename Travel" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("closes on Escape and the close button, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<RenameDialog onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Rename label" });

    await user.click(trigger);
    await user.keyboard("{Escape}");
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await act(settle);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toStrictEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("names an icon-only button through its tooltip", async () => {
    render(
      <Tooltip>
        <TooltipTrigger render={<Button size="icon" variant="ghost" />}>
          <ArchiveIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>Archive</TooltipContent>
      </Tooltip>
    );
    await act(settle);

    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("closes an open tooltip on Escape and lets the key reach the app", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn<() => void>();
    const unregister = registerShortcut("escape", onEscape);
    render(
      <Tooltip>
        <TooltipTrigger render={<Button size="icon" variant="ghost" />}>
          <ArchiveIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>Archive</TooltipContent>
      </Tooltip>
    );
    await act(settle);

    await user.hover(screen.getByRole("button", { name: "Archive" }));
    await act(settle);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    await user.keyboard("{Escape}");
    await act(settle);
    unregister();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("closes a tooltip at once when its trigger is pressed, and with its fade when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip>
          <TooltipTrigger render={<Button size="icon" variant="ghost" />}>
            <ArchiveIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Button>Elsewhere</Button>
      </>
    );
    await act(settle);
    const trigger = screen.getByRole("button", { name: "Archive" });

    await user.hover(trigger);
    await act(settle);
    await user.click(trigger);
    await act(settle);
    const afterPress = tooltipClosesAtOnce();
    await user.hover(screen.getByRole("button", { name: "Elsewhere" }));
    await act(settle);
    await user.hover(trigger);
    await act(settle);
    const whileOpen = tooltipClosesAtOnce();
    await user.hover(screen.getByRole("button", { name: "Elsewhere" }));
    await act(settle);

    expect({
      afterLeave: tooltipClosesAtOnce(),
      afterPress,
      whileOpen,
    }).toStrictEqual({ afterLeave: false, afterPress: true, whileOpen: false });
  });

  it("keeps a button pending while its action runs", async () => {
    const user = userEvent.setup();
    const saving = Promise.withResolvers<undefined>();
    const save = vi.fn<() => Promise<undefined>>(() => saving.promise);
    render(<Button onClick={save}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });

    await user.click(button);
    await user.click(button);
    expect(save).toHaveBeenCalledOnce();
    expect(Object.hasOwn(button.dataset, "pending")).toBeTruthy();

    await act(async () => {
      saving.resolve(undefined);
      await saving.promise;
    });
    expect(Object.hasOwn(button.dataset, "pending")).toBeFalsy();
  });

  it("lets an agent find and open the dialog by name", async () => {
    render(<RenameDialog />);

    const labels = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more")
      .map((entry) => entry.label);
    expect(labels).toContain("Rename label");

    const result = await agent.act({
      steps: [{ ref: "Rename label", action: "press" }],
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Rename Travel" })).toBeTruthy();
  });
});
