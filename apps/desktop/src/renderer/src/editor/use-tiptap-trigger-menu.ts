import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { TriggerMenuOpenChangeReason } from "@ui-sdk/react/trigger-menu";
import { useEffect, useMemo, useRef } from "react";

import { createTriggerMenuController } from "@/components/ui/trigger-menu";
import { createTiptapTextAdapter } from "@/editor/tiptap-text-adapter";
import type { TiptapTextAdapterOptions } from "@/editor/tiptap-text-adapter";
import { useInstanceValue } from "@/hooks/use-instance-value";

const ESCAPE_PLUGIN_KEY = new PluginKey("triggerMenuEscape");

interface DismissedMatch {
  readonly start: number;
  readonly trigger: string;
}

interface OpenChangeDetails {
  readonly cancel: () => void;
  readonly reason: TriggerMenuOpenChangeReason;
}

// ui-sdk closes a trigger menu on Escape from its document-level layers, after
// `@/hotkeys` saw the key; closing it here marks the key handled for them.
export const useTiptapTriggerMenu = (
  editor: Editor | null,
  options?: TiptapTextAdapterOptions
) => {
  const controller = useInstanceValue(createTriggerMenuController);
  const dismissedRef = useRef<DismissedMatch | null>(null);
  const adapter = useMemo(
    () =>
      editor === null ? undefined : createTiptapTextAdapter(editor, options),
    [editor, options]
  );

  useEffect(() => {
    if (editor === null) {
      return;
    }

    editor.registerPlugin(
      new Plugin({
        key: ESCAPE_PLUGIN_KEY,
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key !== "Escape" || !controller.isOpen()) {
              return false;
            }
            const match = controller.getMatch();
            dismissedRef.current =
              match === null
                ? null
                : { start: match.start, trigger: match.trigger };
            controller.setOpen(false, { event, reason: "escape-key" });
            return true;
          },
        },
      })
    );
    const followDismissed = ({ transaction }: { transaction: Transaction }) => {
      const dismissed = dismissedRef.current;
      if (dismissed === null || !transaction.docChanged) {
        return;
      }
      const { deleted, pos } = transaction.mapping.mapResult(
        dismissed.start,
        1
      );
      const end = pos + dismissed.trigger.length;
      dismissedRef.current =
        deleted ||
        end > transaction.doc.content.size ||
        transaction.doc.textBetween(pos, end) !== dismissed.trigger
          ? null
          : { ...dismissed, start: pos };
    };
    editor.on("transaction", followDismissed);

    return () => {
      editor.off("transaction", followDismissed);
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(ESCAPE_PLUGIN_KEY);
      }
    };
  }, [controller, editor]);

  const handleOpenChange = (open: boolean, details: OpenChangeDetails) => {
    if (!open) {
      return;
    }
    if (details.reason === "shortcut") {
      dismissedRef.current = null;
      return;
    }
    const dismissed = dismissedRef.current;
    if (
      dismissed !== null &&
      controller.getMatch()?.start === dismissed.start
    ) {
      details.cancel();
    }
  };

  return { adapter, controller, onOpenChange: handleOpenChange };
};
