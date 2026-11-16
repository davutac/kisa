/**
 * A footer's primary action (Send, Schedule, Save template) is filled while it
 * can run. Disabled, as a new message without recipients or an unchanged
 * template is, it rests at the secondary level, so the inert control is never
 * the loudest thing on screen.
 */
export const primaryFooterActionClassName =
  "disabled:bg-secondary disabled:text-secondary-foreground";

/** A keyboard hint inside a primary footer action, following its fill. */
export const primaryFooterHintClassName =
  "*:bg-primary-foreground/15 *:text-primary-foreground/70 group-disabled/button:*:bg-muted group-disabled/button:*:text-muted-foreground";

/** Secondary text inside a primary footer action, following its fill. */
export const primaryFooterStatusClassName =
  "text-primary-foreground/70 group-disabled/button:text-muted-foreground";

/**
 * Icon-only delete actions (Trash, Discard, Delete) stay neutral at rest so
 * they never outrank the action beside them, and turn red when pointed at or
 * reached by keyboard, before their confirmation. The dark hover replaces
 * the ghost variant's own dark hover, which would otherwise win.
 */
export const quietDestructiveClassName =
  "hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive dark:hover:bg-destructive/20";
