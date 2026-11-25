import { createContext, useContext } from "react";

import type { WorkspacePath } from "./shell-navigation";

/**
 * The shell's workspace toggle, for a page that closes itself, such as a new
 * email once it is sent, stashed, or discarded, so closing it returns to the
 * view it was opened over exactly as its sidebar button would.
 */
export const ShellWorkspaceContext = createContext<
  ((path: WorkspacePath) => void) | null
>(null);

export const useToggleWorkspace = (): ((path: WorkspacePath) => void) | null =>
  useContext(ShellWorkspaceContext);
