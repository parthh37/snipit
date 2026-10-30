import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainWindow from "./windows/main/MainWindow";
import Overlay from "./windows/overlay/Overlay";
import "./index.css";

// Every window loads this page; the window label picks what it renders.
const isOverlay = getCurrentWindow().label.startsWith("overlay-");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <Overlay /> : <MainWindow />}
  </React.StrictMode>,
);
