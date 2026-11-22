import { contextBridge, ipcRenderer } from "electron";

import type { AccountSetupBridge } from "../shared/ipc/account-setup";

// Keep this preload entry self-contained. Sharing a runtime module with the
// normal preload makes the bundler emit a relative CommonJS chunk, which a
// sandboxed Electron preload cannot require. A test keeps these in step
// with `shared/ipc/channels.ts`.
const ACCOUNT_SETUP_CLOSE_CHANNEL = "desktop:account-setup:close";
const ACCOUNT_SETUP_SUBMIT_CHANNEL = "desktop:account-setup:submit";

/**
 * The Add account window's whole capability: send the sign-in once, and
 * close. Nothing comes back but a success or a fixed error message.
 */
const accountSetup = {
  close: () => ipcRenderer.invoke(ACCOUNT_SETUP_CLOSE_CHANNEL),
  submit: (request) =>
    ipcRenderer.invoke(ACCOUNT_SETUP_SUBMIT_CHANNEL, request),
} satisfies AccountSetupBridge;

contextBridge.exposeInMainWorld("accountSetup", accountSetup);
