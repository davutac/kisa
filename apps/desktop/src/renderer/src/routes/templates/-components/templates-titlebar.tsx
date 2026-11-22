import { LoaderCircleIcon, PlusIcon, SaveIcon } from "lucide-react";

import { PageTitlebar } from "@/components/shell/page-titlebar";
import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import {
  primaryFooterActionClassName,
  primaryFooterHintClassName,
} from "@/lib/action-hierarchy";
import { cn } from "@/lib/utils";

import { TEMPLATE_EDITOR_FORM_ID } from "./template-editor";

interface TemplateEditorActions {
  readonly isCreating: boolean;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
}

interface TemplatesTitlebarActionsProps {
  /** The open template's save state, or null while none is open. */
  readonly editor: TemplateEditorActions | null;
  readonly onCreate: () => void;
}

interface TemplatesTitlebarProps extends TemplatesTitlebarActionsProps {
  readonly titleId: string;
}

const getSaveStatus = ({
  isCreating,
  isDirty,
  isSaving,
}: TemplateEditorActions): string | null => {
  if (isSaving) {
    return isCreating ? "Adding…" : "Saving…";
  }
  // A resting Save already says there is nothing to save, and a new
  // template's Add says it is not saved yet.
  return isDirty && !isCreating ? "Unsaved changes" : null;
};

/**
 * The Templates page's actions, like the new-email page's: a quiet New
 * button, then Save as the one filled action while a template is open.
 * Delete belongs to the template, in the editor's header. Save submits the
 * editor's form by id, because the titlebar is rendered outside it.
 */
export const TemplatesTitlebarActions = ({
  editor,
  onCreate,
}: TemplatesTitlebarActionsProps) => {
  const newDisplay = getHotkeyDisplay("templates.new");
  const saveDisplay = getHotkeyDisplay("templates.save");
  const status = editor === null ? null : getSaveStatus(editor);

  return (
    <>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("templates.new")}
        aria-label={newDisplay.label}
        className="text-muted-foreground hover:text-foreground"
        onClick={onCreate}
        size="icon"
        title={`${newDisplay.label} (${newDisplay.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <PlusIcon />
      </Button>
      {editor === null ? null : (
        <>
          {status === null ? null : (
            <output
              aria-live="polite"
              className="text-muted-foreground px-1.5 text-xs whitespace-nowrap"
            >
              {status}
            </output>
          )}
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("templates.save")}
            className={cn(primaryFooterActionClassName, "px-2.5")}
            disabled={!editor.isDirty || editor.isSaving}
            form={TEMPLATE_EDITOR_FORM_ID}
            title={`${saveDisplay.label} (${saveDisplay.bindings[0]})`}
            type="submit"
            variant="default"
          >
            {editor.isSaving ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <SaveIcon />
            )}
            {editor.isCreating ? "Add" : "Save"}
            <HotkeyHint
              className={cn("ml-2", primaryFooterHintClassName)}
              command="templates.save"
            />
          </Button>
        </>
      )}
    </>
  );
};

/** The Templates page's title and actions in the content titlebar. */
const TemplatesTitlebar = ({ titleId, ...actions }: TemplatesTitlebarProps) => (
  <PageTitlebar title="Templates" titleId={titleId}>
    <TemplatesTitlebarActions {...actions} />
  </PageTitlebar>
);

export default TemplatesTitlebar;
