import { createFileRoute } from "@tanstack/react-router";

import { useHotkeyLayer } from "@/hotkeys";

import TemplateEditor from "./-components/template-editor";
import TemplateEmptyState from "./-components/template-empty-state";
import TemplatesSidebar from "./-components/templates-sidebar";
import TemplatesTitlebar from "./-components/templates-titlebar";
import { useTemplateWorkspace } from "./-components/use-template-workspace";

export const Route = createFileRoute("/templates")({
  component: TemplatesRoute,
});

/**
 * Templates as a list beside an editor, set flat on the page like the
 * new-email page rather than in cards, with the title, New, Delete, and Save
 * in the content titlebar.
 */
function TemplatesRoute() {
  useHotkeyLayer("templates", true);
  const { createTemplate, editor, sidebar } = useTemplateWorkspace();

  return (
    <section
      aria-labelledby="templates-title"
      className="bg-background flex min-h-0 flex-1 overflow-hidden"
    >
      <TemplatesTitlebar
        editor={editor}
        onCreate={createTemplate}
        titleId="templates-title"
      />
      {/* With no templates the empty state alone explains them; an empty
          list beside it would only be a blank column. */}
      {sidebar.isLoading || sidebar.totalTemplateCount > 0 ? (
        <TemplatesSidebar {...sidebar} />
      ) : null}
      {editor === null ? (
        <TemplateEmptyState
          isLoading={sidebar.isLoading}
          onCreate={createTemplate}
          templateCount={sidebar.totalTemplateCount}
        />
      ) : (
        <TemplateEditor {...editor} />
      )}
    </section>
  );
}
