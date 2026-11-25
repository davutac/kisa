import { useLocation, useNavigate } from "@tanstack/react-router";

import { useMailboxStore, useShowUnread } from "@/state/mailbox";

/**
 * The unread-only filter, shared by its sidebar toggle and the `U` shortcut.
 * The shell registers the shortcut, so it also works from a workspace, where
 * it returns to the mailbox to show the result.
 */
export const useUnreadFilter = () => {
  const showUnread = useShowUnread();
  const setShowUnread = useMailboxStore((state) => state.setShowUnread);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const setUnreadFilter = (pressed: boolean): void => {
    setShowUnread(pressed);

    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  };

  return { setUnreadFilter, showUnread };
};
