import type { VirtualItem } from "@ui-sdk/core";
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import type { PartProps } from "@ui-sdk/react/primitive";
import { useEffectEvent, useLayoutEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MailListGrid, mailList } from "@/primitives/mail-list";
import type { MailListOptions } from "@/primitives/mail-list";

type MailListRootProps = MailListOptions &
  Omit<PartProps<"section">, "children"> & {
    // `before` takes the place of rows (an empty state); `after` follows them.
    readonly after?: ReactNode;
    readonly before?: ReactNode;
    readonly children: (rows: readonly VirtualItem[]) => ReactNode;
    readonly gridClassName?: string;
    readonly gridLabel: string;
    readonly onRowsRendered?: (rows: readonly VirtualItem[]) => void;
    /** Sticks to the top of the scroller, above the rows; it takes no room. */
    readonly pinned?: (rows: readonly VirtualItem[]) => ReactNode;
  };

// The scroller is the root, so the virtualizer reads it; the grid inside it
// is as tall as every row together, and only the rows in view render. The
// root is also the scroll area's viewport, so its scrollbar floats over the
// rows rather than narrowing them.
export const MailListRoot = ({
  after,
  before,
  checkable,
  checked,
  children,
  controller,
  current,
  defaultChecked,
  defaultCurrent,
  estimate,
  gridClassName,
  gridLabel,
  keys,
  labelOf,
  onActivate,
  onCheckedChange,
  onCheckedCommit,
  onCurrentChange,
  onRowsRendered,
  pinned,
  rowCount,
  selectedMessage,
  ...props
}: MailListRootProps) => {
  const list = usePrimitive(mailList, {
    checkable,
    checked,
    controller,
    current,
    defaultChecked,
    defaultCurrent,
    estimate,
    keys,
    labelOf,
    onActivate,
    onCheckedChange,
    onCheckedCommit,
    onCurrentChange,
    rowCount,
    selectedMessage,
  });

  const { virtual } = list.api;

  const rows = useSyncExternalStore(
    virtual.subscribe,
    virtual.items,
    virtual.items
  );

  const size = useSyncExternalStore(
    virtual.subscribe,
    virtual.size,
    virtual.size
  );

  const reportRows = useEffectEvent((shown: readonly VirtualItem[]) => {
    onRowsRendered?.(shown);
  });

  useLayoutEffect(() => {
    list.api.rendered(rows);
    reportRows(rows);
  }, [list, rows]);

  const scroller = usePart(
    list,
    "root",
    {},
    {
      ...props,
      children: (
        <ScrollAreaContent>
          {before}
          {pinned?.(rows)}
          <MailListGrid
            aria-label={gridLabel}
            className={cn("relative", gridClassName)}
            style={{ height: size }}
          >
            {children(rows)}
          </MailListGrid>
          {after}
        </ScrollAreaContent>
      ),
      render: <ScrollAreaViewport render={<section />} />,
    },
    "section"
  );

  return (
    <ScrollArea className="flex min-h-0 flex-1 flex-col">
      {scroller}
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  );
};
