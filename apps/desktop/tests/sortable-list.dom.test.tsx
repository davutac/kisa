import { checkServer, mount } from "@ui-sdk/core/testing";
import { describe, expect, it } from "vitest";

import { sortableList } from "../src/renderer/src/primitives/sortable-list";

const MARKUP = `<root aria-label="Accounts">
  <item value="a" label="Ada"><handle aria-label="Reorder Ada">A</handle><button type="button">Open Ada</button></item>
  <item value="b" label="Ben"><handle aria-label="Reorder Ben">B</handle><button type="button">Open Ben</button></item>
  <item value="c" label="Cy"><handle aria-label="Reorder Cy">C</handle><button type="button">Open Cy</button></item>
</root>`;

const mountList = () =>
  mount(sortableList, { defaultValue: ["a", "b", "c"] }, MARKUP);

const handleOf = (view: ReturnType<typeof mountList>, key: string) => {
  const handle = view.part("handle", key);
  if (handle === undefined) {
    throw new Error(`No handle for ${key}`);
  }
  return handle;
};

describe("sortable list", () => {
  it("picks an item up with Space, moves it with the arrows and drops it", async () => {
    const view = mountList();
    try {
      handleOf(view, "a").focus();
      await view.keys("Space");
      expect(handleOf(view, "a").getAttribute("aria-pressed")).toBe("true");
      await view.keys("ArrowDown", "ArrowDown");
      expect(view.state.value).toStrictEqual(["a", "b", "c"]);
      await view.keys("Space");
      expect(view.state.value).toStrictEqual(["b", "c", "a"]);
      expect(handleOf(view, "a").getAttribute("aria-pressed")).toBe("false");
      expect(view.changes.at(-1)).toMatchObject({
        reason: "move-key",
        source: "keyboard",
      });
    } finally {
      view.unmount();
    }
  });

  it("keeps focus on the handle as its item moves", async () => {
    const view = mountList();
    try {
      handleOf(view, "a").focus();
      await view.keys("Space", "ArrowDown", "Space");
      expect(document.activeElement).toBe(handleOf(view, "a"));
    } finally {
      view.unmount();
    }
  });

  it("moves with Enter, Home and End too", async () => {
    const view = mountList();
    try {
      handleOf(view, "c").focus();
      await view.keys("Enter", "Home", "Enter");
      expect(view.state.value).toStrictEqual(["c", "a", "b"]);
      await view.keys("Enter", "End", "Enter");
      expect(view.state.value).toStrictEqual(["a", "b", "c"]);
    } finally {
      view.unmount();
    }
  });

  it("puts the item back on Escape without changing the order", async () => {
    const view = mountList();
    try {
      handleOf(view, "b").focus();
      await view.keys("Space", "ArrowUp", "Escape");
      expect(view.state.value).toStrictEqual(["a", "b", "c"]);
      expect(view.changes).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it("tells screen readers each step by the item's label", async () => {
    const view = mountList();
    try {
      handleOf(view, "a").focus();
      await view.keys("Space", "ArrowDown", "Space");
      await view.settle();
      const heard = view.announced.join(" ");
      expect(heard).toContain("Ada");
      expect(heard).not.toContain("Reorder");
    } finally {
      view.unmount();
    }
  });

  it("leaves the item's own button alone", async () => {
    const view = mountList();
    try {
      const [, open] = view.root.querySelectorAll("button[type=button]");
      if (!(open instanceof HTMLElement)) {
        throw new TypeError("No item button");
      }
      open.focus();
      await view.keys("Space", "ArrowDown", "Space");
      expect(view.state.value).toStrictEqual(["a", "b", "c"]);
      expect(view.changes).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it("drags an item by its handle", async () => {
    const view = mountList();
    // jsdom lays nothing out: stack the rows 32 pixels apart.
    for (const [index, key] of ["a", "b", "c"].entries()) {
      for (const el of [view.part("item", key), handleOf(view, key)]) {
        if (el !== undefined) {
          el.getBoundingClientRect = () =>
            DOMRect.fromRect({ height: 32, width: 200, x: 0, y: index * 32 });
        }
      }
    }
    try {
      await view.drag(handleOf(view, "a"), { by: { x: 0, y: 72 } });
      expect(view.state.value).toStrictEqual(["b", "c", "a"]);
      expect(view.changes.at(-1)).toMatchObject({ reason: "drag" });
    } finally {
      view.unmount();
    }
  });

  it("moves an item from code, as an agent does", () => {
    const view = mountList();
    try {
      expect(view.api.move("c", 0)).toBeTruthy();
      expect(view.state.value).toStrictEqual(["c", "a", "b"]);
    } finally {
      view.unmount();
    }
  });

  it("renders on the server", () => {
    expect(
      checkServer(sortableList, { defaultValue: ["a", "b", "c"] }, MARKUP)
    ).toContain('aria-pressed="false"');
  });
});
