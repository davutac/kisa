import { createFileRoute } from "@tanstack/react-router";

import { useHotkeyLayer } from "@/hotkeys";

import TemplateEditor from "./-components/template-editor";
import TemplateEmptyState from "./-components/template-empty-state";
import TemplatesSidebar from "./-components/templates-sidebar";
import { useTemplateWorkspace } from "./-components/use-template-workspace";

export const Route = createFileRoute("/templates")({
  component: TemplatesRoute,
});

function TemplatesRoute() {
  useHotkeyLayer("templates", true);
  const workspace = useTemplateWorkspace();

  return (
    <section
      aria-labelledby="templates-title"
      className="bg-background flex min-h-0 flex-1 gap-2 overflow-hidden p-2"
    >
      <TemplatesSidebar {...workspace.sidebar} />
      {workspace.editor === null ? (
        <TemplateEmptyState />
      ) : (
        <TemplateEditor {...workspace.editor} />
      )}
    </section>
  );
}
