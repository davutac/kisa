import { isLabelPlace, isSameMailboxPlace } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";

export type ShellViewPath =
  | "/"
  | "/compose"
  | "/scheduled"
  | "/settings"
  | "/templates";
export type WorkspacePath = Exclude<ShellViewPath, "/">;

export interface WorkspaceToggleInput {
  readonly currentPath: ShellViewPath;
  readonly previousPath: ShellViewPath | null;
  readonly targetPath: WorkspacePath;
}

/** Opening the current workspace again returns to the view it replaced. */
export const resolveWorkspaceToggle = ({
  currentPath,
  previousPath,
  targetPath,
}: WorkspaceToggleInput): ShellViewPath =>
  currentPath === targetPath ? (previousPath ?? "/") : targetPath;

/**
 * What opening `targetPath` from `currentPath` should return to when it is
 * closed again. A new email is a passing page: leaving it for another
 * workspace remembers what the email was written over, so closing that
 * workspace never opens a blank email in its place.
 */
export const resolveWorkspacePreviousPath = (
  currentPath: ShellViewPath,
  targetPath: WorkspacePath,
  composePreviousPath: ShellViewPath | null
): ShellViewPath | null => {
  const previousPath =
    currentPath === "/compose" ? composePreviousPath : currentPath;

  return previousPath === targetPath ? null : previousPath;
};

export const shouldShowScheduled = (
  isScheduledOpen: boolean,
  hasScheduledMail: boolean
): boolean => isScheduledOpen || hasScheduledMail;

export const toShellViewPath = (pathname: string): ShellViewPath => {
  if (
    pathname === "/compose" ||
    pathname === "/scheduled" ||
    pathname === "/settings" ||
    pathname === "/templates"
  ) {
    return pathname;
  }

  return "/";
};

/** One mailbox or label in one account scope; `null` is every account. */
export interface MailboxTarget {
  readonly accountId: string | null;
  readonly mailbox: MailboxPlace;
}

/** What the mailbox view shows now. */
export interface MailboxView {
  readonly currentPath: ShellViewPath;
  readonly mailbox: MailboxPlace;
  readonly selectedAccountId: string | null;
}

/** A mailbox only counts as current while the mailbox view shows it. */
export const isMailboxCurrent = (
  view: MailboxView,
  target: MailboxTarget
): boolean =>
  view.currentPath === "/" &&
  isSameMailboxPlace(view.mailbox, target.mailbox) &&
  view.selectedAccountId === target.accountId;

/**
 * Sent, Spam, Trash, and labels are toggles: choosing the one on screen
 * returns to the Inbox of the same scope. Anything else opens the chosen
 * place.
 */
export const resolveMailboxSelection = (
  view: MailboxView,
  target: MailboxTarget
): MailboxTarget =>
  target.mailbox !== "inbox" && isMailboxCurrent(view, target)
    ? { accountId: target.accountId, mailbox: "inbox" }
    : target;

/**
 * The account scope filters the mailbox and Scheduled, so an account row is
 * current only while one of those views is on screen.
 */
export const isAccountScopeCurrent = (
  currentPath: ShellViewPath,
  selectedAccountId: string | null,
  accountId: string | null
): boolean =>
  (currentPath === "/" || currentPath === "/scheduled") &&
  selectedAccountId === accountId;

/**
 * An account row stands for its scope's Inbox, so it is current while that
 * Inbox or Scheduled shows the scope. Sent, Spam, Trash, or a label on screen
 * moves the current state to that row once it is shown, so only one row
 * reads as current; while the rows are hidden the account row keeps it.
 */
export const isScopeRowCurrent = (
  view: MailboxView,
  accountId: string | null,
  isExpanded: boolean
): boolean =>
  isAccountScopeCurrent(view.currentPath, view.selectedAccountId, accountId) &&
  !(isExpanded && view.currentPath === "/" && view.mailbox !== "inbox");

export interface ScopeRowSelection {
  /** Whether the row's mailboxes show afterwards. */
  readonly isExpanded: boolean;
  /** Whether choosing the row opens its scope's Inbox. */
  readonly opensInbox: boolean;
}

/**
 * The whole account row discloses its mailboxes. Choosing it away from its
 * Inbox opens that Inbox and shows its mailboxes; choosing it while its
 * Inbox is on screen only opens or closes them.
 */
export const resolveScopeRowSelection = (
  view: MailboxView,
  accountId: string | null,
  isExpanded: boolean
): ScopeRowSelection =>
  isMailboxCurrent(view, { accountId, mailbox: "inbox" })
    ? { isExpanded: !isExpanded, opensInbox: false }
    : { isExpanded: true, opensInbox: true };

/**
 * A scope's Labels row stands in for the label on screen while its labels are
 * hidden, as an account row does for its mailboxes, so the current place
 * always has a row that reads as current.
 */
export const isLabelsRowCurrent = (
  view: MailboxView,
  accountId: string | null,
  isExpanded: boolean
): boolean =>
  !isExpanded &&
  view.currentPath === "/" &&
  view.selectedAccountId === accountId &&
  isLabelPlace(view.mailbox);
