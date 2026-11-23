import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { toast } from "@/components/ui/toast";
import { useAppCommand } from "@/hotkeys";

const UNDO_DURATION_MS = 8000;

/** What the server made of an action whose Undo is already on offer. */
export type UndoOutcome =
  | { readonly kind: "confirmed" }
  /** Some of it went through; Undo reverses that part. */
  | {
      readonly description: string;
      readonly kind: "partial";
      readonly message: string;
    }
  /** Nothing went through, so there is nothing to undo. */
  | {
      readonly description?: string;
      readonly kind: "failed";
      readonly message: string;
    };

export interface UndoOffer {
  readonly message: string;
  readonly outcome: Promise<UndoOutcome>;
  /** Waits for `outcome` itself, so it only reverses what went through. */
  readonly undo: () => Promise<void>;
  readonly undoneMessage: string;
}

type OfferUndo = (offer: UndoOffer) => void;

interface ActiveUndo {
  readonly offer: UndoOffer;
  readonly order: number;
  readonly toastId: string;
}

const UndoContext = createContext<OfferUndo | null>(null);

/**
 * One level of Undo for actions that are shown as done before the server
 * answers. The offer appears with the action; its outcome then amends the
 * toast, or withdraws the offer when nothing went through.
 */
export const UndoProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const nextOrderRef = useRef(0);
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
    // The inverse shows at once too; only its failure is worth a second word.
    const toastId = toast.success(active.offer.undoneMessage);

    try {
      await active.offer.undo();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not undo the action",
        { id: toastId }
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

  const offerUndo = useCallback<OfferUndo>(
    (offer) => {
      nextOrderRef.current += 1;
      const order = nextOrderRef.current;

      if (activeRef.current !== null) {
        toast.dismiss(activeRef.current.toastId);
      }

      const undoAction = {
        label: "Undo",
        onAction: () => {
          void runUndo(order);
        },
      };
      const toastId = toast.success(offer.message, {
        action: undoAction,
        duration: UNDO_DURATION_MS,
        onDismiss: () => clear(order),
      });

      activeRef.current = { offer, order, toastId };
      setHasActiveUndo(true);

      const amend = async (): Promise<void> => {
        const outcome = await offer.outcome;

        if (outcome.kind === "confirmed") {
          return;
        }

        const isOnOffer = activeRef.current?.order === order;

        if (outcome.kind === "failed" && isOnOffer) {
          clear(order);
        }

        const keepsUndo = outcome.kind === "partial" && isOnOffer;

        // Amends the toast in place while it is still on offer. An update keeps
        // an omitted action and falls back to the default duration.
        toast.error(outcome.message, {
          action: keepsUndo ? undoAction : undefined,
          description: outcome.description,
          duration: keepsUndo ? UNDO_DURATION_MS : undefined,
          id: isOnOffer ? toastId : undefined,
        });
      };

      void amend();
    },
    [clear, runUndo]
  );

  return <UndoContext value={offerUndo}>{children}</UndoContext>;
};

export const useOfferUndo = (): OfferUndo => {
  const offerUndo = useContext(UndoContext);

  if (offerUndo === null) {
    throw new Error("useOfferUndo must be used within UndoProvider");
  }

  return offerUndo;
};
