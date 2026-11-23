import { createFileRoute } from "@tanstack/react-router";

import MailThreadView from "@/components/mail/thread-view";
import { useHotkeyLayer } from "@/hotkeys";
import { useThreadActions } from "@/mail/use-thread-actions";

export const Route = createFileRoute("/thread/$accountId/$threadId")({
  component: ThreadWindowRoute,
});

function closeWindow(): void {
  window.close();
}

function ThreadWindowRoute() {
  const { accountId, threadId } = Route.useParams();
  // Closing this window is how its actions leave the conversation, and a
  // closed window cannot report a failure: it closes once the server agrees.
  const { deleteForever, notSpam, setLabel, toggleRead, trash } =
    useThreadActions({ leaveAfterConfirmation: true });

  useHotkeyLayer("thread", true);

  return (
    <div className="bg-background min-h-full overflow-x-hidden overflow-y-auto">
      <MailThreadView
        accountId={accountId}
        closeLabel="Close window"
        onClose={closeWindow}
        onDeleteForever={deleteForever}
        onNotSpam={notSpam}
        onSetLabel={setLabel}
        onToggleRead={toggleRead}
        onTrash={trash}
        showCloseButton={false}
        threadId={threadId}
      />
    </div>
  );
}
