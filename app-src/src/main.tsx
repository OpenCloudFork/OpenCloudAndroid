import "../platform/openNowPlatform";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

window.onerror = (message, source, lineno, colno, error) => {
  console.error(
    `[GlobalError] ${String(message)} at ${source ?? "?"}:${lineno ?? 0}:${colno ?? 0}`,
    error,
  );
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`[UnhandledRejection] ${msg}`, reason);
});

console.log(
  "[OpenCloud] WebView debugging enabled — connect via chrome://inspect/#devices",
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
