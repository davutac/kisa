import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { AppSettingsApi } from "@/platform/desktop";
import type { InlineImageRetentionDays } from "@/shared/ipc/app";
import { useAppSettings } from "@/state/app-settings";

const COLLISION_AVOIDANCE = { side: "none" } as const;

export const INLINE_IMAGE_RETENTION_OPTIONS = [
  { days: 30, label: "30 days", value: "30" },
  { days: 90, label: "90 days", value: "90" },
  { days: 365, label: "1 year", value: "365" },
  { days: null, label: "Forever", value: "forever" },
] as const satisfies readonly {
  readonly days: InlineImageRetentionDays;
  readonly label: string;
  readonly value: string;
}[];

export const findInlineImageRetentionOption = (
  days: InlineImageRetentionDays
) =>
  INLINE_IMAGE_RETENTION_OPTIONS.find((option) => option.days === days) ??
  INLINE_IMAGE_RETENTION_OPTIONS[1];

interface SettingsInlineImagesRowProps {
  readonly appSettingsApi: AppSettingsApi;
}

/** How long images kept from opened emails last once they stop being shown. */
const SettingsInlineImagesRow = ({
  appSettingsApi,
}: SettingsInlineImagesRowProps) => {
  const { inlineImageRetentionDays, setInlineImageRetentionDays } =
    useAppSettings(appSettingsApi);
  const selected = findInlineImageRetentionOption(inlineImageRetentionDays);

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id="inline-images-title">
          Keep images from opened emails
        </SettingsRowTitle>
        <SettingsRowDescription id="inline-images-description">
          Images sent inside an email are saved when you open it, so it opens
          without downloading them again. Images from emails you have not opened
          for this long are removed.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-describedby="inline-images-description"
                aria-label={`Keep images from opened emails, ${selected.label}`}
                className="w-fit justify-between gap-3 font-normal"
                type="button"
                variant="secondary"
              />
            }
          >
            <span>{selected.label}</span>
            <ChevronDownIcon
              aria-hidden
              className="text-muted-foreground shrink-0"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionAvoidance={COLLISION_AVOIDANCE}
            side="bottom"
          >
            <DropdownMenuRadioGroup
              onValueChange={(value: string) => {
                const option = INLINE_IMAGE_RETENTION_OPTIONS.find(
                  (candidate) => candidate.value === value
                );
                if (option !== undefined) {
                  setInlineImageRetentionDays(option.days);
                }
              }}
              value={selected.value}
            >
              {INLINE_IMAGE_RETENTION_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsInlineImagesRow;
