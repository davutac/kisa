import {
  PasswordInput as PasswordInputPrimitive,
  PasswordInputControl as PasswordInputControlPrimitive,
} from "@ui-sdk/react/password-input";

import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PasswordInput = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof PasswordInputPrimitive>, "className"> & {
  className?: string;
}) => (
  <PasswordInputPrimitive
    className={cn("relative flex w-full min-w-0 items-center", className)}
    {...props}
  />
);

const PasswordInputControl = ({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof PasswordInputControlPrimitive>,
  "className"
> & {
  className?: string;
}) => (
  <PasswordInputControlPrimitive
    className={cn(inputClassName, className)}
    {...props}
  />
);

export { PasswordInput, PasswordInputControl };
