import { createChange, createReorder, definePrimitive } from "@ui-sdk/core";
import type { ChangeDetails, ReorderDraft, ReorderReason } from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

export interface SortableListOptions {
  defaultValue?: string[];
  onValueChange?: (
    value: string[],
    details: ChangeDetails<ReorderReason>
  ) => void;
  value?: string[];
}

const sameMembers = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key) => b.includes(key));

// The handle is a button beside each item's own controls, as the reorder docs
// advise, so Space and Enter on those controls keep their meaning.
export const sortableList = definePrimitive({
  api: (context) => {
    const change = createChange(context);

    const reorder = createReorder(context, {
      draft: "moving",
      key: "value",
      label: (key) => context.props<{ label?: string }>("item", key)?.label,
      set: (value, details) => change("value", value, details),
      slot: "item",
    });

    // A move can't outlive an item that left the list or one that joined it.
    context.onOptions(({ value }) => {
      const draft = context.store.get().moving;

      if (
        draft !== null &&
        value !== undefined &&
        !sameMembers(draft.order, value)
      ) {
        reorder.cancel();
      }
    });

    return {
      move: (key: string, index: number): boolean => reorder.move(key, index),
      reorder,
    };
  },
  controlled: ["value"],
  name: "sortable-list",
  options: {
    defaultValue: "list",
    onValueChange: "callback",
    value: "list",
  },
  slots: (slot) => ({
    handle: slot<{ value?: string }, { moving: boolean }>({
      attrs: (state, { api, key }) => ({
        "aria-pressed": String(api.reorder.moving(state, key)),
        type: "button",
      }),
      on: {
        keydown: (event, { api, key }) => {
          api.reorder.keydown(event, key);
        },
        pointerdown: (event, { api, key }) =>
          api.reorder.pointerdown(event, key),
      },
      props: { value: { from: "item", kind: "string", required: true } },
      state: (state, { api, key }) => ({
        moving: api.reorder.moving(state, key),
      }),
    }),
    item: slot<
      { label?: string; value: string },
      { dragging: boolean; moving: boolean }
    >({
      attrs: (state, { api, key }) => ({
        "data-dragging": api.reorder.dragging(state, key) ? "" : undefined,
        "data-moving": api.reorder.moving(state, key) ? "" : undefined,
      }),
      bind: (el, part) => part.api.reorder.bind(el, part),
      props: { label: "string", value: "string" },
      state: (state, { api, key }) => ({
        dragging: api.reorder.dragging(state, key),
        moving: api.reorder.moving(state, key),
      }),
    }),
    root: slot<object, { order: string[] }>({
      state: (state, { api }) => ({ order: api.reorder.order(state) }),
    }),
  }),
  // SAFETY: widens the initial `null` to the state's type, which includes it.
  state: (options: SortableListOptions) => ({
    moving: null as ReorderDraft | null,
    value: options.value ?? options.defaultValue ?? [],
  }),
  sync: (options) =>
    options.value === undefined ? {} : { value: options.value },
  // oxlint-disable-next-line sort-keys -- The agent key reads the api's types, so it follows `slots`.
  agent: { actions: ["move"] },
});

export const {
  Handle: SortableListHandle,
  Item: SortableListItem,
  Root: SortableList,
} = createParts(sortableList, { handle: "button", item: "li", root: "ul" });
