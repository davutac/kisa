import { Menu } from "electron";
import type {
  BrowserWindow,
  ContextMenuParams,
  MenuItemConstructorOptions,
} from "electron";

type TextContextMenuParams = Pick<
  ContextMenuParams,
  "editFlags" | "isEditable" | "selectionText"
>;

const getEditableTextMenuTemplate = ({
  editFlags,
}: TextContextMenuParams): MenuItemConstructorOptions[] => [
  { enabled: editFlags.canUndo, role: "undo" },
  { enabled: editFlags.canRedo, role: "redo" },
  { type: "separator" },
  { enabled: editFlags.canCut, role: "cut" },
  { enabled: editFlags.canCopy, role: "copy" },
  { enabled: editFlags.canPaste, role: "paste" },
  { enabled: editFlags.canPaste, role: "pasteAndMatchStyle" },
  { enabled: editFlags.canDelete, role: "delete" },
  { type: "separator" },
  { enabled: editFlags.canSelectAll, role: "selectAll" },
];

const getSelectedTextMenuTemplate = ({
  editFlags,
}: TextContextMenuParams): MenuItemConstructorOptions[] => [
  { enabled: editFlags.canCopy, role: "copy" },
  { type: "separator" },
  { enabled: editFlags.canSelectAll, role: "selectAll" },
];

export const getTextContextMenuTemplate = (
  params: TextContextMenuParams
): MenuItemConstructorOptions[] => {
  if (params.isEditable) {
    return getEditableTextMenuTemplate(params);
  }

  if (params.selectionText.length > 0) {
    return getSelectedTextMenuTemplate(params);
  }

  return [];
};

export const installNativeContextMenu = (window: BrowserWindow): void => {
  window.webContents.on("context-menu", (_event, params) => {
    const template = getTextContextMenuTemplate(params);

    if (template.length === 0) {
      return;
    }

    Menu.buildFromTemplate(template).popup({
      ...(params.frame === null ? {} : { frame: params.frame }),
      window,
    });
  });
};
