import { LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileInput, FileInputDropzone } from "@/components/ui/file-input";

const NO_FILES: File[] = [];

interface FileSelectionRowProps {
  readonly disabled: boolean;
  readonly fileName?: string;
  readonly isSelecting: boolean;
  readonly label: string;
  readonly onDropFile: (file: File) => void;
  readonly onSelect: () => void;
}

// The row takes a dropped or pasted file and hands it on; Select opens main's
// own file dialog, so the file input never holds a file or opens a picker.
const FileSelectionRow = ({
  disabled,
  fileName,
  isSelecting,
  label,
  onDropFile,
  onSelect,
}: FileSelectionRowProps) => (
  <FileInput
    aria-label={label}
    disabled={disabled || isSelecting}
    onValueChange={(_files, details) => {
      const [file] = details.added;
      if (file !== undefined) {
        onDropFile(file);
      }
    }}
    value={NO_FILES}
  >
    <FileInputDropzone className="border-border data-dragging:bg-muted flex items-center justify-between gap-4 rounded-lg border p-3 text-left transition-colors">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground truncate" title={fileName}>
          {fileName ?? "Select a file or drop it here"}
        </div>
      </div>
      <Button
        disabled={disabled || isSelecting}
        onClick={onSelect}
        type="button"
        variant="outline"
      >
        {isSelecting ? <LoaderCircleIcon className="animate-spin" /> : null}
        {fileName === undefined ? `Select ${label}` : "Change"}
      </Button>
    </FileInputDropzone>
  </FileInput>
);

export default FileSelectionRow;
