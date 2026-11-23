import type { ReactNode } from "react";

import { MailListRow } from "../../src/renderer/src/primitives/mail-list";
import type { MailListOptions } from "../../src/renderer/src/primitives/mail-list";
import { MailListRoot } from "../../src/renderer/src/primitives/mail-list-root";

// Rows and their parts render only inside a list. This one renders the row
// it is given rather than the ones a scroller would show.
export const InMailList = ({
  children,
  rowKey,
  withRow = false,
  ...options
}: Pick<MailListOptions, "checkable" | "onActivate" | "onCheckedChange"> & {
  readonly children: ReactNode;
  readonly rowKey: string;
  readonly withRow?: boolean;
}) => (
  <MailListRoot
    estimate={88}
    gridLabel="Conversations"
    keys={[rowKey]}
    {...options}
  >
    {() =>
      withRow ? <MailListRow value={rowKey}>{children}</MailListRow> : children
    }
  </MailListRoot>
);
