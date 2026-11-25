import type { DatabaseImportActivation } from "../database-import";

interface ImportActivationNotice {
  readonly detail: string;
  readonly message: string;
}

const NOTICES = {
  dropped: {
    detail:
      "Kisa could not activate it and started with your current database, which was not changed. Import the database again from Settings.",
    message: "The imported database was not activated",
  },
  restored: {
    detail:
      "Activating it failed part-way, so Kisa put your previous database back and started with that. Import the database again from Settings.",
    message: "The imported database was not activated",
  },
} satisfies Partial<Record<DatabaseImportActivation, ImportActivationNotice>>;

interface NoticeWindow {
  readonly isVisible: () => boolean;
  readonly once: (event: "show", listener: () => void) => void;
}

interface ImportActivationNoticeOptions<Window extends NoticeWindow> {
  readonly getWindow: () => Window | undefined;
  readonly show: (window: Window, notice: ImportActivationNotice) => void;
}

/**
 * Tells the user that the import they restarted for was not activated. The
 * notice is attached to the main window: one with no window blocks the whole
 * app on macOS until it is answered. A window that starts hidden shows it
 * when it is first shown, not over nothing.
 */
export const announceImportActivation = <Window extends NoticeWindow>(
  activation: DatabaseImportActivation,
  { getWindow, show }: ImportActivationNoticeOptions<Window>
): void => {
  if (activation !== "dropped" && activation !== "restored") {
    return;
  }

  const window = getWindow();

  if (window === undefined) {
    return;
  }

  const notice = NOTICES[activation];

  if (window.isVisible()) {
    show(window, notice);

    return;
  }

  window.once("show", () => {
    show(window, notice);
  });
};
