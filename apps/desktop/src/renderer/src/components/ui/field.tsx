import {
  Field as FieldPrimitive,
  FieldDescription as FieldDescriptionPrimitive,
  FieldError as FieldErrorPrimitive,
  FieldGroup as FieldGroupPrimitive,
  FieldLabel as FieldLabelPrimitive,
  FieldLegend as FieldLegendPrimitive,
  FieldSet as FieldSetPrimitive,
} from "@ui-sdk/react/field";
import { mergeProps, renderElement } from "@ui-sdk/react/primitive";
import type { PartProps } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { labelClassName } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const FieldSet = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldSetPrimitive>>) => (
  <FieldSetPrimitive
    className={cn(
      "flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
      className
    )}
    {...props}
  />
);

const FieldLegend = ({
  className,
  variant = "legend",
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldLegendPrimitive>> & {
  variant?: "legend" | "label";
}) => (
  <FieldLegendPrimitive
    data-variant={variant}
    className={cn(
      "mb-2 font-medium data-[variant=label]:text-xs/relaxed data-[variant=legend]:text-sm",
      className
    )}
    {...props}
  />
);

const FieldGroup = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldGroupPrimitive>>) => (
  <FieldGroupPrimitive
    className={cn(
      "group/field-group @container/field-group flex w-full flex-col gap-4 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
      className
    )}
    {...props}
  />
);

const fieldVariants = cva(
  "group/field flex w-full gap-2 data-invalid:text-destructive",
  {
    variants: {
      orientation: {
        // Popups render in place inside the field, and must keep their own width.
        vertical: "flex-col *:not-[[popover]]:w-full [&>.sr-only]:w-auto",
        horizontal:
          "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "flex-col *:not-[[popover]]:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
);

const Field = ({
  className,
  orientation = "vertical",
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldPrimitive>> &
  VariantProps<typeof fieldVariants>) => (
  <FieldPrimitive
    data-orientation={orientation}
    className={cn(fieldVariants({ orientation }), className)}
    {...props}
  />
);

const FieldContent = ({
  className,
  render,
  ...props
}: ClassNameProps<PartProps<"div">>) =>
  renderElement(
    "div",
    mergeProps(
      {
        className: cn(
          "group/field-content flex flex-1 flex-col gap-0.5 leading-snug",
          className
        ),
        "data-slot": "field-content",
      },
      props
    ),
    render
  );

const FieldLabel = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldLabelPrimitive>>) => (
  <FieldLabelPrimitive
    className={cn(
      labelClassName,
      "group/field-label peer/field-label has-data-checked:bg-primary/5 has-[>[data-slot=field]]:bg-input/20 dark:has-data-checked:bg-primary/10 dark:has-[>[data-slot=field]]:bg-input/30 flex w-fit gap-2 leading-snug has-[>[data-slot=field]]:rounded-md data-disabled:opacity-50 *:data-[slot=field]:p-2",
      "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
      className
    )}
    {...props}
  />
);

const FieldTitle = ({
  className,
  render,
  ...props
}: ClassNameProps<PartProps<"div">>) =>
  renderElement(
    "div",
    mergeProps(
      {
        className: cn(
          "flex w-fit items-center gap-2 text-xs/relaxed font-medium group-data-disabled/field:opacity-50",
          className
        ),
        "data-slot": "field-label",
      },
      props
    ),
    render
  );

const FieldDescription = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldDescriptionPrimitive>>) => (
  <FieldDescriptionPrimitive
    className={cn(
      "text-muted-foreground text-left text-xs/relaxed leading-normal font-normal group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
      "last:mt-0 nth-last-2:-mt-1",
      "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
      className
    )}
    {...props}
  />
);

const FieldSeparator = ({
  children,
  className,
  render,
  ...props
}: ClassNameProps<Omit<PartProps<"div">, "children">> & {
  children?: React.ReactNode;
}) =>
  renderElement(
    "div",
    mergeProps(
      {
        children: (
          <>
            <Separator className="absolute inset-0 top-1/2" />
            {children && (
              <span
                className="bg-background text-muted-foreground relative mx-auto block w-fit px-2"
                data-slot="field-separator-content"
              >
                {children}
              </span>
            )}
          </>
        ),
        className: cn(
          "relative -my-2 h-5 text-xs/relaxed group-data-[variant=outline]/field-group:-mb-2",
          className
        ),
        "data-content": Boolean(children),
        "data-slot": "field-separator",
      },
      props
    ),
    render
  );

const FieldError = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof FieldErrorPrimitive>>) => (
  <FieldErrorPrimitive
    className={cn("text-destructive text-xs/relaxed font-normal", className)}
    {...props}
  />
);

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
};
