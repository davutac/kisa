import { FileTextIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { getHotkeyAriaLabel, HotkeyHint } from "@/hotkeys";

interface TemplateEmptyStateProps {
  readonly isLoading: boolean;
  readonly onCreate: () => void;
  readonly templateCount: number;
}

/**
 * The editor's card frame, inset like the editor form so the card stays put
 * when a template opens or closes.
 */
const EmptyCard = ({ children }: { readonly children?: React.ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col px-2 pt-1 pb-2">
    <div className="bg-card flex min-h-0 flex-1 flex-col rounded-lg">
      {children}
    </div>
  </div>
);

/**
 * What the editor area shows with no template open, in the same card as the
 * editor. The first visit explains what a template is for and offers the New
 * action; afterwards it only points at the list. While templates load the
 * card stays blank rather than claiming there are none.
 */
const TemplateEmptyState = ({
  isLoading,
  onCreate,
  templateCount,
}: TemplateEmptyStateProps) => {
  if (isLoading) {
    return <EmptyCard />;
  }

  if (templateCount > 0) {
    return (
      <EmptyCard>
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>No template in the spotlight</EmptyTitle>
            <EmptyDescription>
              Pick one to edit, or make a new one for Future You.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </EmptyCard>
    );
  }

  return (
    <EmptyCard>
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>No templates yet</EmptyTitle>
          <EmptyDescription>
            Save an email you write again and again, then type <Kbd>/</Kbd> in a
            new email to drop it in.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("templates.new")}
            onClick={onCreate}
            type="button"
            variant="secondary"
          >
            <PlusIcon />
            New template
            <HotkeyHint className="ml-2" command="templates.new" />
          </Button>
        </EmptyContent>
      </Empty>
    </EmptyCard>
  );
};

export default TemplateEmptyState;
