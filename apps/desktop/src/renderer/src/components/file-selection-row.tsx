import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileSelectionRowProps {
  readonly disabled: boolean;
  readonly fileName?: string;
  readonly isSelecting: boolean;
  readonly label: string;
  readonly onDropFile: (file: File) => void;
  readonly onSelect: () => void;
}

const FileSelectionRow = ({
  disabled,
  fileName,
  isSelecting,
  label,
  onDropFile,
  onSelect,
}: FileSelectionRowProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const isDisabled = disabled || isSelecting;

  return (
    <div
      className={cn(
        "border-border flex items-center justify-between gap-4 rounded-lg border p-3 text-left transition-colors",
        isDragging && "bg-muted"
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!isDisabled) {
          setIsDragging(true);
        }
      }}
      onDragLeave={() => {
        setIsDragging(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = isDisabled ? "none" : "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files.item(0);
        if (!isDisabled && file !== null) {
          onDropFile(file);
        }
      }}
    >
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground truncate" title={fileName}>
          {fileName ?? "Select a file or drop it here"}
        </div>
      </div>
      <Button
        disabled={isDisabled}
        onClick={onSelect}
        type="button"
        variant="outline"
      >
        {isSelecting ? <LoaderCircleIcon className="animate-spin" /> : null}
        {fileName === undefined ? `Select ${label}` : "Change"}
      </Button>
    </div>
  );
};

export default FileSelectionRow;
