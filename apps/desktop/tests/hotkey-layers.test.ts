import { describe, expect, it } from "@effect/vitest";

import {
  getTopHotkeyLayer,
  isHotkeyScopeActive,
  registerHotkeyLayer,
  removeHotkeyLayer,
} from "../src/renderer/src/hotkeys/layer-model";
import type { LayerRegistration } from "../src/renderer/src/hotkeys/layer-model";

const registration = (
  layer: LayerRegistration["layer"],
  activatedAt: number,
  id = `${layer}:${activatedAt}`
): LayerRegistration => ({ activatedAt, id, layer });

describe("hotkey interaction layers", () => {
  it("restores the mailbox after a thread closes", () => {
    const mailbox = registration("mailbox", 1);
    const thread = registration("thread", 2);
    const stack = [mailbox, thread];

    expect(getTopHotkeyLayer(stack)).toBe("thread");
    expect(getTopHotkeyLayer(removeHotkeyLayer(stack, thread.id))).toBe(
      "mailbox"
    );
  });

  it("gives composer and search precedence over underlying layers", () => {
    const mailbox = registration("mailbox", 1);
    const thread = registration("thread", 2);
    const composer = registration("composer", 3);
    const search = registration("search", 4);
    const stack = [mailbox, thread, composer, search];

    expect(getTopHotkeyLayer(stack)).toBe("search");
    expect(getTopHotkeyLayer(removeHotkeyLayer(stack, search.id))).toBe(
      "composer"
    );
  });

  it("uses activation order for equal-priority layers", () => {
    expect(
      getTopHotkeyLayer([
        registration("composer", 1),
        registration("search", 2),
      ])
    ).toBe("search");
  });

  it("keeps a unique token through StrictMode-style cycles", () => {
    const id = "composer";
    const first = registerHotkeyLayer([], registration("composer", 1, id));
    const removed = removeHotkeyLayer(first, id);
    const second = registerHotkeyLayer(
      removed,
      registration("composer", 2, id)
    );
    const replaced = registerHotkeyLayer(
      second,
      registration("composer", 3, id)
    );

    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.activatedAt).toBe(3);
  });

  it("does not change the top layer when removing a lower token", () => {
    const mailbox = registration("mailbox", 1);
    const composer = registration("composer", 2);

    expect(
      getTopHotkeyLayer(removeHotkeyLayer([mailbox, composer], mailbox.id))
    ).toBe("composer");
  });

  it("activates only scopes allowed by the top layer", () => {
    expect(isHotkeyScopeActive("always", "composer")).toBeTruthy();
    expect(isHotkeyScopeActive("composer", "composer")).toBeTruthy();
    expect(isHotkeyScopeActive("app", "composer")).toBeFalsy();
    expect(isHotkeyScopeActive("mailbox", "thread")).toBeFalsy();
    expect(isHotkeyScopeActive("app", "thread")).toBeTruthy();
  });

  it("isolates template commands while keeping app navigation active", () => {
    expect(isHotkeyScopeActive("templates", "templates")).toBeTruthy();
    expect(isHotkeyScopeActive("app", "templates")).toBeTruthy();
    expect(isHotkeyScopeActive("settings", "templates")).toBeFalsy();
  });

  it("blocks product hotkeys while a modal operation is active", () => {
    expect(
      getTopHotkeyLayer([
        registration("settings", 1),
        registration("blocking", 2),
      ])
    ).toBe("blocking");
    expect(isHotkeyScopeActive("app", "blocking")).toBeFalsy();
    expect(isHotkeyScopeActive("settings", "blocking")).toBeFalsy();
    expect(isHotkeyScopeActive("always", "blocking")).toBeTruthy();
  });

  it("keeps the app scope active without a layer", () => {
    expect(isHotkeyScopeActive("app", null)).toBeTruthy();
  });
});
