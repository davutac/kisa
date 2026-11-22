import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** The element in the content titlebar that the current view may fill. */
export const TitlebarSlotContext = createContext<HTMLElement | null>(null);

/**
 * Renders a view's own toolbar into the content titlebar, so the view needs
 * no row of its own under an otherwise empty titlebar. Outside the main
 * window's shell there is no slot and nothing renders.
 */
export const TitlebarSlot = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const target = useContext(TitlebarSlotContext);

  return target === null ? null : createPortal(children, target);
};
