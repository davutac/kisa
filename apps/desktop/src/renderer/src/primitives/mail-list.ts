import {
  announce,
  bindDrag,
  createAutoScroll,
  createChange,
  createCommit,
  createFocusRecovery,
  createRovingFocus,
  createSelection,
  createVirtualizer,
  definePrimitive,
  elements,
  isRTL,
  selects,
} from "@ui-sdk/core";
import type { ChangeDetails, CommitDetails, VirtualItem } from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

import {
  getSelectionAfterRemoval,
  getThreadSelectionScrollBehavior,
  getVisibleThreadSelectionIndex,
  THREAD_SELECTION_DRAG_THRESHOLD,
} from "@/mail/thread-selection";
import type { ThreadSelectionDirection } from "@/mail/thread-selection";

// Every reason is the shared vocabulary's; "drag" here paints rows.
export type MailListCurrentReason =
  | "drag"
  | "escape-key"
  | "focus-in"
  | "imperative"
  | "item-removed"
  | "list-navigation"
  | "shortcut";

export type MailListCheckedReason =
  | "drag"
  | "escape-key"
  | "imperative"
  | "item-press"
  | "item-removed"
  | "shortcut";

export interface MailListActivateDetails {
  readonly event?: MouseEvent;
  // "keyboard" covers Enter, Space and a screen reader's press.
  readonly source: "agent" | "keyboard" | "pointer";
}

export interface MailListController {
  clear: () => void;
  focusCurrent: () => void;
  move: (direction: ThreadSelectionDirection) => void;
  toggle: (key: string) => void;
}

export interface MailListOptions {
  checkable?: boolean;
  checked?: string[];
  controller?: MailListController;
  current?: string | null;
  defaultChecked?: string[];
  defaultCurrent?: string | null;
  estimate: number;
  // Every row's key in order, rendered or not.
  keys: readonly string[];
  labelOf?: (key: string) => string;
  onActivate?: (key: string, details: MailListActivateDetails) => void;
  onCheckedChange?: (
    checked: string[],
    details: ChangeDetails<MailListCheckedReason>
  ) => void;
  onCheckedCommit?: (
    checked: string[],
    details: CommitDetails<MailListCheckedReason>
  ) => void;
  onCurrentChange?: (
    current: string | null,
    details: ChangeDetails<MailListCurrentReason>
  ) => void;
  // -1 while more rows may load.
  rowCount?: number;
  // Read out after a drag or Escape changes the checked rows.
  selectedMessage?: (count: number) => string;
}

const OVERSCAN = 8;
const AUTO_SCROLL_EDGE = 64;
const AUTO_SCROLL_SPEED = 18;

// A drag keeps scrolling while the pointer overshoots the list by this much.
const AUTO_SCROLL_OVERSHOOT = 32;

interface Paint {
  readonly anchor: string;
  readonly checked: boolean;
  readonly initial: ReadonlySet<string>;
  last: string;
}

interface Anchor {
  readonly key: string;
  readonly offset: number;
  readonly start: number;
}

const defaultSelectedMessage = (count: number): string =>
  count === 0 ? "Selection cleared" : `${count} selected`;

const indexKeys = (keys: readonly string[]): ReadonlyMap<string, number> =>
  new Map(keys.map((key, index) => [key, index]));

const sameMembers = (a: readonly string[], b: ReadonlySet<string>): boolean =>
  a.length === b.size && a.every((key) => b.has(key));

// The rows between the anchor and the pointer take the painted state; every
// other row keeps what it had when the drag began, so moving back restores.
const paintedRows = (
  keys: readonly string[],
  index: ReadonlyMap<string, number>,
  paint: Paint,
  to: string
): string[] => {
  const from = index.get(paint.anchor) ?? -1;
  const end = index.get(to) ?? -1;

  if (from === -1 || end === -1) {
    return [...paint.initial];
  }

  const next = new Set(paint.initial);

  for (
    let position = Math.min(from, end);
    position <= Math.max(from, end);
    position += 1
  ) {
    const key = keys[position];

    if (key !== undefined) {
      if (paint.checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
  }

  return keys.filter((key) => next.has(key));
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// A grid of conversations, after the APG data grid: one row per
// conversation, read only, and multi-selectable when `checkable`.
export const mailList = definePrimitive({
  api: (context) => {
    const { store } = context;
    const change = createChange(context);
    const commit = createCommit(context);
    let scroller: HTMLElement | null = null;
    let anchor: Anchor | null = null;
    // The rows as last rendered: once the keys change, the virtualizer
    // already places rows by the new keys.
    let rendered: readonly VirtualItem[] = [];
    let lastMoveAt: number | null = null;
    let paint: Paint | null = null;
    let suppressActivate = false;
    let stopDrag: (() => void) | undefined;

    const keys = (): readonly string[] => store.get().keys;

    const indexOf = (key: string | null): number =>
      key === null ? -1 : (store.get().index.get(key) ?? -1);

    const checkable = (): boolean => store.get().checkable;

    const virtual = createVirtualizer({
      count: () => keys().length,
      estimate: () => context.options().estimate,
      keep: () => {
        const index = indexOf(store.get().current);

        return index === -1 ? [] : [index];
      },
      key: (index) => keys()[index] ?? `missing-${index}`,
      overscan: OVERSCAN,
    });

    const autoScroll = createAutoScroll({
      edge: AUTO_SCROLL_EDGE,
      onScroll: () => {
        const point = lastPoint;

        if (point !== null) {
          paintAt(point.x, point.y);
        }
      },
      speed: AUTO_SCROLL_SPEED,
    });

    let lastPoint: { x: number; y: number } | null = null;

    const roving = createRovingFocus(context, {
      claims: (state, item) =>
        state.current === null ||
        !state.index.has(state.current) ||
        item.key === state.current,
      key: "stop",
      preferred: (item) => item.key === store.get().current,
      remember: false,
      slot: "open",
    });

    const selection = createSelection(context, {
      key: "checked",
      multiple: () => true,
      order: keys,
      selectable: () => checkable(),
      set: (value, details) => change("checked", value, details),
    });

    const recovery = createFocusRecovery({
      fallback: () => {
        const { current } = store.get();

        return (
          (current === null ? undefined : context.element("open", current)) ??
          scroller ??
          undefined
        );
      },
    });

    // A controlled `current` arrives after the app renders, so a request
    // made a moment ago counts as current until then.
    let requested: { key: string | null } | null = null;

    const setCurrent = (
      key: string | null,
      reason: MailListCurrentReason,
      event?: Event
    ): void => {
      if ((requested?.key ?? store.get().current) === key) {
        return;
      }

      requested = { key };
      queueMicrotask(() => {
        requested = null;
      });
      change("current", key, { event, reason });
    };

    const focusRow = (key: string, behavior: ScrollBehavior): void => {
      const index = indexOf(key);

      if (index === -1) {
        return;
      }

      virtual.scrollToIndex(index, { align: "center", behavior });
      // The list scrolls itself, smoothly unless moves come quickly, so
      // focusing must not scroll as well.
      const el = context.element("open", key);

      if (el === undefined) {
        roving.focus(key);
      } else {
        el.focus({ preventScroll: true });
      }
    };

    const visibleIndex = (
      direction: ThreadSelectionDirection
    ): number | null => {
      const grid = context.element("grid");

      if (scroller === null || grid === undefined) {
        return null;
      }

      const viewportStart = scroller.scrollTop - grid.offsetTop;

      return getVisibleThreadSelectionIndex(
        virtual.items().map(({ index, size, start }) => ({
          end: start + size,
          index,
          start,
        })),
        viewportStart,
        viewportStart + scroller.clientHeight,
        direction
      );
    };

    const move = (
      direction: ThreadSelectionDirection,
      reason: MailListCurrentReason,
      event?: KeyboardEvent
    ): void => {
      const all = keys();

      if (all.length === 0) {
        return;
      }

      const from = indexOf(store.get().current);

      // With nothing focused the keys pick up from what is on screen rather
      // than a list edge the reader has scrolled away from.
      const to =
        from === -1
          ? (visibleIndex(direction) ?? (direction === 1 ? 0 : all.length - 1))
          : clamp(from + direction, 0, all.length - 1);

      const key = all[to];

      if (key === undefined) {
        return;
      }

      const now = performance.now();
      const behavior = getThreadSelectionScrollBehavior(lastMoveAt, now);
      lastMoveAt = now;
      setCurrent(key, reason, event);
      focusRow(key, behavior);
    };

    const rowKeyOf = (target: EventTarget | null): string | undefined =>
      target instanceof Element
        ? elements(context, "row").find(({ el }) => el.contains(target))?.key
        : undefined;

    const actionButtons = (key: string): HTMLElement[] => {
      const cell = context.element("actions", key);

      if (cell === undefined || cell.closest("[inert]") !== null) {
        return [];
      }

      return [...cell.querySelectorAll<HTMLElement>("button:not([disabled])")];
    };

    // Left and Right step between a row's open control and its actions, as
    // the APG grid moves between cells; they swap in right to left.
    const moveAcross = (event: KeyboardEvent, key: string): boolean => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const grid = context.element("grid");

      if (target === null || grid === undefined) {
        return false;
      }

      const forward = event.key === (isRTL(grid) ? "ArrowLeft" : "ArrowRight");

      const stops = [
        context.element("open", key),
        ...actionButtons(key),
      ].filter((el): el is HTMLElement => el !== undefined);

      const at = stops.indexOf(target);
      const next = stops[clamp(at + (forward ? 1 : -1), 0, stops.length - 1)];

      if (at === -1 || next === undefined) {
        return false;
      }

      next.focus({ preventScroll: true });

      return true;
    };

    const paintAt = (x: number, y: number): void => {
      if (paint === null || scroller === null) {
        return;
      }

      const bounds = scroller.getBoundingClientRect();

      const key = rowKeyAt(
        clamp(x, bounds.left + 1, bounds.right - 1),
        clamp(y, bounds.top + 1, bounds.bottom - 1)
      );

      if (key === undefined || key === paint.last) {
        return;
      }

      paint.last = key;
      change("checked", paintedRows(keys(), store.get().index, paint, key), {
        reason: "drag",
      });
      setCurrent(key, "drag");
    };

    const rowKeyAt = (x: number, y: number): string | undefined => {
      for (const el of document.elementsFromPoint(x, y)) {
        const key = rowKeyOf(el);

        if (key !== undefined) {
          return key;
        }
      }

      return undefined;
    };

    // The browser taking the pointer over ends the drag like a release.
    const endPaint = (): void => {
      autoScroll.stop();
      stopDrag = undefined;
      lastPoint = null;
      const finished = paint;
      paint = null;

      if (finished === null) {
        return;
      }

      commit("checked", store.get().checked, { reason: "drag" });

      if (!sameMembers(store.get().checked, finished.initial)) {
        announce(
          (context.options().selectedMessage ?? defaultSelectedMessage)(
            store.get().checked.length
          )
        );
      }

      const { current } = store.get();

      if (
        current !== null &&
        scroller?.contains(document.activeElement) === true
      ) {
        context.element("open", current)?.focus({ preventScroll: true });
      }
    };

    const startPaint = (key: string, event: PointerEvent): void => {
      const initial = new Set(store.get().checked);
      paint = {
        anchor: key,
        checked: !initial.has(key),
        initial,
        last: key,
      };
      suppressActivate = true;
      change("checked", paintedRows(keys(), store.get().index, paint, key), {
        event,
        reason: "drag",
      });
      setCurrent(key, "drag", event);
      lastPoint = { x: event.clientX, y: event.clientY };
    };

    const followPaint = ({ x, y }: { x: number; y: number }): void => {
      lastPoint = { x, y };
      const bounds = scroller?.getBoundingClientRect();

      // Scrolling goes on while the pointer overshoots the list a little,
      // as if it were still at the list's edge.
      if (
        bounds !== undefined &&
        y >= bounds.top - AUTO_SCROLL_OVERSHOOT &&
        y <= bounds.bottom + AUTO_SCROLL_OVERSHOOT
      ) {
        autoScroll.update(
          clamp(x, bounds.left + 1, bounds.right - 1),
          clamp(y, bounds.top + 1, bounds.bottom - 1)
        );
      } else {
        autoScroll.stop();
      }

      paintAt(x, y);
    };

    const stopPaint = (): void => {
      stopDrag?.();
      stopDrag = undefined;
      autoScroll.stop();
      paint = null;
      lastPoint = null;
    };

    // Keeps the first row in view where it was when rows come or go above it.
    // Measured rows are kept in place by the virtualizer itself.
    const captureAnchor = (): void => {
      if (scroller === null || scroller.scrollTop <= 0) {
        anchor = null;

        return;
      }

      const top = scroller.scrollTop;
      const first = rendered.find(({ size, start }) => start + size > top);
      anchor =
        first === undefined
          ? null
          : { key: first.key, offset: top - first.start, start: first.start };
    };

    let indexedKeys = store.get().keys;
    context.onDestroy(
      store.subscribe(() => {
        const state = store.get();

        if (state.keys === indexedKeys) {
          return;
        }

        const previous = indexedKeys;
        indexedKeys = state.keys;
        captureAnchor();
        const index = indexKeys(state.keys);
        store.set({ index });
        virtual.refresh();

        if (state.current !== null && !index.has(state.current)) {
          const replacement =
            getSelectionAfterRemoval(previous, state.keys, state.current) ??
            null;

          // A row on its way out keeps focus until it unmounts, so focus moves
          // with the current row now rather than after the row's exit.
          const leaving = context.element("row", state.current);
          change("current", replacement, { reason: "item-removed" });

          if (leaving?.contains(document.activeElement) === true) {
            const next =
              replacement === null
                ? undefined
                : context.element("open", replacement);

            (next ?? scroller)?.focus({ preventScroll: true });
          }
        }

        const kept = state.checked.filter((key) => index.has(key));

        if (kept.length !== state.checked.length) {
          change("checked", kept, { reason: "item-removed" });
        }
      })
    );

    context.onDestroy(() => {
      stopPaint();
    });

    const resolveRow = (row: string): string => {
      if (indexOf(row) !== -1) {
        return row;
      }

      const { labelOf } = context.options();
      const wanted = row.trim().toLowerCase();

      const matches =
        labelOf === undefined
          ? []
          : keys().filter(
              (key) => labelOf(key).trim().toLowerCase() === wanted
            );

      const [match] = matches;

      if (matches.length === 1 && match !== undefined) {
        return match;
      }

      throw new Error(
        matches.length === 0
          ? `No row "${row}". Name a row by its key or label.`
          : `"${row}" names ${matches.length} rows. Name a row by its key.`
      );
    };

    return {
      activate(key: string, event?: Event): void {
        const click = event instanceof MouseEvent ? event : undefined;

        // A click that ends a drag paints; it doesn't open the row.
        if (suppressActivate && click !== undefined && click.detail > 0) {
          suppressActivate = false;

          return;
        }

        suppressActivate = false;
        context.options().onActivate?.(key, {
          event: click,
          source:
            click !== undefined && click.detail > 0 ? "pointer" : "keyboard",
        });
      },
      // Runs once React has placed the rows, so rows that came or went above
      // the anchor have moved it by now.
      rendered(rows: readonly VirtualItem[]): void {
        rendered = rows;
        const kept = anchor;
        // A render can still show the rows placed by the keys before.
        const current = keys();

        if (
          kept === null ||
          scroller === null ||
          !rows.every(({ index, key }) => current[index] === key)
        ) {
          return;
        }

        anchor = null;
        const item = rows.find(({ key }) => key === kept.key);

        if (item !== undefined) {
          scroller.scrollTop += item.start - kept.start;

          return;
        }

        const index = indexOf(kept.key);

        if (index !== -1) {
          virtual.scrollToIndex(index, { align: "start" });
          scroller.scrollTop += kept.offset;
        }
      },
      clear(): void {
        const hadChecked = store.get().checked.length > 0;

        if (hadChecked) {
          change("checked", [], { reason: "escape-key" });
        }

        setCurrent(null, "escape-key");

        if (hadChecked && checkable()) {
          announce(
            (context.options().selectedMessage ?? defaultSelectedMessage)(0)
          );
        }

        if (scroller?.contains(document.activeElement) === true) {
          scroller.focus({ preventScroll: true });
        }
      },
      connect(el: HTMLElement): () => void {
        scroller = el;
        const disconnect = virtual.connect(el);

        return () => {
          disconnect();

          if (scroller === el) {
            scroller = null;
          }
        };
      },
      focusCurrent(): void {
        const { current } = store.get();

        if (current === null || indexOf(current) === -1) {
          scroller?.focus({ preventScroll: true });
        } else {
          focusRow(current, "auto");
        }
      },
      focusIn(key: string, event: FocusEvent): void {
        setCurrent(key, "focus-in", event);
      },
      keydown(event: KeyboardEvent): void {
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }

        const from = rowKeyOf(event.target) ?? store.get().current;

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          move(event.key === "ArrowDown" ? 1 : -1, "list-navigation", event);
        } else if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          from !== null &&
          moveAcross(event, from)
        ) {
          event.preventDefault();
        }
      },
      // Measures by key when the row resizes, since a row's index moves as
      // rows come and go above it, and a row that left measures nothing.
      measure(el: HTMLElement, key: string): () => void {
        const measure = (): void => {
          const index = indexOf(key);

          if (index !== -1) {
            virtual.measure(index, el)();
          }
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);

        return () => observer.disconnect();
      },
      move(direction: ThreadSelectionDirection): void {
        move(direction, "shortcut");
      },
      open(row: string): void {
        context.options().onActivate?.(resolveRow(row), { source: "agent" });
      },
      pointerdown(
        event: PointerEvent,
        key: string,
        el: HTMLElement,
        fromCheck: boolean
      ): void {
        if (event.button !== 0 || !checkable()) {
          return;
        }

        stopPaint();
        suppressActivate = false;

        if (fromCheck) {
          // A checkbox paints at once, without a row's tolerance, and leaves
          // focus where it was.
          event.preventDefault();
          event.stopPropagation();
          startPaint(key, event);
          stopDrag = bindDrag(el, event, {
            onEnd: endPaint,
            onMove: followPaint,
          });

          return;
        }

        // The press isn't captured until it passes the tolerance, so one
        // that lifts first stays a click on the row.
        stopDrag = bindDrag(el, event, {
          onEnd: endPaint,
          onMove: followPaint,
          onStart: (firstMove) => {
            firstMove.preventDefault();
            startPaint(key, firstMove);
          },
          threshold: THREAD_SELECTION_DRAG_THRESHOLD,
        });
      },
      recovery,
      roving,
      rowItems(): { label: string; value: string }[] {
        const labelOf = context.options().labelOf ?? ((key: string) => key);

        return keys().map((key) => ({ label: labelOf(key), value: key }));
      },
      toggle(row: string): void {
        if (!checkable()) {
          throw new Error("These rows can't be checked.");
        }

        selection.toggle(resolveRow(row), { reason: "shortcut" });
      },
      virtual,
    };
  },
  commits: ["checked"],
  controlled: ["current", "checked"],
  name: "mail-list",
  options: {
    checkable: "boolean",
    checked: "value",
    controller: "value",
    current: "value",
    defaultChecked: "value",
    defaultCurrent: "value",
    estimate: "number",
    keys: "value",
    labelOf: "value",
    onActivate: "callback",
    onCheckedChange: "callback",
    onCheckedCommit: "callback",
    onCurrentChange: "callback",
    rowCount: "number",
    selectedMessage: "value",
  },
  slots: (slot) => ({
    actions: slot<{ value?: string }>({
      focus: { none: "Its buttons take focus." },
      props: { value: { from: "row", kind: "string", required: true } },
      role: "gridcell",
      selects: selects({ checked: [], current: [], keys: [], stop: [] }),
    }),
    cell: slot<{ value?: string }>({
      focus: { none: "Its open control takes focus." },
      props: { value: { from: "row", kind: "string", required: true } },
      role: "gridcell",
      selects: selects({ checked: [], current: [], keys: [], stop: [] }),
    }),
    check: slot<{ value?: string }>({
      bind: (el, part) => {
        // Captured, so the checkbox's own press never sees what paints.
        const down = (event: PointerEvent): void => {
          part.api.pointerdown(event, part.key, el, true);
        };

        el.addEventListener("pointerdown", down, true);

        return () => el.removeEventListener("pointerdown", down, true);
      },
      props: { value: { from: "row", kind: "string", required: true } },
      selects: selects({ checked: [], current: [], keys: [], stop: [] }),
    }),
    grid: slot({
      attrs: (state) => ({
        "aria-multiselectable": state.checkable ? "true" : undefined,
        "aria-rowcount": String(state.rowCount),
      }),
      keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
      on: {
        keydown: (event, { api }) => {
          // SAFETY: the slot calls this for `keydown` only, which the browser
          // dispatches as a KeyboardEvent.
          api.keydown(event as KeyboardEvent);
        },
      },
      role: "grid",
      selects: selects({ checked: [], current: [], keys: [], stop: [] }),
    }),
    open: slot<{ value?: string }>({
      attrs: (state, part) => ({
        "aria-current": state.current === part.key ? "true" : undefined,
        tabindex: part.api.roving.tabIndex(state, part),
        type: "button",
      }),
      bind: (el, part) => part.api.roving.bind(el, part),
      focus: "roving",
      on: {
        focus: (event, { api, key }) => {
          // SAFETY: the slot calls this for `focus` only, which the browser
          // dispatches as a FocusEvent.
          api.focusIn(key, event as FocusEvent);
        },
        pointerdown: (event, { api, el, key }) => {
          if (el !== undefined) {
            // SAFETY: the slot calls this for `pointerdown` only, which the
            // browser dispatches as a PointerEvent.
            api.pointerdown(event as PointerEvent, key, el, false);
          }
        },
      },
      press: ({ api, key }, event) => {
        api.activate(key, event);
      },
      props: { value: { from: "row", kind: "string", required: true } },
      role: "button",
      selects: selects({
        checked: [],
        current: ({ key }) => [key],
        keys: [],
        stop: ({ key }) => [key, null],
      }),
    }),
    root: slot({
      bind: (el, { api }) => api.connect(el),
      selects: selects({ checked: [], current: [], keys: [], stop: [] }),
    }),
    row: slot<{ value: string }, { checked: boolean; current: boolean }>({
      attrs: (state, { key }) => {
        const index = state.index.get(key);

        return {
          "aria-rowindex": index === undefined ? undefined : String(index + 1),
          "aria-selected": state.checkable
            ? String(state.checked.includes(key))
            : undefined,
          "data-checked": state.checked.includes(key) ? "" : undefined,
          "data-current": state.current === key ? "" : undefined,
        };
      },
      bind: (el, part) => {
        const cleanups = [
          part.api.measure(el, part.key),
          part.api.recovery.bind(el, part),
        ];

        return () => {
          for (const cleanup of cleanups) {
            cleanup();
          }
        };
      },
      props: { value: "string" },
      role: "row",
      selects: selects({
        checked: ({ key }) => [key],
        current: ({ key }) => [key],
        stop: [],
      }),
      state: (state, { key }) => ({
        checked: state.checked.includes(key),
        current: state.current === key,
      }),
    }),
  }),
  // SAFETY: both assertions only widen an initial value to its state's type:
  // an empty array is a `string[]`, and `null` is a `string | null`.
  state: (options: MailListOptions) => ({
    checkable: options.checkable ?? false,
    checked: options.checked ?? options.defaultChecked ?? ([] as string[]),
    current: options.current ?? options.defaultCurrent ?? null,
    index: indexKeys(options.keys),
    keys: options.keys,
    rowCount: options.rowCount ?? options.keys.length,
    stop: null as string | null,
  }),
  sync: ({ checkable = false, checked, current, keys, rowCount }) => {
    const base = { checkable, keys, rowCount: rowCount ?? keys.length };

    if (checked === undefined) {
      return current === undefined ? base : { ...base, current };
    }

    return current === undefined
      ? { ...base, checked }
      : { ...base, checked, current };
  },
  // oxlint-disable-next-line sort-keys -- The agent key reads the api's types, so it follows `slots`.
  agent: {
    actions: ["open", "toggle"],
    items: (api) => api.rowItems(),
  },
});

export const {
  Actions: MailListActions,
  Cell: MailListCell,
  Check: MailListCheck,
  Grid: MailListGrid,
  Open: MailListOpen,
  Row: MailListRow,
} = createParts(mailList, {
  actions: "div",
  cell: "div",
  check: "span",
  grid: "div",
  open: "button",
  row: "div",
});
