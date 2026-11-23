import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import FileSelectionRow from "../src/renderer/src/components/file-selection-row";
import { OutgoingAttachmentButton } from "../src/renderer/src/components/mail/outgoing-attachments";
import { createFileInputController } from "../src/renderer/src/components/ui/file-input";
import { getHotkeyDisplay } from "../src/renderer/src/hotkeys/commands";

// jsdom has no DragEvent, which ui-sdk reads a drop's reason from.
if (!("DragEvent" in globalThis)) {
  class DragEventPolyfill extends MouseEvent {
    dataTransfer: DataTransfer | null = null;
  }
  Object.assign(globalThis, { DragEvent: DragEventPolyfill });
}

const fileNamed = (name: string) =>
  new File(["x"], name, { type: "text/plain" });

const dropFiles = (target: Element, files: readonly File[]): void => {
  const fileList = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  });
  const dataTransfer = {
    dropEffect: "none",
    effectAllowed: "all",
    files: fileList,
    getData: () => "",
    items: files.map((file) => ({
      getAsFile: () => file,
      kind: "file",
      type: file.type,
    })),
    setData: () => {},
    types: ["Files"],
  };
  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new DragEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(target, event);
  }
};

const ATTACH = getHotkeyDisplay("composer.attach").label;

describe(OutgoingAttachmentButton, () => {
  afterEach(cleanup);

  it("hands each pick to the draft and holds none of its own", async () => {
    const onFiles = vi.fn<(files: readonly File[]) => void>();
    const picker = createFileInputController();
    render(
      <OutgoingAttachmentButton
        command="composer.attach"
        onFiles={onFiles}
        picker={picker}
      />
    );
    const notes = fileNamed("notes.txt");

    act(() => {
      picker.addFiles([notes]);
    });
    act(() => {
      picker.addFiles([notes]);
    });
    await act(settle);

    expect({
      entries: createAgent()
        .snapshot()
        .filter((entry) => entry.label === ATTACH)
        .map(({ component }) => component),
      held: picker.getValue().length,
      picks: onFiles.mock.calls.map(([files]) => files.map(({ name }) => name)),
    }).toStrictEqual({
      entries: ["file-input"],
      held: 0,
      picks: [["notes.txt"], ["notes.txt"]],
    });
  });

  it("lets the shortcut's controller open the picker, unless disabled", () => {
    const picker = createFileInputController();
    const button = (disabled: boolean) => (
      <OutgoingAttachmentButton
        command="composer.attach"
        disabled={disabled}
        onFiles={vi.fn<(files: readonly File[]) => void>()}
        picker={picker}
      />
    );
    const { rerender } = render(button(false));

    const opened = picker.open();
    rerender(button(true));

    expect({ opened, openedWhileDisabled: picker.open() }).toStrictEqual({
      opened: true,
      openedWhileDisabled: false,
    });
  });
});

describe(FileSelectionRow, () => {
  afterEach(cleanup);

  it("hands on a dropped file, and ignores drops while it can't take one", async () => {
    const onDropFile = vi.fn<(file: File) => void>();
    const row = (disabled: boolean) => (
      <FileSelectionRow
        disabled={disabled}
        isSelecting={false}
        label="Database"
        onDropFile={onDropFile}
        onSelect={vi.fn<() => void>()}
      />
    );
    const { rerender } = render(row(false));
    const zone = screen.getByText("Select a file or drop it here");

    dropFiles(zone, [fileNamed("mail.sqlite")]);
    await act(settle);
    rerender(row(true));
    dropFiles(zone, [fileNamed("other.sqlite")]);
    await act(settle);

    expect(onDropFile.mock.calls.map(([file]) => file.name)).toStrictEqual([
      "mail.sqlite",
    ]);
    expect(
      createAgent()
        .snapshot()
        .filter((entry) => entry.label === "Database")
        .map(({ component }) => component)
    ).toStrictEqual(["file-input"]);
  });
});
