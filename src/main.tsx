import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Overlay from "./overlay/Overlay";
import "./index.css";

// The capture overlay is a second window loading the same page.
const isOverlay = getCurrentWindow().label === "overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
