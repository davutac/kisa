import "./assets/main.css";
import {
  createBrowserHistory,
  createHashHistory,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app";
import { validateHotkeyCommands } from "./hotkeys/commands";
import { isWebEnvironment } from "./platform/desktop";
import { getRouter } from "./router";

// No test covers the hotkey registry, so a binding that collides with another
// in a scope active beside it stops development here instead of shipping.
if (import.meta.env.DEV) {
  const hotkeyErrors = validateHotkeyCommands();

  if (hotkeyErrors.length > 0) {
    throw new Error(`Hotkey registry is invalid:\n${hotkeyErrors.join("\n")}`);
  }
}

const APP_FONT = '1rem "Geist Variable"';

const history = isWebEnvironment()
  ? createBrowserHistory()
  : createHashHistory();

const router = getRouter(history);

const rootElement = document.querySelector("#root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const renderApp = (): void => {
  createRoot(rootElement).render(
    <StrictMode>
      <App router={router} />
    </StrictMode>
  );
};

const startApp = async (): Promise<void> => {
  try {
    await document.fonts.load(APP_FONT);
  } finally {
    renderApp();
  }
};

void startApp();
