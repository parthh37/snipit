import { invoke } from "@tauri-apps/api/core";

/** The window was put back to the collapsed tab (e.g. after a capture). */
export const WIDGET_COLLAPSED_EVENT = "widget:collapsed";
/** The widget was docked to another screen edge; payload `WidgetEdge`. */
export const WIDGET_EDGE_EVENT = "widget:edge";

/** The screen edge the widget hangs from. */
export type WidgetEdge = "top" | "left" | "right";

/** The edge the widget is docked to now. */
export const widgetEdge = () => invoke<WidgetEdge>("widget_edge");

/** How much of the widget shows; mirrors `WidgetLayout` in `widget.rs`. */
export type WidgetLayout = "collapsed" | "open" | "drawer";

/** Resizes the widget window for the tab, the open panel, or the panel with its drawer. */
export const widgetSetLayout = (layout: WidgetLayout) =>
  invoke<void>("widget_set_layout", { layout });

/**
 * Dragging slides the widget along an edge and snaps it to the nearest top, left or right
 * edge of the monitor under the cursor; Rust follows the real cursor.
 */
export const widgetDragStart = () => invoke<void>("widget_drag_start");
export const widgetDragMove = () => invoke<void>("widget_drag_move");
export const widgetDragEnd = () => invoke<void>("widget_drag_end");

/** Whether the real cursor is over the widget window (`true` when Rust can't tell). */
export const widgetCursorInside = () => invoke<boolean>("widget_cursor_inside");

export const openSettings = () => invoke<void>("open_settings");
export const quitApp = () => invoke<void>("quit_app");
