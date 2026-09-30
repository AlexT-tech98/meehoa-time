import React from "react";
import ReactDOM from "react-dom/client";
import Home from "./page";
import "./globals.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Home />
    </React.StrictMode>
  );
}
