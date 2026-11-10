import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainWindow from "./windows/main/MainWindow";
import Overlay from "./windows/overlay/Overlay";
import Widget from "./windows/widget/Widget";
import "./index.css";

// Every window loads this page; the window label picks what it renders.
const label = getCurrentWindow().label;
const isOverlay = label.startsWith("overlay-");
const isWidget = label === "widget";
if (isWidget) document.documentElement.classList.add("transparent");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <Overlay /> : isWidget ? <Widget /> : <MainWindow />}
  </React.StrictMode>,
);
