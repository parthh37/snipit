import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";

// Every window loads this page; the window label picks what it renders. Each kind is its own
// chunk, so a capture overlay never has to load the editor and the rest of the main window.
const label = getCurrentWindow().label;
const isOverlay = label.startsWith("overlay-");
const isWidget = label === "widget";
const isScrollStatus = label === "scroll-status";
if (isWidget || isScrollStatus) {
  document.documentElement.classList.add("transparent");
}

// The entry module is never hot-swapped, so fast refresh has nothing to lose here.
// eslint-disable-next-line react-refresh/only-export-components
const Root = lazy(() =>
  isOverlay
    ? import("./windows/overlay/Overlay")
    : isWidget
      ? import("./windows/widget/Widget")
      : isScrollStatus
        ? import("./windows/scroll/ScrollStatus")
        : import("./windows/main/MainWindow"),
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense>
      <Root />
    </Suspense>
  </React.StrictMode>,
);
