import type { AccountSetupBridge } from "../shared/ipc/account-setup";

declare global {
  interface Window {
    accountSetup?: AccountSetupBridge;
  }
}
