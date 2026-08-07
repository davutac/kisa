import "./assets/main.css";
import {
  createBrowserHistory,
  createHashHistory,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app";
import { isWebEnvironment } from "./platform/desktop";
import { getRouter } from "./router";

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
