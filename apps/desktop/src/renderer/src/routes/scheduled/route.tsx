import { createFileRoute } from "@tanstack/react-router";
import { CalendarClockIcon, LoaderCircleIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { NewMessagePage } from "@/components/mail/new-message";
import { PageTitlebar } from "@/components/shell/page-titlebar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useHotkeyLayer } from "@/hotkeys";
import { MailListRoot } from "@/primitives/mail-list-root";

import ScheduledMailRow from "./-components/scheduled-mail-row";
import { useScheduledMailWorkspace } from "./-components/use-scheduled-mail-workspace";

// After the rows: a failed load with Try again, or the next page loading.
function ScheduledListFooter({
  error,
  hasMore,
  isInitialLoading,
  onRetry,
}: {
  readonly error: string | undefined;
  readonly hasMore: boolean;
  readonly isInitialLoading: boolean;
  readonly onRetry: () => void;
}) {
  if (error !== undefined) {
    return (
      <div className="bg-popover text-popover-foreground absolute right-4 bottom-4 left-4 z-20 flex items-center justify-center gap-2 rounded-md px-3 py-2 shadow-sm">
        <output className="text-destructive block text-xs">{error}</output>
        <Button
          disabled={isInitialLoading}
          onClick={onRetry}
          size="xs"
          type="button"
          variant="secondary"
        >
          Try again
        </Button>
      </div>
    );
  }
  return hasMore ? (
    <p
      aria-live="polite"
      className="text-muted-foreground py-4 text-center text-sm"
    >
      Loading more…
    </p>
  ) : null;
}

export const Route = createFileRoute("/scheduled")({
  component: ScheduledRoute,
});

/**
 * Scheduled is a page like Settings, Templates, and a new email: its title
 * sits in the content titlebar and its sidebar row alone reads as current.
 * The account scope still filters it, so the title names the account when
 * one is chosen. A scheduled email opens as a composer page over the list,
 * as a conversation opens over the mailbox, so closing it returns to the
 * list where it was.
 */
function ScheduledRoute() {
  const {
    accounts,
    activate,
    cancelSchedule: handleCancelSchedule,
    closeEditor,
    discardScheduledEmail: handleDiscardScheduledEmail,
    editSession,
    error,
    isInitialLoading,
    itemKeys,
    items,
    itemsByKey,
    labelOf,
    list,
    openEditor: handleOpenEditor,
    quickActionResetRevision,
    reload,
    replaceEditSession,
    rowCount,
    selectedAccountId,
    selectedKey,
    setLastRenderedIndex,
    setSelectedKey,
  } = useScheduledMailWorkspace();
  const isEditing = editSession !== null;

  useHotkeyLayer("composer", isEditing);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <section
        aria-labelledby="scheduled-title"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        inert={isEditing}
      >
        {isEditing ? null : (
          <PageTitlebar
            title={
              selectedAccountId === null ? (
                "Scheduled"
              ) : (
                <>
                  Scheduled
                  <span className="text-muted-foreground font-normal">
                    {" · "}
                    {selectedAccountId}
                  </span>
                </>
              )
            }
            titleId="scheduled-title"
          />
        )}
        <MailListRoot
          after={
            <ScheduledListFooter
              error={error}
              hasMore={rowCount === -1}
              isInitialLoading={isInitialLoading}
              onRetry={() => {
                void reload();
              }}
            />
          }
          aria-label="Scheduled emails"
          before={
            items.length === 0 ? (
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
            ) : null
          }
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 outline-none"
          controller={list}
          current={selectedKey}
          estimate={105}
          gridLabel="Emails waiting to send"
          keys={itemKeys}
          labelOf={labelOf}
          onActivate={activate}
          onCurrentChange={setSelectedKey}
          onRowsRendered={(rows) => {
            setLastRenderedIndex(rows.at(-1)?.index);
          }}
          rowCount={rowCount}
          tabIndex={-1}
        >
          {(rows) => (
            <AnimatePresence initial={false}>
              {rows.map((row) => {
                const item = itemsByKey.get(row.key);
                return item === undefined ? null : (
                  <ScheduledMailRow
                    item={item}
                    key={row.key}
                    onCancel={handleCancelSchedule}
                    onDiscard={handleDiscardScheduledEmail}
                    onOpen={handleOpenEditor}
                    quickActionResetRevision={quickActionResetRevision}
                    selected={selectedKey === row.key}
                    top={row.start}
                  />
                );
              })}
            </AnimatePresence>
          )}
        </MailListRoot>
      </section>
      {editSession === null ? null : (
        <div className="absolute inset-0 z-10 flex flex-col">
          <NewMessagePage
            accounts={accounts}
            initialAccountId={editSession.item.accountId}
            key={`${editSession.item.accountId}\0${editSession.item.draftId}`}
            onClose={closeEditor}
            onScheduledEditChange={replaceEditSession}
            scheduledEdit={editSession}
          />
        </div>
      )}
    </div>
  );
}
