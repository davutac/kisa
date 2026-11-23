import { checkDirection, checkServer, mount } from "@ui-sdk/core/testing";
import { describe, expect, it } from "vitest";

import { splitter } from "../src/renderer/src/primitives/splitter";

const SIDEBAR = { max: 360, min: 214, step: 16 } as const;
const MARKUP = `<root aria-label="Resize sidebar"></root>`;

const mountSplitter = (value: number) =>
  mount(splitter, { ...SIDEBAR, defaultValue: value }, MARKUP);

describe("sidebar splitter", () => {
  it("is a named, focusable vertical separator reporting its width", () => {
    const view = mountSplitter(240);
    try {
      const names = [
        "role",
        "tabindex",
        "aria-orientation",
        "aria-valuenow",
        "aria-valuemin",
        "aria-valuemax",
        "data-dragging",
      ];
      expect(
        Object.fromEntries(
          names.map((name) => [name, view.root.getAttribute(name)])
        )
      ).toStrictEqual({
        "aria-orientation": "vertical",
        "aria-valuemax": "360",
        "aria-valuemin": "214",
        "aria-valuenow": "240",
        "data-dragging": null,
        role: "separator",
        tabindex: "0",
      });
    } finally {
      view.unmount();
    }
  });

  it("steps the width with the arrow keys and commits each step", async () => {
    const view = mountSplitter(240);
    try {
      await view.keys("Tab", "ArrowRight");
      expect(view.state.value).toBe(256);
      await view.keys("ArrowLeft", "ArrowLeft");
      expect(view.state.value).toBe(224);
      expect(view.root.getAttribute("aria-valuenow")).toBe("224");
      expect(view.settled.map(({ value }) => value)).toStrictEqual([
        256, 240, 224,
      ]);
      expect(view.changes.at(-1)).toMatchObject({
        reason: "step-key",
        source: "keyboard",
      });
    } finally {
      view.unmount();
    }
  });

  it("stops at the minimum and the maximum", async () => {
    const view = mountSplitter(220);
    try {
      await view.keys("Tab", "ArrowLeft");
      expect(view.state.value).toBe(SIDEBAR.min);
      await view.keys("ArrowLeft");
      expect(view.state.value).toBe(SIDEBAR.min);
    } finally {
      view.unmount();
    }
    const wide = mountSplitter(SIDEBAR.max - 4);
    try {
      await wide.keys("Tab", "ArrowRight");
      expect(wide.state.value).toBe(SIDEBAR.max);
    } finally {
      wide.unmount();
    }
  });

  it("jumps to either end with Home and End", async () => {
    const view = mountSplitter(300);
    try {
      await view.keys("Tab", "Home");
      expect(view.state.value).toBe(SIDEBAR.min);
      await view.keys("End");
      expect(view.state.value).toBe(SIDEBAR.max);
    } finally {
      view.unmount();
    }
  });

  it("leaves every other key to the rest of the window", async () => {
    const view = mountSplitter(240);
    try {
      await view.keys("Tab", "ArrowDown", "ArrowUp", "Enter", "j");
      expect(view.state.value).toBe(240);
      expect(view.changes).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it("follows a drag and commits once, when it ends", async () => {
    const view = mountSplitter(240);
    try {
      await view.drag(view.root, { by: { x: 40, y: 0 } });
      expect(view.state.value).toBe(280);
      expect(view.state.dragging).toBeFalsy();
      expect(view.settled.map(({ value }) => value)).toStrictEqual([280]);
      expect(view.changes.at(-1)).toMatchObject({ reason: "drag" });
    } finally {
      view.unmount();
    }
  });

  it("keeps a drag inside the limits", async () => {
    const view = mountSplitter(240);
    try {
      await view.drag(view.root, { by: { x: 400, y: 0 } });
      expect(view.state.value).toBe(SIDEBAR.max);
      await view.drag(view.root, { by: { x: -400, y: 0 } });
      expect(view.state.value).toBe(SIDEBAR.min);
    } finally {
      view.unmount();
    }
  });

  it("lets an agent set the width within the limits", () => {
    const view = mountSplitter(240);
    try {
      view.api.setValue(300);
      expect(view.state.value).toBe(300);
      view.api.setValue(1000);
      expect(view.state.value).toBe(SIDEBAR.max);
      expect(view.settled.map(({ value }) => value)).toStrictEqual([300, 360]);
    } finally {
      view.unmount();
    }
  });

  it("renders on the server and mirrors the arrows right to left", async () => {
    expect(
      checkServer(splitter, { ...SIDEBAR, defaultValue: 240 }, MARKUP)
    ).toContain('aria-valuenow="240"');
    await checkDirection(splitter, { ...SIDEBAR, defaultValue: 240 }, MARKUP);
  });
});
