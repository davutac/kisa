import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { useAppCommand } from "@/hotkeys";

const UNDO_DURATION_MS = 8000;

interface UndoAction {
  readonly description?: string;
  readonly message: string;
  readonly tone?: "error" | "success";
  readonly undo: () => Promise<void>;
  readonly undoneMessage: string;
}

type CommitUndo = (action: UndoAction) => void;
type PrepareUndo = () => CommitUndo;

interface ActiveUndo {
  readonly action: UndoAction;
  readonly order: number;
  readonly toastId: string | number;
}

const UndoContext = createContext<PrepareUndo | null>(null);

export const UndoProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const nextOrderRef = useRef(0);
  const committedOrderRef = useRef(0);
  const activeRef = useRef<ActiveUndo | null>(null);
  const [hasActiveUndo, setHasActiveUndo] = useState(false);

  const clear = useCallback((order: number): void => {
    if (activeRef.current?.order !== order) {
      return;
    }

    activeRef.current = null;
    setHasActiveUndo(false);
  }, []);

  const runUndo = useCallback(async (order?: number): Promise<void> => {
    const active = activeRef.current;

    if (active === null || (order !== undefined && active.order !== order)) {
      return;
    }

    activeRef.current = null;
    setHasActiveUndo(false);
    toast.dismiss(active.toastId);

    try {
      await active.action.undo();
      toast.success(active.action.undoneMessage);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not undo the action"
      );
    }
  }, []);

  useAppCommand(
    "app.undo",
    () => {
      void runUndo();
    },
    { enabled: hasActiveUndo }
  );

  const prepareUndo = useCallback<PrepareUndo>(() => {
    nextOrderRef.current += 1;
    const order = nextOrderRef.current;

    return (action) => {
      // A slower request must not replace a newer completed action.
      if (order < committedOrderRef.current) {
        return;
      }

      committedOrderRef.current = order;

      if (activeRef.current !== null) {
        toast.dismiss(activeRef.current.toastId);
      }

      const showToast = action.tone === "error" ? toast.error : toast.success;
      const toastId = showToast(action.message, {
        action: {
          label: "Undo",
          onClick: () => {
            void runUndo(order);
          },
        },
        description: action.description,
        duration: UNDO_DURATION_MS,
        onAutoClose: () => clear(order),
        onDismiss: () => clear(order),
      });

      activeRef.current = { action, order, toastId };
      setHasActiveUndo(true);
    };
  }, [clear, runUndo]);

  return <UndoContext value={prepareUndo}>{children}</UndoContext>;
};

export const usePrepareUndo = (): PrepareUndo => {
  const prepareUndo = useContext(UndoContext);

  if (prepareUndo === null) {
    throw new Error("usePrepareUndo must be used within UndoProvider");
  }

  return prepareUndo;
};
