import { mergeProps, renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

export type SettingsProps = LayoutProps<"div">;

const Settings = ({ className, render, ...props }: SettingsProps) =>
  renderElement(
    "div",
    {
      "data-slot": "settings",
      className: cn("mx-auto flex w-full max-w-3xl flex-col gap-8", className),
      ...props,
    },
    render
  );

export type SettingsSectionProps = LayoutProps<"section">;

const SettingsSection = ({
  className,
  render,
  ...props
}: SettingsSectionProps) =>
  renderElement(
    "section",
    {
      "data-slot": "settings-section",
      className: cn("flex w-full flex-col gap-3", className),
      ...props,
    },
    render
  );

export type SettingsSectionHeaderProps = LayoutProps<"div">;

const SettingsSectionHeader = ({
  className,
  render,
  ...props
}: SettingsSectionHeaderProps) =>
  renderElement(
    "div",
    {
      "data-slot": "settings-section-header",
      className: cn("flex flex-col gap-1", className),
      ...props,
    },
    render
  );

export type SettingsSectionTitleProps = LayoutProps<"h2">;

const SettingsSectionTitle = ({
  className,
  render,
  ...props
}: SettingsSectionTitleProps) =>
  renderElement(
    "h2",
    {
      "data-slot": "settings-section-title",
      className: cn("pl-5 text-lg font-semibold tracking-tight", className),
      ...props,
    },
    render
  );

export type SettingsSectionDescriptionProps = LayoutProps<"p">;

const SettingsSectionDescription = ({
  className,
  render,
  ...props
}: SettingsSectionDescriptionProps) =>
  renderElement(
    "p",
    {
      "data-slot": "settings-section-description",
      className: cn("text-muted-foreground max-w-2xl text-sm", className),
      ...props,
    },
    render
  );

export type SettingsRowsProps = LayoutProps<"div">;

const SettingsRows = ({ className, render, ...props }: SettingsRowsProps) =>
  renderElement(
    "div",
    {
      role: "list",
      "data-slot": "settings-rows",
      className: cn(
        "bg-background text-card-foreground flex w-full flex-col gap-px overflow-hidden rounded-lg",
        className
      ),
      ...props,
    },
    render
  );

const settingsRowVariants = cva(
  "flex min-h-20 w-full flex-col gap-3 bg-card px-4 py-4 outline-none transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:px-5",
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
  }
);

export type SettingsRowProps = LayoutProps<"div"> &
  VariantProps<typeof settingsRowVariants>;

const SettingsRow = ({
  className,
  variant = "default",
  render,
  ...props
}: SettingsRowProps) =>
  renderElement(
    "div",
    mergeProps(
      {
        "data-slot": "settings-row",
        "data-variant": variant,
        role: "listitem",
        className: cn(settingsRowVariants({ variant, className })),
      },
      props
    ),
    render
  );

export type SettingsRowContentProps = LayoutProps<"div">;

const SettingsRowContent = ({
  className,
  render,
  ...props
}: SettingsRowContentProps) =>
  renderElement(
    "div",
    {
      "data-slot": "settings-row-content",
      className: cn("flex min-w-0 flex-1 flex-col gap-1", className),
      ...props,
    },
    render
  );

export type SettingsRowTitleProps = LayoutProps<"div">;

const SettingsRowTitle = ({
  className,
  render,
  ...props
}: SettingsRowTitleProps) =>
  renderElement(
    "div",
    {
      "data-slot": "settings-row-title",
      className: cn("text-sm leading-snug font-medium", className),
      ...props,
    },
    render
  );

export type SettingsRowDescriptionProps = LayoutProps<"p">;

const SettingsRowDescription = ({
  className,
  render,
  ...props
}: SettingsRowDescriptionProps) =>
  renderElement(
    "p",
    {
      "data-slot": "settings-row-description",
      className: cn("text-muted-foreground text-sm leading-snug", className),
      ...props,
    },
    render
  );

export type SettingsRowActionsProps = LayoutProps<"div">;

const SettingsRowActions = ({
  className,
  render,
  ...props
}: SettingsRowActionsProps) =>
  renderElement(
    "div",
    {
      "data-slot": "settings-row-actions",
      className: cn("flex shrink-0 items-center gap-2 sm:ml-auto", className),
      ...props,
    },
    render
  );

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
