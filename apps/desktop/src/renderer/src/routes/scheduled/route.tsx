import { createFileRoute } from "@tanstack/react-router";
import { CalendarClockIcon, LoaderCircleIcon } from "lucide-react";

import NewMessageDialog from "@/components/mail/new-message";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getScheduledMailKey } from "@/scheduled/scheduled-mail-view";

import ScheduledMailRow from "./-components/scheduled-mail-row";
import { useScheduledMailWorkspace } from "./-components/use-scheduled-mail-workspace";

export const Route = createFileRoute("/scheduled")({
  component: ScheduledRoute,
});

function ScheduledRoute() {
  const {
    accounts,
    cancelSchedule: handleCancelSchedule,
    closeEditor,
    discardScheduledEmail: handleDiscardScheduledEmail,
    editSession,
    error,
    headingRef,
    isInitialLoading,
    items,
    listRef,
    measureElement,
    openEditor: handleOpenEditor,
    quickActionResetRevision,
    reload,
    replaceEditSession,
    scrollRef,
    selectedKey,
    setRowRef,
    setSize,
    totalSize,
    virtualItems,
  } = useScheduledMailWorkspace();
  return (
    <section
      aria-labelledby="scheduled-title"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <h1
        className="sr-only outline-none"
        id="scheduled-title"
        ref={headingRef}
        tabIndex={-1}
      >
        Scheduled emails
      </h1>
      <section
        aria-label="Scheduled emails"
        className="scroll-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4"
        ref={scrollRef}
        tabIndex={-1}
      >
        {items.length === 0 ? (
          <Empty
            aria-live="polite"
            className="absolute inset-4 w-auto border-0"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {isInitialLoading ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <CalendarClockIcon />
                )}
              </EmptyMedia>
              <EmptyTitle>
                {isInitialLoading
                  ? "Loading scheduled emails…"
                  : "No scheduled emails"}
              </EmptyTitle>
              {isInitialLoading ? null : (
                <EmptyDescription>
                  Choose Schedule send from a new email.
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : null}
        <ol
          className="relative"
          ref={listRef}
          style={{ height: `${totalSize}px` }}
        >
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index];
            if (item === undefined) {
              return (
                <li
                  className="absolute top-0 left-0 w-full py-4"
                  data-index={virtualItem.index}
                  key="scheduled-mail-next-page"
                  ref={measureElement}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <p
                    aria-live="polite"
                    className="text-muted-foreground text-center text-sm"
                  >
                    Loading more…
                  </p>
                </li>
              );
            }
            const key = getScheduledMailKey(item);
            return (
              <ScheduledMailRow
                item={item}
                key={key}
                measureElement={measureElement}
                onCancel={handleCancelSchedule}
                onDiscard={handleDiscardScheduledEmail}
                onOpen={handleOpenEditor}
                position={virtualItem.index + 1}
                quickActionResetRevision={quickActionResetRevision}
                ref={(element) => setRowRef(key, element)}
                selected={selectedKey === key}
                setSize={setSize}
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                virtualIndex={virtualItem.index}
              />
            );
          })}
        </ol>
        {error === undefined ? null : (
          <div className="bg-popover text-popover-foreground absolute right-4 bottom-4 left-4 z-20 flex items-center justify-center gap-2 rounded-md px-3 py-2 shadow-sm">
            <output className="text-destructive block text-xs">{error}</output>
            <Button
              disabled={isInitialLoading}
              onClick={() => {
                void reload();
              }}
              size="xs"
              type="button"
              variant="secondary"
            >
              Try again
            </Button>
          </div>
        )}
      </section>
      {editSession === null ? null : (
        <NewMessageDialog
          accounts={accounts}
          initialAccountId={editSession.item.accountId}
          isOpen
          key={`${editSession.item.accountId}\0${editSession.item.draftId}`}
          onOpenChange={(open) => {
            if (!open) {
              closeEditor();
            }
          }}
          onScheduledEditChange={replaceEditSession}
          scheduledEdit={editSession}
        />
      )}
    </section>
  );
}
