import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";

import { TitlebarSlot } from "@/components/shell/titlebar-slot";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { getMailboxPlaceCrumbs } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import { useScopeLabelItems } from "@/mail/use-label-places";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";

// Crumbs read as text in the list's color: the link variant without its
// color, underline, size, padding, or press nudge, and free to shrink.
const crumbButtonClassName =
  "app-titlebar-interactive hover:text-foreground focus-visible:ring-ring/50 block h-auto max-w-48 shrink truncate rounded-sm border-0 p-0 font-normal text-current text-[length:inherit] leading-[inherit] transition-colors hover:no-underline active:not-aria-[haspopup]:translate-y-0";

interface OpenThreadCrumb {
  /** The mailbox crumb's name for leaving the conversation. */
  readonly backLabel: string;
  readonly onBack: () => void;
  /** Absent while the conversation loads. */
  readonly subject?: string;
}

interface MailboxBreadcrumbProps {
  /** An open conversation's actions, on the titlebar's trailing side. */
  readonly actions?: ReactNode;
  readonly mailbox: MailboxPlace;
  /** The conversation open over the mailbox, named after it. */
  readonly thread?: OpenThreadCrumb;
}

/**
 * Where the mailbox view is, in the content titlebar: the account scope, then
 * the mailbox, or a label and the labels above it. The scope opens its Inbox
 * like its sidebar row, and a parent label opens that label, so the path can
 * be climbed with the sidebar hidden. An open conversation adds its subject
 * as the last crumb and its actions at the trailing end, and the mailbox
 * crumb becomes the way back to the list, as Escape is. Only the crumbs and
 * actions themselves leave the window drag area.
 */
const MailboxBreadcrumb = ({
  actions,
  mailbox,
  thread,
}: MailboxBreadcrumbProps) => {
  const { accountIds, selectedAccountId } = useMailboxAccountScope();
  const labelItems = useScopeLabelItems(accountIds);
  const { openAccount, openAllAccounts, openMailbox } = useMailboxNavigation();
  const labelKeys = useMemo(
    () => new Set(labelItems.map(({ key }) => key)),
    [labelItems]
  );
  const scopeName = selectedAccountId ?? "All accounts";
  const crumbs = getMailboxPlaceCrumbs(mailbox, labelKeys);
  const closeDisplay = getHotkeyDisplay("thread.close");
  const handleBack = thread?.onBack;

  return (
    <TitlebarSlot>
      {/* Beside the sidebar the titlebar starts at the column's edge, so the
          crumbs take the list's and row's insets to line up with the rows'
          text; with the sidebar hidden they follow the shell's buttons. */}
      <Breadcrumb className="flex min-w-0 flex-1 items-center pl-4 in-data-[titlebar-inset=trailing]:pl-8">
        <BreadcrumbList className="min-w-0 flex-nowrap text-[13px]">
          <BreadcrumbItem className="min-w-0">
            <Button
              className={crumbButtonClassName}
              onClick={() => {
                if (selectedAccountId === null) {
                  openAllAccounts();
                } else {
                  openAccount(selectedAccountId);
                }
              }}
              title={`${scopeName} Inbox`}
              type="button"
              variant="link"
            >
              {scopeName}
            </Button>
          </BreadcrumbItem>
          {crumbs.map(({ name, place }) => {
            let crumb: ReactNode;
            if (place !== undefined) {
              crumb = (
                <Button
                  className={crumbButtonClassName}
                  onClick={() => openMailbox(selectedAccountId, place)}
                  title={place.label}
                  type="button"
                  variant="link"
                >
                  {name}
                </Button>
              );
            } else if (thread === undefined) {
              crumb = (
                <BreadcrumbPage
                  className="font-heading block truncate font-medium select-none"
                  title={name}
                >
                  {name}
                </BreadcrumbPage>
              );
            } else {
              crumb = (
                <Button
                  aria-keyshortcuts={getHotkeyAriaLabel("thread.close")}
                  className={crumbButtonClassName}
                  onClick={handleBack}
                  title={`${thread.backLabel} (${closeDisplay.bindings[0]})`}
                  type="button"
                  variant="link"
                >
                  {name}
                </Button>
              );
            }

            return (
              <Fragment key={place === undefined ? "current" : place.label}>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">{crumb}</BreadcrumbItem>
              </Fragment>
            );
          })}
          {thread?.subject === undefined ? null : (
            <>
              <BreadcrumbSeparator />
              {/* The path's crumbs are capped, so a long subject gives up
                  most of the room when the titlebar runs short. */}
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage
                  className="font-heading block truncate font-medium select-none"
                  title={thread.subject}
                >
                  {thread.subject}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      {actions === undefined ? null : (
        <div className="app-titlebar-interactive flex shrink-0 items-center gap-1 pl-3">
          {actions}
        </div>
      )}
    </TitlebarSlot>
  );
};

export default MailboxBreadcrumb;
