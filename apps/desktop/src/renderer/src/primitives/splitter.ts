import {
  bindDrag,
  createChange,
  createCommit,
  definePrimitive,
  isRTL,
} from "@ui-sdk/core";
import type { ChangeDetails, CommitDetails } from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

type SplitterReason = "drag" | "imperative" | "step-key";

export interface SplitterOptions {
  defaultValue?: number;
  max: number;
  min: number;
  onValueChange?: (
    value: number,
    details: ChangeDetails<SplitterReason>
  ) => void;
  onValueCommit?: (
    value: number,
    details: CommitDetails<SplitterReason>
  ) => void;
  step?: number;
  value?: number;
}

// The APG window splitter, for a pane sized in pixels rather than Resizable's
// share of a group; `onValueCommit` runs once a key or a drag ends.
export const splitter = definePrimitive({
  api: (context) => {
    const change = createChange(context);
    const commit = createCommit(context);
    let stopDrag: (() => void) | undefined;
    context.onDestroy(() => stopDrag?.());

    const clamp = (value: number): number => {
      const { max, min } = context.store.get();

      return Math.round(Math.min(Math.max(min, max), Math.max(min, value)));
    };

    const settle = (
      value: number,
      reason: "imperative" | "step-key",
      event?: KeyboardEvent
    ): boolean => {
      const next = clamp(value);

      const changed =
        event === undefined
          ? change("value", next, { reason: "imperative" })
          : change("value", next, { event, reason });

      if (changed) {
        commit(
          "value",
          next,
          event === undefined ? { reason: "imperative" } : { event, reason }
        );
      }

      return changed;
    };

    return {
      keydown(event: KeyboardEvent, el: HTMLElement): void {
        const { max, min, value } = context.store.get();
        const step = context.options().step ?? 1;
        const forward = isRTL(el) ? -step : step;

        const target = new Map([
          ["ArrowLeft", value - forward],
          ["ArrowRight", value + forward],
          ["End", max],
          ["Home", min],
        ]).get(event.key);

        if (target === undefined) {
          return;
        }

        // Home and End would otherwise scroll the page.
        event.preventDefault();
        settle(target, "step-key", event);
      },
      pointerdown(event: PointerEvent, el: HTMLElement): void {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        stopDrag?.();
        const start = context.store.get().value;
        const direction = isRTL(el) ? -1 : 1;
        let last = start;
        context.store.set({ dragging: true });
        stopDrag = bindDrag(el, event, {
          cancelOnEscape: true,
          onEnd: (end, canceled) => {
            stopDrag = undefined;
            context.store.set({ dragging: false });

            if (canceled) {
              change("value", start, { event: end, reason: "drag" });
            } else if (last !== start) {
              commit("value", last, { event: end, reason: "drag" });
            }
          },
          onMove: ({ event: move, x }) => {
            const next = clamp(start + (x - event.clientX) * direction);

            if (change("value", next, { event: move, reason: "drag" })) {
              last = next;
            }
          },
        });
      },
      setValue: (value: number): boolean => settle(value, "imperative"),
    };
  },
  commits: ["value"],
  name: "splitter",
  options: {
    defaultValue: "number",
    max: "number",
    min: "number",
    onValueChange: "callback",
    onValueCommit: "callback",
    step: "number",
    value: "number",
  },
  slots: (slot) => ({
    root: slot<object, { dragging: boolean; value: number }>({
      attrs: (state) => ({
        "aria-orientation": "vertical",
        "aria-valuemax": String(state.max),
        "aria-valuemin": String(state.min),
        "aria-valuenow": String(state.value),
        "data-dragging": state.dragging ? "" : undefined,
        tabindex: "0",
      }),
      keys: ["ArrowLeft", "ArrowRight", "Home", "End"],
      on: {
        keydown: (event, { api, el }) => {
          if (el !== undefined) {
            api.keydown(event, el);
          }
        },
        pointerdown: (event, { api, el }) => {
          if (el !== undefined) {
            api.pointerdown(event, el);
          }
        },
      },
      role: "separator",
      state: (state) => ({ dragging: state.dragging, value: state.value }),
    }),
  }),
  state: (options: SplitterOptions) => ({
    dragging: false,
    max: options.max,
    min: options.min,
    value: options.value ?? options.defaultValue ?? options.min,
  }),
  sync: ({ max, min, value }) =>
    value === undefined ? { max, min } : { max, min, value },
  // oxlint-disable-next-line sort-keys -- The agent key reads the api's types, so it follows `slots`.
  agent: { actions: ["setValue"] },
});

export const { Root: Splitter } = createParts(splitter, { root: "div" });
