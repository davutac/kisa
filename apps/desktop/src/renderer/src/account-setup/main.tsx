import "../assets/main.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import AnimationsProvider from "../components/animations-provider";
import { ThemeProvider } from "../components/shell/theme-provider";
import AccountSetupApp from "./account-setup-app";

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <AnimationsProvider>
        <AccountSetupApp />
      </AnimationsProvider>
    </ThemeProvider>
  </StrictMode>
);
