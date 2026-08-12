import { CopyIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface ConfirmRequest {
  focusTarget: HTMLElement | null;
  id: number;
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmDialogViewProps {
  onCancel: () => void;
  onConfirm: () => void;
  options: ConfirmOptions;
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

const ConfirmDialogView = ({
  onCancel,
  onConfirm,
  options,
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
  const [inputValue, setInputValue] = useState("");
  const isConfirmed =
    confirmationText === undefined || inputValue === confirmationText.value;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== "Enter" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      !isConfirmed
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onConfirm();
  };

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
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
    >
      <AlertDialogContent onKeyDown={handleKeyDown}>
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
                <span className="min-w-0 truncate">
                  {confirmationText.value}
                </span>
                <CopyIcon className="size-2.5 shrink-0 opacity-80" />
              </Button>
            </div>
            <Input
              aria-describedby={inputDescriptionId}
              autoComplete="off"
              id={inputId}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={confirmationText.value}
              value={inputValue}
            />
          </div>
        ) : null}

        <AlertDialogFooter className="-mx-4 -mb-4 gap-px overflow-hidden rounded-b-lg">
          <AlertDialogCancel size="footer">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!isConfirmed}
            onClick={onConfirm}
            size="footer"
            type="button"
            variant={confirmVariant ?? "default"}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export const ConfirmDialogProvider = ({
  children,
}: ConfirmDialogProviderProps) => {
  const [activeRequest, setActiveRequest] = useState<ConfirmRequest | null>(
    null
  );
  const activeRequestRef = useRef<ConfirmRequest | null>(null);
  const queuedRequestsRef = useRef<ConfirmRequest[]>([]);
  const nextRequestIdRef = useRef(0);
  useHotkeyLayer("blocking", activeRequest !== null);

  const confirm = useCallback<Confirm>(
    (options) =>
      // oxlint-disable-next-line promise/avoid-new -- The imperative confirm interface exposes the dialog result to its caller.
      new Promise<boolean>((resolve) => {
        nextRequestIdRef.current += 1;

        const request: ConfirmRequest = {
          focusTarget:
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
          id: nextRequestIdRef.current,
          options,
          resolve,
        };

        if (activeRequestRef.current) {
          queuedRequestsRef.current.push(request);
          return;
        }

        activeRequestRef.current = request;
        setActiveRequest(request);
      }),
    []
  );

  const settleActiveRequest = useCallback((confirmed: boolean) => {
    const settledRequest = activeRequestRef.current;

    if (!settledRequest) {
      return;
    }

    const nextRequest = queuedRequestsRef.current.shift() ?? null;
    activeRequestRef.current = nextRequest;
    setActiveRequest(nextRequest);
    settledRequest.resolve(confirmed);

    if (!nextRequest) {
      requestAnimationFrame(() => {
        if (settledRequest.focusTarget?.isConnected) {
          settledRequest.focusTarget.focus();
        }
      });
    }
  }, []);

  useEffect(
    () => () => {
      const pendingRequests = [
        activeRequestRef.current,
        ...queuedRequestsRef.current,
      ];

      activeRequestRef.current = null;
      queuedRequestsRef.current = [];

      for (const request of pendingRequests) {
        request?.resolve(false);
      }
    },
    []
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {activeRequest ? (
        <ConfirmDialogView
          key={activeRequest.id}
          onCancel={() => settleActiveRequest(false)}
          onConfirm={() => settleActiveRequest(true)}
          options={activeRequest.options}
        />
      ) : null}
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
