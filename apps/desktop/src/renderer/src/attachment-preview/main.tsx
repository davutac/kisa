import "../assets/main.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import AttachmentPreviewApp from "./attachment-preview-app";

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AttachmentPreviewApp />
  </StrictMode>
);
