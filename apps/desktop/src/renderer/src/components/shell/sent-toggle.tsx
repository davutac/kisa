import { SendIcon } from "lucide-react";

import TitlebarMailboxToggle from "@/components/shell/mailbox-toggle";

const TitlebarSentToggle = () => (
  <TitlebarMailboxToggle
    ariaLabel="Sent"
    command="app.toggleSent"
    mailbox="sent"
  >
    <SendIcon />
  </TitlebarMailboxToggle>
);

export default TitlebarSentToggle;
