import { LoaderCircleIcon, XIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotionConfig } from "motion/react";

import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import { ButtonGroup } from "@/components/ui/button-group";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import { easeInOut, NO_MOTION } from "@/lib/motion";

interface CleanDraftHistoryStripProps {
  disabled: boolean;
  onDismiss: (version: CleanDraftVersion) => void;
  onSelect: (version: CleanDraftVersion) => void;
  selectedVersionId: string | null;
  versions: readonly CleanDraftVersion[];
}

// A toggle group rather than radios: choosing a version rewrites the draft, so
// arrow keys only move focus and Enter or Space chooses.
const CleanDraftHistoryStrip = ({
  disabled,
  onDismiss,
  onSelect,
  selectedVersionId,
  versions,
}: CleanDraftHistoryStripProps) => {
  const shouldReduceMotion = useReducedMotionConfig();

  if (!versions.some(({ id }) => id !== "original")) {
    return null;
  }

  return (
    <Toolbar
      aria-label="Draft history"
      className="scroll-fade-x min-w-0 shrink-0 scrollbar-thin overflow-x-auto px-2 py-1"
      disabled={disabled}
    >
      <ToggleGroup
        aria-label="Draft version"
        className="w-max min-w-full"
        deselectable={false}
        onValueChange={([id]) => {
          const version = versions.find((candidate) => candidate.id === id);
          if (version !== undefined) {
            onSelect(version);
          }
        }}
        value={selectedVersionId === null ? [] : [selectedVersionId]}
      >
        <AnimatePresence mode="popLayout">
          {versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            const isLoading = version.status === "loading";

            return (
              <m.div
                animate={{ opacity: 1, scale: 1, x: 0 }}
                className="shrink-0"
                exit={{ opacity: 0, scale: 0.96, x: -4 }}
                initial={
                  shouldReduceMotion
                    ? false
                    : { opacity: 0, scale: 0.96, x: -4 }
                }
                key={version.id}
                layout={shouldReduceMotion ? false : "position"}
                transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.16)}
              >
                <ButtonGroup>
                  <Toggle
                    aria-label={`Use ${version.label} draft`}
                    disabled={isLoading}
                    size="sm"
                    value={version.id}
                    variant="outline"
                  >
                    {isLoading ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : null}
                    {isLoading
                      ? version.label.replace("Clean", "Cleaning…")
                      : version.label}
                  </Toggle>
                  {version.id === "original" ? null : (
                    <ToolbarButton
                      aria-label={`Dismiss ${version.label} draft`}
                      onClick={() => onDismiss(version)}
                      size="icon-sm"
                      title={`Dismiss ${version.label}`}
                      variant={isSelected ? "default" : "outline"}
                    >
                      <XIcon />
                    </ToolbarButton>
                  )}
                </ButtonGroup>
              </m.div>
            );
          })}
        </AnimatePresence>
      </ToggleGroup>
    </Toolbar>
  );
};

export default CleanDraftHistoryStrip;
