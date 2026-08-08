import { MailOpenIcon } from "lucide-react";

import MailThreadConversation from "@/components/mail/thread-conversation";
import MailThreadHeader from "@/components/mail/thread-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useMailThread } from "@/mail/use-mail-thread";
import { useMailboxStore } from "@/state/mailbox";

const ThreadPending = () => (
  <Empty aria-live="polite" className="h-full min-h-0 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Spinner />
      </EmptyMedia>
      <EmptyTitle>Loading conversation…</EmptyTitle>
    </EmptyHeader>
  </Empty>
);

const ThreadError = ({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) => (
  <Empty className="min-h-0 flex-1 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <MailOpenIcon />
      </EmptyMedia>
      <EmptyTitle>{message}</EmptyTitle>
      <Button onClick={onClose} type="button" variant="outline">
        Back to inbox
      </Button>
    </EmptyHeader>
  </Empty>
);

interface MailThreadViewProps {
  accountId: string;
  threadId: string;
}

const MailThreadView = ({ accountId, threadId }: MailThreadViewProps) => {
  const closeThread = useMailboxStore((state) => state.closeThread);
  const state = useMailThread(accountId, threadId);

  if (state.status === "loading") {
    return <ThreadPending />;
  }

  if (state.status === "error") {
    return <ThreadError message={state.message} onClose={closeThread} />;
  }

  const { thread } = state;
  const latestMessage = thread.messages.at(-1);

  return (
    // The header owns the top gutter and the top radius: both belong to the
    // sticky box so its backdrop keeps covering them once messages scroll up
    // behind it.
    <section className="relative flex w-full min-w-0 flex-col gap-px px-4 pb-4 *:last:rounded-b-lg">
      <MailThreadHeader
        accountId={thread.accountId}
        labels={thread.labels}
        latestAt={latestMessage?.sentAt}
        subject={thread.subject}
      />
      <MailThreadConversation
        accountId={thread.accountId}
        messages={thread.messages}
      />
    </section>
  );
};

export default MailThreadView;
