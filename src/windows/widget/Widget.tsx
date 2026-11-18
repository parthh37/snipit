import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type ShortcutAction } from "../../lib/api";
import { annotateClipboard, startCapture } from "../../lib/capture";
import { acceleratorParts } from "../../settings/shortcutFormat";
import {
  WIDGET_COLLAPSED_EVENT,
  WIDGET_EDGE_EVENT,
  type WidgetEdge,
  widgetEdge,
  openSettings,
  quitApp,
  widgetCursorInside,
  widgetDragEnd,
  widgetDragMove,
  widgetDragStart,
  widgetSetLayout,
  type WidgetLayout,
} from "./widgetApi";

/** How long the pointer may wander off the open panel before it folds back up. */
const COLLAPSE_DELAY = 450;
/** Short pause before opening, so sweeping past the tab doesn't pop it open. */
const EXPAND_DELAY = 120;
/** How often the open panel checks the real cursor, in case it never heard it leave. */
const CURSOR_POLL = 150;
/** Where the chosen capture mode is remembered between launches. */
const MODE_KEY = "snipit.widget.mode";

interface Mode {
  id: ShortcutAction;
  label: string;
  title: string;
  icon: (size?: number) => ReactNode;
  run: () => Promise<void>;
}

const MODES: Mode[] = [
  {
    id: "captureRegion",
    label: "Region",
    title: "Pick a window or drag out a region",
    icon: (s) => <RegionIcon size={s} />,
    run: () => startCapture("interactive"),
  },
  {
    id: "captureFullscreen",
    label: "Full screen",
    title: "Capture the monitor under the cursor",
    icon: (s) => <ScreenIcon size={s} />,
    run: () => startCapture("fullscreen"),
  },
  {
    id: "captureScrolling",
    label: "Scrolling",
    title: "Capture a whole webpage or long window by scrolling it",
    icon: (s) => <ScrollIcon size={s} />,
    run: () => startCapture("scrolling"),
  },
  {
    id: "annotateClipboard",
    label: "From clipboard",
    title: "Annotate the image on the clipboard",
    icon: (s) => <ClipboardIcon size={s} />,
    run: annotateClipboard,
  },
];

function savedMode(): Mode {
  try {
    const id = localStorage.getItem(MODE_KEY);
    return MODES.find((m) => m.id === id) ?? MODES[0];
  } catch {
    return MODES[0];
  }
}

type Drawer = "modes" | "menu" | null;

/** Classes that differ by the screen edge the widget hangs from. */
const EDGE_STYLE: Record<WidgetEdge, { card: string; tab: string }> = {
  top: {
    card: "mx-1.5 mb-1.5 rounded-b-[20px] border-t-0",
    tab: "items-start justify-center rounded-b-xl border-t-0",
  },
  left: {
    card: "my-1.5 mr-1.5 rounded-r-[20px] border-l-0",
    tab: "items-center justify-start rounded-r-xl border-l-0",
  },
  right: {
    card: "my-1.5 ml-1.5 rounded-l-[20px] border-r-0",
    tab: "items-center justify-end rounded-l-xl border-r-0",
  },
};

/**
 * The floating capture widget: a tab hanging from the top, left or right edge of the screen
 * that drops open on hover into a round capture button, with a menu on its left, "open Snipit" on its right and
 * a drawer for choosing what the big button captures. The Rust side (`widget.rs`) sizes and
 * positions the window for each state and picks the edge.
 */
export default function Widget() {
  const [layout, setLayout] = useState<WidgetLayout>("collapsed");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [mode, setMode] = useState<Mode>(savedMode);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<WidgetEdge>("top");
  const [shortcuts, setShortcuts] = useState<
    Partial<Record<ShortcutAction, string>>
  >({});
  const timer = useRef<number>(undefined);
  const dragFrame = useRef<number | null>(null);
  const draggingRef = useRef(false);

  /** Resizes the window first when growing, so the new content is never clipped. */
  const show = useCallback(async (next: WidgetLayout, nextDrawer: Drawer) => {
    window.clearTimeout(timer.current);
    await widgetSetLayout(next);
    setLayout(next);
    setDrawer(nextDrawer);
  }, []);

  const collapse = useCallback(() => {
    window.clearTimeout(timer.current);
    setLayout("collapsed");
    setDrawer(null);
    void widgetSetLayout("collapsed");
  }, []);

  useEffect(() => {
    const off = listen(WIDGET_COLLAPSED_EVENT, () => {
      window.clearTimeout(timer.current);
      setLayout("collapsed");
      setDrawer(null);
    });
    return () => void off.then((f) => f());
  }, []);

  useEffect(() => {
    const off = listen<WidgetEdge>(WIDGET_EDGE_EVENT, (e) =>
      setEdge(e.payload),
    );
    widgetEdge()
      .then(setEdge)
      .catch(() => {});
    return () => void off.then((f) => f());
  }, []);

  // Refresh the shortcut hints whenever the panel opens; they can change in Settings.
  const open = layout !== "collapsed";
  useEffect(() => {
    if (!open) return;
    api
      .getSettings()
      .then((view) => setShortcuts(view.settings.shortcuts))
      .catch(() => {});
  }, [open]);

  // The window never takes focus, so it doesn't always hear the pointer leave: a drag that
  // snaps the panel onto a side edge can drop it away from the cursor, and the leave was
  // ignored mid-drag. So while open, also watch the real cursor and fold up once it has
  // been off the panel for the usual delay.
  useEffect(() => {
    if (!open || dragging) return;
    let outsideSince: number | null = null;
    let busy = false;
    const id = window.setInterval(() => {
      if (busy || draggingRef.current) return;
      busy = true;
      widgetCursorInside()
        .catch(() => true)
        .then((inside) => {
          if (inside) outsideSince = null;
          else if (outsideSince === null) outsideSince = Date.now();
          else if (Date.now() - outsideSince >= COLLAPSE_DELAY) collapse();
        })
        .finally(() => {
          busy = false;
        });
    }, CURSOR_POLL);
    return () => window.clearInterval(id);
  }, [open, dragging, collapse]);

  const onEnter = () => {
    window.clearTimeout(timer.current);
    if (!open)
      timer.current = window.setTimeout(() => show("open", null), EXPAND_DELAY);
  };

  const onLeave = () => {
    window.clearTimeout(timer.current);
    if (open && !draggingRef.current) {
      timer.current = window.setTimeout(collapse, COLLAPSE_DELAY);
    }
  };

  const toggleDrawer = (which: Exclude<Drawer, null>) => {
    if (drawer === which) void show("open", null);
    else void show("drawer", which);
  };

  const run = (m: Mode) => {
    // The window hides for the capture and comes back as the tab.
    window.clearTimeout(timer.current);
    setLayout("collapsed");
    setDrawer(null);
    m.run().catch(() => {});
  };

  const pick = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m.id);
    } catch {
      // Remembering the choice is a nicety; the capture still runs.
    }
    run(m);
  };

  const keysFor = (id: ShortcutAction) => {
    const accel = shortcuts[id];
    return accel ? acceleratorParts(accel).join("+") : null;
  };

  // Dragging the panel's background slides the widget along an edge, or onto another one.
  const onDragDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    void widgetDragStart();
  };

  const onDragMove = () => {
    if (!draggingRef.current || dragFrame.current !== null) return;
    // At most one move per frame; Rust reads the cursor itself, so nothing is lost.
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      void widgetDragMove();
    });
  };

  const onDragUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    void widgetDragEnd();
  };

  const mainKeys = keysFor(mode.id);
  const edgeStyle = EDGE_STYLE[edge];

  return (
    <div
      className="flex h-full w-full justify-center"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {open ? (
        <div
          onPointerDown={onDragDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragUp}
          onPointerCancel={onDragUp}
          data-edge={edge}
          className={`widget-card widget-drop flex w-full flex-col items-center border text-zinc-700 dark:text-zinc-200 ${edgeStyle.card} ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div className="mt-2.5 flex items-center gap-4">
            <RoundButton
              title="Menu"
              active={drawer === "menu"}
              onClick={() => toggleDrawer("menu")}
            >
              <MenuIcon />
            </RoundButton>

            <button
              type="button"
              title={mainKeys ? `${mode.title} (${mainKeys})` : mode.title}
              aria-label={`Capture: ${mode.label}`}
              onClick={() => run(mode)}
              className="widget-capture"
            >
              <span className="widget-capture-disc">{mode.icon(22)}</span>
            </button>

            <RoundButton
              title="Open Snipit"
              onClick={() => {
                collapse();
                void api.openMainWindow();
              }}
            >
              <AppIcon />
            </RoundButton>
          </div>

          <button
            type="button"
            title="Choose what the capture button does"
            onClick={() => toggleDrawer("modes")}
            className={`mt-1.5 flex h-6 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition hover:bg-zinc-500/12 ${
              drawer === "modes" ? "bg-zinc-500/12" : ""
            }`}
          >
            {mode.label}
            <ChevronIcon flipped={drawer === "modes"} />
          </button>

          {drawer && (
            <div className="widget-drawer mt-2 w-full border-t border-zinc-500/15 px-1.5 pt-1.5">
              {drawer === "modes"
                ? MODES.map((m) => (
                    <DrawerRow
                      key={m.id}
                      icon={m.icon(18)}
                      label={m.label}
                      title={m.title}
                      hint={keysFor(m.id)}
                      selected={m.id === mode.id}
                      onClick={() => pick(m)}
                    />
                  ))
                : [
                    <DrawerRow
                      key="settings"
                      icon={<GearIcon />}
                      label="Settings"
                      title="Shortcuts, startup and what happens after a capture"
                      onClick={() => {
                        collapse();
                        void openSettings();
                      }}
                    />,
                    <DrawerRow
                      key="hide"
                      icon={<HideIcon />}
                      label="Hide widget"
                      title="Turn it back on from the tray menu or Settings"
                      onClick={() => void api.setWidgetVisible(false)}
                    />,
                    <DrawerRow
                      key="quit"
                      icon={<PowerIcon />}
                      label="Quit Snipit"
                      title="Close Snipit and its shortcuts"
                      onClick={() => void quitApp()}
                    />,
                  ]}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          aria-label="Snipit capture widget"
          title="Snipit — hover to capture"
          onClick={() => void show("open", null)}
          data-edge={edge}
          className={`widget-tab flex h-full w-full cursor-pointer border ${edgeStyle.tab}`}
        >
          <span className="widget-tab-disc" />
        </button>
      )}
    </div>
  );
}

function RoundButton({
  title,
  active = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex size-[30px] cursor-pointer items-center justify-center rounded-full border border-zinc-500/20 text-zinc-500 transition hover:border-brand-500/50 hover:text-brand-600 dark:text-zinc-400 dark:hover:text-brand-500 ${
        active
          ? "border-brand-500/50 bg-brand-500/10 text-brand-600 dark:text-brand-500"
          : "bg-zinc-500/6"
      }`}
    >
      {children}
    </button>
  );
}

function DrawerRow({
  icon,
  label,
  title,
  hint = null,
  selected = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  hint?: string | null;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-[12px] font-medium transition hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-500 ${
        selected ? "text-brand-600 dark:text-brand-500" : ""
      }`}
    >
      <span className="flex w-5 justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span className="rounded border border-zinc-500/25 px-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          {hint}
        </span>
      )}
      {selected && <CheckIcon />}
    </button>
  );
}

function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function RegionIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M12 9v6M9 12h6" />
    </Svg>
  );
}

function ScreenIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </Svg>
  );
}

function ScrollIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 8h6M9 11h6M9 14h3" />
      <path d="M12 17.5l-1.5-1.5M12 17.5l1.5-1.5" />
    </Svg>
  );
}

function ClipboardIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M9 4h6v3H9z" />
      <path d="M9 5.5H6.5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H15" />
      <path d="M9 14l2 2 4-4" />
    </Svg>
  );
}

function MenuIcon() {
  return (
    <Svg>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </Svg>
  );
}

function AppIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </Svg>
  );
}

function GearIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

function HideIcon() {
  return (
    <Svg>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 5 9 7a8 8 0 0 1-2.2 3.3M6.6 6.6C4.3 8 3 10.6 3 12c0 2 4 7 9 7a9 9 0 0 0 4.4-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}

function PowerIcon() {
  return (
    <Svg>
      <path d="M12 3v8" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg size={14}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

function ChevronIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`opacity-70 transition-transform ${flipped ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
