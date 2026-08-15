import { LoaderCircleIcon, XIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotionConfig } from "motion/react";

import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { easeInOut, NO_MOTION } from "@/lib/motion";

interface CleanDraftHistoryStripProps {
  disabled: boolean;
  onDismiss: (version: CleanDraftVersion) => void;
  onSelect: (version: CleanDraftVersion) => void;
  selectedVersionId: string | null;
  versions: readonly CleanDraftVersion[];
}

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
    <div
      aria-label="Draft history"
      className="border-background scroll-fade-x min-w-0 shrink-0 scrollbar-thin overflow-x-auto border-t px-2 py-1"
    >
      <div className="flex w-max min-w-full items-center gap-1">
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
                  <Button
                    aria-label={`Use ${version.label} draft`}
                    aria-pressed={isSelected}
                    disabled={disabled || isLoading}
                    onClick={() => onSelect(version)}
                    size="sm"
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                  >
                    {isLoading ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : null}
                    {isLoading
                      ? version.label.replace("Clean", "Cleaning…")
                      : version.label}
                  </Button>
                  {version.id === "original" ? null : (
                    <Button
                      aria-label={`Dismiss ${version.label} draft`}
                      disabled={disabled}
                      onClick={() => onDismiss(version)}
                      size="icon-sm"
                      title={`Dismiss ${version.label}`}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                    >
                      <XIcon />
                    </Button>
                  )}
                </ButtonGroup>
              </m.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CleanDraftHistoryStrip;
