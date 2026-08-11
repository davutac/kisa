import { FileTextIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const TemplateEmptyState = () => (
  <Empty className="bg-card rounded-xl">
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

export default TemplateEmptyState;
