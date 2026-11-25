import { CopyIcon } from "lucide-react";
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  createConfirm,
} from "@/components/ui/alert-dialog";
import type { AlertDialogController } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useHotkeyLayer } from "@/hotkeys";

export interface ConfirmationTextOptions {
  label?: ReactNode;
  value: string;
}

export interface ConfirmOptions {
  cancelLabel?: ReactNode;
  confirmLabel?: ReactNode;
  confirmationText?: ConfirmationTextOptions;
  confirmVariant?: ComponentProps<typeof Button>["variant"];
  description?: ReactNode;
  title: ReactNode;
}

interface ConfirmMessageProps {
  children: ReactNode;
  subject: ReactNode;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

// A fresh object per question, so a caller reusing one options object still
// gets a new payload and an empty confirmation field.
interface ConfirmRequest {
  readonly options: ConfirmOptions;
}

interface ConfirmDialogViewProps {
  inputValue: string;
  onConfirm: () => void;
  options: ConfirmOptions;
  setInputValue: (value: string) => void;
}

interface ConfirmDialogProps {
  controller: AlertDialogController<ConfirmRequest>;
}

interface ConfirmDialogProviderProps {
  children: ReactNode;
}

const ConfirmContext = createContext<Confirm | null>(null);

export const ConfirmMessage = ({ children, subject }: ConfirmMessageProps) => (
  <span className="grid gap-2">
    <span className="text-foreground font-medium">{subject}</span>
    <span>{children}</span>
  </span>
);

const isConfirmationEntered = (
  options: ConfirmOptions,
  inputValue: string
): boolean =>
  options.confirmationText === undefined ||
  inputValue === options.confirmationText.value;

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || node === true || node === false) {
    return "";
  }

  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }

  if (!isValidElement<Partial<ConfirmMessageProps>>(node)) {
    return String(node);
  }

  const { children, subject } = node.props;

  return subject === undefined
    ? textOf(children)
    : `${textOf(subject)}: ${textOf(children)}`;
};

const describeConfirmation = (options: ConfirmOptions): string =>
  [options.title, options.description]
    .map(textOf)
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim() || textOf(options.confirmLabel ?? "Confirm");

// Focus starts where Return is safe: the typed confirmation, Cancel before
// a destructive action, or the confirming button.
const getInitialFocus = (
  options: ConfirmOptions
): "cancel" | "confirm" | "text" => {
  if (options.confirmationText !== undefined) {
    return "text";
  }

  return options.confirmVariant === "destructive" ? "cancel" : "confirm";
};

const ConfirmDialogView = ({
  inputValue,
  onConfirm,
  options,
  setInputValue,
}: ConfirmDialogViewProps) => {
  const {
    cancelLabel = "Cancel",
    confirmLabel = "Confirm",
    confirmationText,
    confirmVariant = "default",
    description,
    title,
  } = options;

  const inputId = useId();
  const inputDescriptionId = useId();
  const isConfirmed = isConfirmationEntered(options, inputValue);
  const initialFocus = getInitialFocus(options);

  const handleCopyConfirmationText = async (): Promise<void> => {
    if (!confirmationText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(confirmationText.value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy confirmation text");
    }
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description === undefined ? null : (
          <AlertDialogDescription>{description}</AlertDialogDescription>
        )}
      </AlertDialogHeader>

      {confirmationText ? (
        <div className="grid gap-2">
          <Label className="sr-only" htmlFor={inputId}>
            {confirmationText.label ?? "Enter the confirmation text"}
          </Label>
          <div
            className="grid gap-1.5 text-sm leading-relaxed"
            id={inputDescriptionId}
          >
            <span>Enter this text to confirm:</span>
            <Button
              aria-label={`Copy ${confirmationText.value}`}
              className="max-w-full min-w-0 justify-self-start overflow-hidden"
              onClick={() => {
                void handleCopyConfirmationText();
              }}
              size="xs"
              title="Copy confirmation text"
              type="button"
              variant="outline"
            >
              <span className="min-w-0 truncate">{confirmationText.value}</span>
              <CopyIcon className="size-2.5 shrink-0 opacity-80" />
            </Button>
          </div>
          <Input
            aria-describedby={inputDescriptionId}
            autoComplete="off"
            data-confirm-focus={initialFocus === "text" ? "" : undefined}
            id={inputId}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                isConfirmed
              ) {
                event.preventDefault();
                onConfirm();
              }
            }}
            placeholder={confirmationText.value}
            value={inputValue}
          />
        </div>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogClose
          data-confirm-focus={initialFocus === "cancel" ? "" : undefined}
        >
          {cancelLabel}
        </AlertDialogClose>
        <AlertDialogClose
          data-agent-confirm={describeConfirmation(options)}
          data-confirm-focus={initialFocus === "confirm" ? "" : undefined}
          disabled={!isConfirmed}
          value="confirm"
          variant={confirmVariant}
        >
          {confirmLabel}
        </AlertDialogClose>
      </AlertDialogFooter>
    </>
  );
};

const ConfirmDialog = ({ controller }: ConfirmDialogProps) => {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  useHotkeyLayer("blocking", isOpen);

  const confirm = (): void => {
    controller.close({ returnValue: "confirm" });
  };

  return (
    <AlertDialog
      controller={controller}
      onOpenChange={setIsOpen}
      onPayloadChange={() => setInputValue("")}
    >
      <AlertDialogContent<ConfirmRequest> initialFocus="[data-confirm-focus]">
        {({ payload }) =>
          payload === undefined ? null : (
            <ConfirmDialogView
              inputValue={inputValue}
              onConfirm={confirm}
              options={payload.options}
              setInputValue={setInputValue}
            />
          )
        }
      </AlertDialogContent>
    </AlertDialog>
  );
};

export const ConfirmDialogProvider = ({
  children,
}: ConfirmDialogProviderProps) => {
  const ask = useInstanceValue(() => createConfirm<ConfirmRequest>());
  const confirm = useCallback<Confirm>((options) => ask({ options }), [ask]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog controller={ask.controller} />
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): Confirm => {
  const confirm = useContext(ConfirmContext);

  if (!confirm) {
    throw new Error("useConfirm must be used within ConfirmDialogProvider");
  }

  return confirm;
};
