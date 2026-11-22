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
 * What the editor area shows with no template open. The first visit explains
 * what a template is for and offers the New action; afterwards it only points
 * at the list. While templates load it stays blank rather than claiming
 * there are none.
 */
const TemplateEmptyState = ({
  isLoading,
  onCreate,
  templateCount,
}: TemplateEmptyStateProps) => {
  if (isLoading) {
    return <div aria-hidden="true" className="flex-1" />;
  }

  if (templateCount > 0) {
    return (
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
    );
  }

  return (
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
  );
};

export default TemplateEmptyState;
