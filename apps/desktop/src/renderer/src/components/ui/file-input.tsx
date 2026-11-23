import { FileInputTrigger as FileInputTriggerPrimitive } from "@ui-sdk/react/file-input";
import type { createFileInputController } from "@ui-sdk/react/file-input";

import { buttonVariants } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export {
  createFileInputController,
  FileInput,
  FileInputDropzone,
} from "@ui-sdk/react/file-input";

export type FileInputController = ReturnType<typeof createFileInputController>;

// Styled like a Button rather than rendered as one: the agent bridge would
// list a Kisa Button inside the trigger as a second control.
const FileInputTrigger = ({
  className,
  size = "default",
  variant = "ghost",
  ...props
}: Omit<React.ComponentProps<typeof FileInputTriggerPrimitive>, "className"> & {
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) => (
  <FileInputTriggerPrimitive
    className={cn(buttonVariants({ size, variant }), className)}
    {...props}
  />
);

export { FileInputTrigger };
