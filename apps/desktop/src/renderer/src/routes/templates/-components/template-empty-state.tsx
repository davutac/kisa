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
      <EmptyTitle>Select a template</EmptyTitle>
      <EmptyDescription>
        Open a template to edit it, or create a new one.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export default TemplateEmptyState;
