import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "@/components/arc/foundation.css";
import "@/styles/theme.css";
import "@/styles/app.css";
import { App } from "./App";

// Asks the browser not to clear this app's data (meetings, settings) when storage runs low or it goes unused.
void navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
