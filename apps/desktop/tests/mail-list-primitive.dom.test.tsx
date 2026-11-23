import {
  checkDirection,
  checkServer,
  mount,
  settle,
} from "@ui-sdk/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mailList } from "../src/renderer/src/primitives/mail-list";
import type {
  MailListActivateDetails,
  MailListOptions,
} from "../src/renderer/src/primitives/mail-list";

const ROWS = [
  { key: "a:1", label: "Alpha" },
  { key: "a:2", label: "Bravo" },
  { key: "b:1", label: "Charlie" },
] as const;
const KEYS = ROWS.map(({ key }) => key);
const ROW_HEIGHT = 40;

const labelOf = (key: string): string =>
  ROWS.find((row) => row.key === key)?.label ?? key;

const row = ({ key, label }: (typeof ROWS)[number]) => `
  <row value="${key}">
    <cell><open aria-label="${label}">${label}</open><check><input type="checkbox" aria-label="Select ${label}" /></check></cell>
    <actions><button type="button">Read ${label}</button><button type="button">Trash ${label}</button></actions>
  </row>`;

const MARKUP = `<root aria-label="Inbox" tabindex="-1"><grid aria-label="Conversations">${ROWS.map(row).join("")}</grid></root>`;

const mousePointer = (type: string, y: number) =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: 20,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
  });

const mountList = (options: Partial<MailListOptions> = {}) => {
  const onActivate =
    vi.fn<(key: string, details: MailListActivateDetails) => void>();
  const view = mount(
    mailList,
    {
      checkable: true,
      estimate: 40,
      keys: KEYS,
      labelOf,
      onActivate,
      ...options,
    },
    MARKUP
  );
  // jsdom lays nothing out: rows stack ROW_HEIGHT apart in a list that shows
  // them all, and the row under a point is the one at its height.
  view.root.getBoundingClientRect = () =>
    DOMRect.fromRect({ height: 120, width: 300, x: 0, y: 0 });
  for (const [index, key] of KEYS.entries()) {
    for (const slot of ["row", "open", "check"] as const) {
      const el = view.part(slot, key);
      if (el !== undefined) {
        el.getBoundingClientRect = () =>
          DOMRect.fromRect({
            height: ROW_HEIGHT,
            width: 300,
            x: 0,
            y: index * ROW_HEIGHT,
          });
      }
    }
  }
  document.elementsFromPoint = (_x: number, y: number) => {
    const el = view.part("open", KEYS[Math.floor(y / ROW_HEIGHT)] ?? "");
    return el === undefined ? [] : [el];
  };
  return { onActivate, view };
};

const open = (view: ReturnType<typeof mountList>["view"], key: string) => {
  const el = view.part("open", key);
  if (el === undefined) {
    throw new Error(`No open control for ${key}`);
  }
  return el;
};

describe("mail list primitive", () => {
  afterEach(() => {
    document.elementsFromPoint = () => [];
  });

  it("is a named, multi-selectable grid of rows with one tab stop", () => {
    const { view } = mountList();
    try {
      const grid = view.part("grid");
      expect({
        multiselectable: grid?.getAttribute("aria-multiselectable"),
        role: grid?.getAttribute("role"),
        rowcount: grid?.getAttribute("aria-rowcount"),
        rowindexes: KEYS.map((key) =>
          view.part("row", key)?.getAttribute("aria-rowindex")
        ),
        selected: KEYS.map((key) =>
          view.part("row", key)?.getAttribute("aria-selected")
        ),
        tabstops: KEYS.map((key) => open(view, key).getAttribute("tabindex")),
      }).toStrictEqual({
        multiselectable: "true",
        role: "grid",
        rowcount: "3",
        rowindexes: ["1", "2", "3"],
        selected: ["false", "false", "false"],
        tabstops: ["0", "-1", "-1"],
      });
    } finally {
      view.unmount();
    }
  });

  it("leaves bulk selection out of a list without checkable rows", () => {
    const { view } = mountList({ checkable: false });
    try {
      expect({
        multiselectable: view
          .part("grid")
          ?.hasAttribute("aria-multiselectable"),
        selected: view.part("row", "a:1")?.hasAttribute("aria-selected"),
      }).toStrictEqual({ multiselectable: false, selected: false });
      expect(() => view.api.toggle("a:1")).toThrow("can't be checked");
    } finally {
      view.unmount();
    }
  });

  it("moves the current row and focus with the arrows, one row at a time", async () => {
    const { view } = mountList();
    try {
      await view.keys("Tab");
      const tabbed = document.activeElement;
      await view.keys("ArrowDown");
      const moved = {
        current: view.state.current,
        focused: document.activeElement,
        marks: KEYS.map((key) => open(view, key).getAttribute("aria-current")),
        stop: open(view, "a:2").getAttribute("tabindex"),
      };
      await view.keys("ArrowDown", "ArrowDown", "ArrowUp");
      expect({
        last: view.changes.at(-1),
        moved,
        tabbed,
        upFromEnd: view.state.current,
      }).toStrictEqual({
        last: expect.objectContaining({
          key: "current",
          reason: "list-navigation",
          source: "keyboard",
        }),
        moved: {
          current: "a:2",
          focused: open(view, "a:2"),
          marks: [null, "true", null],
          stop: "0",
        },
        tabbed: open(view, "a:1"),
        upFromEnd: "a:2",
      });
    } finally {
      view.unmount();
    }
  });

  it("steps between a row's open control and its actions with Left and Right", async () => {
    const { view } = mountList();
    try {
      open(view, "a:2").focus();
      const visited: (string | null | undefined)[] = [];
      for (const key of [
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
        "ArrowLeft",
        "ArrowLeft",
        "ArrowRight",
        "ArrowDown",
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each press finishes before the next.
        await view.keys(key);
        visited.push(document.activeElement?.textContent);
      }
      expect(visited).toStrictEqual([
        "Read Bravo",
        "Trash Bravo",
        "Trash Bravo",
        "Read Bravo",
        "Bravo",
        "Read Bravo",
        "Charlie",
      ]);
    } finally {
      view.unmount();
    }
  });

  it("opens a row on a press and tells a pointer from the keyboard", async () => {
    const { onActivate, view } = mountList();
    try {
      await view.click(open(view, "a:2"));
      const clicked = view.state.current;
      await view.keys("Enter");
      view.api.open("Charlie");
      expect({
        calls: onActivate.mock.calls.map(([key, { source }]) => [key, source]),
        clicked,
      }).toStrictEqual({
        calls: [
          ["a:2", "pointer"],
          ["a:2", "keyboard"],
          ["b:1", "agent"],
        ],
        clicked: "a:2",
      });
    } finally {
      view.unmount();
    }
  });

  it("toggles a row by key or label, and clears with focus kept in the list", async () => {
    const { view } = mountList();
    try {
      view.api.toggle("Bravo");
      view.api.toggle("b:1");
      const toggled = {
        checked: view.state.checked,
        row: view.part("row", "a:2")?.getAttribute("aria-selected"),
      };
      expect(() => view.api.toggle("Delta")).toThrow('No row "Delta"');
      open(view, "a:1").focus();
      view.api.clear();
      await view.settle();
      expect({
        announced: view.announced.join(" "),
        checked: view.state.checked,
        current: view.state.current,
        focused: document.activeElement,
        toggled,
      }).toStrictEqual({
        announced: expect.stringContaining("Selection cleared"),
        checked: [],
        current: null,
        focused: view.root,
        toggled: { checked: ["a:2", "b:1"], row: "true" },
      });
    } finally {
      view.unmount();
    }
  });

  it("paints the rows a drag crosses once it passes the 15 pixel tolerance", async () => {
    const { view } = mountList();
    try {
      await view.drag(open(view, "a:1"), { by: { x: 0, y: 10 } });
      const short = view.state.checked;
      await view.drag(open(view, "a:1"), { by: { x: 0, y: 85 } });
      await view.settle();
      expect({
        announced: view.announced.join(" "),
        checked: view.state.checked,
        current: view.state.current,
        settled: view.settled.at(-1),
        short,
      }).toStrictEqual({
        announced: expect.stringContaining("3 selected"),
        checked: ["a:1", "a:2", "b:1"],
        current: "b:1",
        settled: expect.objectContaining({ key: "checked", reason: "drag" }),
        short: [],
      });
    } finally {
      view.unmount();
    }
  });

  it("opens a row whose press wanders less than the tolerance before it lifts", async () => {
    const { onActivate, view } = mountList();
    try {
      const pressed = open(view, "a:1");
      pressed.dispatchEvent(mousePointer("pointerdown", 20));
      pressed.ownerDocument.dispatchEvent(mousePointer("pointermove", 24));
      await view.settle();
      pressed.ownerDocument.dispatchEvent(mousePointer("pointermove", 30));
      await view.settle();
      pressed.dispatchEvent(mousePointer("pointerup", 30));
      pressed.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })
      );
      await view.settle();
      expect({
        checked: view.state.checked,
        opened: onActivate.mock.calls.map(([key]) => key),
      }).toStrictEqual({ checked: [], opened: ["a:1"] });
    } finally {
      view.unmount();
    }
  });

  it("paints from a checkbox at once, and keeps a press under the tolerance a click", async () => {
    const { onActivate, view } = mountList();
    try {
      const check = view.part("check", "a:2");
      if (check === undefined) {
        throw new Error("No checkbox");
      }
      await view.drag(check, { by: { x: 0, y: 2 } });
      const painted = view.state.checked;
      const openedByPaint = onActivate.mock.calls.length;
      await view.click(open(view, "b:1"));
      expect({
        opened: onActivate.mock.calls.map(([key, { source }]) => [key, source]),
        openedByPaint,
        painted,
      }).toStrictEqual({
        opened: [["b:1", "pointer"]],
        openedByPaint: 0,
        painted: ["a:2"],
      });
    } finally {
      view.unmount();
    }
  });

  it("lists every row for an agent, by label", () => {
    const { view } = mountList();
    try {
      expect(view.api.rowItems()).toStrictEqual(
        ROWS.map(({ key, label }) => ({ label, value: key }))
      );
    } finally {
      view.unmount();
    }
  });

  it("renders on the server", () => {
    const html = checkServer(
      mailList,
      { checkable: true, defaultCurrent: "a:2", estimate: 40, keys: KEYS },
      MARKUP
    );
    expect([
      html.includes('aria-current="true"'),
      html.includes('role="grid"'),
    ]).toStrictEqual([true, true]);
  });

  it("works in both directions", async () => {
    await expect(
      checkDirection(
        mailList,
        { checkable: true, estimate: 40, keys: KEYS },
        MARKUP
      )
    ).resolves.toBeUndefined();
    await settle();
  });
});
