import { invoke } from "@tauri-apps/api/core";

/** The window was put back to the collapsed tab (e.g. after a capture). */
export const WIDGET_COLLAPSED_EVENT = "widget:collapsed";

/** Resizes the widget window between the tab and the open panel. */
export const widgetSetExpanded = (expanded: boolean) =>
  invoke<void>("widget_set_expanded", { expanded });

/** Dragging slides the widget along the top edge; Rust follows the real cursor. */
export const widgetDragStart = () => invoke<void>("widget_drag_start");
export const widgetDragMove = () => invoke<void>("widget_drag_move");
export const widgetDragEnd = () => invoke<void>("widget_drag_end");
