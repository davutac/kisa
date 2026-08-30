import { Trash2Icon } from "lucide-react";

import TitlebarMailboxToggle from "@/components/shell/mailbox-toggle";

const TitlebarTrashToggle = () => (
  <TitlebarMailboxToggle
    ariaLabel="Trash"
    command="app.toggleTrash"
    mailbox="trash"
  >
    <Trash2Icon />
  </TitlebarMailboxToggle>
);

export default TitlebarTrashToggle;
