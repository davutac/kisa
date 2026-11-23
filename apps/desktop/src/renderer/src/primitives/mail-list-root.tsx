import type { VirtualItem } from "@ui-sdk/core";
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import type { PartProps } from "@ui-sdk/react/primitive";
import { useEffectEvent, useLayoutEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

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
  };

// The scroller is the root, so the virtualizer reads it; the grid inside it
// is as tall as every row together, and only the rows in view render.
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

  return usePart(
    list,
    "root",
    {},
    {
      ...props,
      children: (
        <>
          {before}
          <MailListGrid
            aria-label={gridLabel}
            className={cn("relative", gridClassName)}
            style={{ height: size }}
          >
            {children(rows)}
          </MailListGrid>
          {after}
        </>
      ),
    },
    "section"
  );
};
