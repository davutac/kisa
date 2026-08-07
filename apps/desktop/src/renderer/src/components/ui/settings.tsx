import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export type SettingsProps = React.ComponentProps<"div">;

function Settings({ className, ...props }: SettingsProps) {
  return (
    <div
      data-slot="settings"
      className={cn("mx-auto flex w-full max-w-2xl flex-col gap-8", className)}
      {...props}
    />
  );
}

export type SettingsSectionProps = React.ComponentProps<"section">;

function SettingsSection({ className, ...props }: SettingsSectionProps) {
  return (
    <section
      data-slot="settings-section"
      className={cn("flex w-full flex-col gap-3", className)}
      {...props}
    />
  );
}

export type SettingsSectionHeaderProps = React.ComponentProps<"div">;

function SettingsSectionHeader({ className, ...props }: SettingsSectionHeaderProps) {
  return (
    <div
      data-slot="settings-section-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export type SettingsSectionTitleProps = React.ComponentProps<"h2">;

function SettingsSectionTitle({ className, ...props }: SettingsSectionTitleProps) {
  return (
    <h2
      data-slot="settings-section-title"
      className={cn("font-semibold text-lg pl-5 tracking-tight", className)}
      {...props}
    />
  );
}

export type SettingsSectionDescriptionProps = React.ComponentProps<"p">;

function SettingsSectionDescription({ className, ...props }: SettingsSectionDescriptionProps) {
  return (
    <p
      data-slot="settings-section-description"
      className={cn("max-w-2xl text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export type SettingsRowsProps = React.ComponentProps<"div">;

function SettingsRows({ className, ...props }: SettingsRowsProps) {
  return (
    <div
      role="list"
      data-slot="settings-rows"
      className={cn(
        "flex w-full flex-col divide-y divide-border overflow-hidden rounded-lg border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

const settingsRowVariants = cva(
  "flex min-h-20 w-full flex-col gap-3 px-4 py-4 outline-none transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:px-5",
  {
    variants: {
      variant: {
        default: "",
        interactive:
          "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type SettingsRowProps = useRender.ComponentProps<"div"> &
  VariantProps<typeof settingsRowVariants>;

function SettingsRow({ className, variant = "default", render, ...props }: SettingsRowProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "listitem",
        className: cn(settingsRowVariants({ variant, className })),
      },
      props,
    ),
    render,
    state: {
      slot: "settings-row",
      variant,
    },
  });
}

export type SettingsRowContentProps = React.ComponentProps<"div">;

function SettingsRowContent({ className, ...props }: SettingsRowContentProps) {
  return (
    <div
      data-slot="settings-row-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  );
}

export type SettingsRowTitleProps = React.ComponentProps<"div">;

function SettingsRowTitle({ className, ...props }: SettingsRowTitleProps) {
  return (
    <div
      data-slot="settings-row-title"
      className={cn("font-medium text-sm leading-snug", className)}
      {...props}
    />
  );
}

export type SettingsRowDescriptionProps = React.ComponentProps<"p">;

function SettingsRowDescription({ className, ...props }: SettingsRowDescriptionProps) {
  return (
    <p
      data-slot="settings-row-description"
      className={cn("text-muted-foreground text-sm leading-snug", className)}
      {...props}
    />
  );
}

export type SettingsRowActionsProps = React.ComponentProps<"div">;

function SettingsRowActions({ className, ...props }: SettingsRowActionsProps) {
  return (
    <div
      data-slot="settings-row-actions"
      className={cn("flex shrink-0 items-center gap-2 sm:ml-auto", className)}
      {...props}
    />
  );
}

export {
  Settings,
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRows,
  SettingsRowTitle,
  SettingsSection,
  SettingsSectionDescription,
  SettingsSectionHeader,
  SettingsSectionTitle,
};
