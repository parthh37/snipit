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
  widgetDragEnd,
  widgetDragMove,
  widgetDragStart,
  widgetEdge,
  widgetSetExpanded,
} from "./widgetApi";

/** How long the pointer may wander off the open panel before it folds back up. */
const COLLAPSE_DELAY = 450;
/** Short pause before opening, so sweeping past the tab doesn't pop it open. */
const EXPAND_DELAY = 120;

const ACTIONS: {
  label: string;
  title: string;
  shortcut: ShortcutAction;
  icon: ReactNode;
  run: () => Promise<void>;
}[] = [
  {
    label: "Region",
    title: "Capture a region or window",
    shortcut: "captureRegion",
    icon: <RegionIcon />,
    run: () => startCapture("interactive"),
  },
  {
    label: "Full screen",
    title: "Capture the monitor under the cursor",
    shortcut: "captureFullscreen",
    icon: <ScreenIcon />,
    run: () => startCapture("fullscreen"),
  },
  {
    label: "Scrolling",
    title: "Capture a whole webpage or long window by scrolling it",
    shortcut: "captureScrolling",
    icon: <ScrollIcon />,
    run: () => startCapture("scrolling"),
  },
  {
    label: "Clipboard",
    title: "Annotate the image on the clipboard",
    shortcut: "annotateClipboard",
    icon: <ClipboardIcon />,
    run: annotateClipboard,
  },
];

/** Classes that differ by the edge the widget hangs from: a row on top, a column on a side. */
const EDGE_STYLE: Record<
  WidgetEdge,
  { panel: string; tab: string; chevron: string; vertical: boolean }
> = {
  top: {
    panel: "flex-row rounded-b-2xl border-t-0 px-1.5 pt-1 pb-1.5",
    tab: "flex-row rounded-b-xl",
    chevron: "",
    vertical: false,
  },
  left: {
    panel: "flex-col rounded-r-2xl border-l-0 py-1.5 pr-1.5 pl-1",
    tab: "flex-col rounded-r-xl",
    chevron: "-rotate-90",
    vertical: true,
  },
  right: {
    panel: "flex-col rounded-l-2xl border-r-0 py-1.5 pr-1 pl-1.5",
    tab: "flex-col rounded-l-xl",
    chevron: "rotate-90",
    vertical: true,
  },
};

/**
 * The floating capture widget: a tab hanging from the top, left or right edge of the screen
 * that opens into a small capture toolbar on hover. The Rust side (`widget.rs`) sizes and
 * positions the window and picks the edge.
 */
export default function Widget() {
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<WidgetEdge>("top");
  const [shortcuts, setShortcuts] = useState<
    Partial<Record<ShortcutAction, string>>
  >({});
  const timer = useRef<number>(undefined);
  const dragFrame = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const expand = useCallback(async () => {
    window.clearTimeout(timer.current);
    // Grow the window before drawing the panel so it is never clipped.
    await widgetSetExpanded(true);
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    window.clearTimeout(timer.current);
    setExpanded(false);
    void widgetSetExpanded(false);
  }, []);

  useEffect(() => {
    const off = listen(WIDGET_COLLAPSED_EVENT, () => {
      window.clearTimeout(timer.current);
      setExpanded(false);
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
  useEffect(() => {
    if (!expanded) return;
    api
      .getSettings()
      .then((view) => setShortcuts(view.settings.shortcuts))
      .catch(() => {});
  }, [expanded]);

  const onEnter = () => {
    window.clearTimeout(timer.current);
    if (!expanded) timer.current = window.setTimeout(expand, EXPAND_DELAY);
  };

  const onLeave = () => {
    window.clearTimeout(timer.current);
    if (expanded && !draggingRef.current) {
      timer.current = window.setTimeout(collapse, COLLAPSE_DELAY);
    }
  };

  const run = (action: () => Promise<void>) => {
    // The window hides for the capture and comes back as the tab.
    window.clearTimeout(timer.current);
    setExpanded(false);
    action().catch(() => {});
  };

  const onGripDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    void widgetDragStart();
  };

  const onGripMove = () => {
    if (!draggingRef.current || dragFrame.current !== null) return;
    // At most one move per frame; Rust reads the cursor itself, so nothing is lost.
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      void widgetDragMove();
    });
  };

  const onGripUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    void widgetDragEnd();
  };

  const style = EDGE_STYLE[edge];

  // The panel keeps the same element tree on every edge, so the grip keeps its pointer
  // capture when a drag moves the widget from the top to a side or back.
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {expanded ? (
        <div
          data-edge={edge}
          className={`widget-panel flex h-full w-full items-stretch gap-1 border text-zinc-700 dark:text-zinc-200 ${style.panel}`}
        >
          <div
            role="separator"
            aria-label="Drag to move along the edge of the screen, or to another edge"
            title="Drag to move (along this edge, or to the top, left or right)"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            className={`flex shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-500/10 dark:text-zinc-500 ${
              style.vertical ? "h-4" : "w-4"
            } ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          >
            <GripIcon className={style.vertical ? "rotate-90" : undefined} />
          </div>

          {ACTIONS.map((action) => {
            const accel = shortcuts[action.shortcut];
            const keys = accel ? acceleratorParts(accel).join("+") : null;
            return (
              <button
                key={action.label}
                type="button"
                title={keys ? `${action.title} (${keys})` : action.title}
                onClick={() => run(action.run)}
                className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition hover:bg-brand-500/12 hover:text-brand-600 active:bg-brand-500/20 dark:hover:text-brand-500"
              >
                {action.icon}
                {action.label}
              </button>
            );
          })}

          <div
            className={`shrink-0 bg-zinc-500/20 ${style.vertical ? "mx-2 h-px" : "my-2 w-px"}`}
          />

          <div
            className={`flex shrink-0 justify-center gap-1 ${
              style.vertical ? "h-8 flex-row" : "w-8 flex-col"
            }`}
          >
            <SmallButton
              title="Open Snipit"
              onClick={() => {
                collapse();
                void api.openMainWindow();
              }}
            >
              <AppIcon />
            </SmallButton>
            <SmallButton
              title="Hide the capture widget (turn it back on from the tray menu or Settings)"
              onClick={() => void api.setWidgetVisible(false)}
            >
              <CloseIcon />
            </SmallButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Snipit capture widget"
          title="Snipit — hover to capture"
          onClick={() => void expand()}
          className={`widget-tab flex h-full w-full items-center justify-center gap-1 text-white ${style.tab}`}
        >
          <LogoIcon />
          <ChevronIcon className={style.chevron} />
        </button>
      )}
    </div>
  );
}

function SmallButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 min-w-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-500/15 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

function Svg({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function RegionIcon() {
  return (
    <Svg>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M12 9v6M9 12h6" />
    </Svg>
  );
}

function ScreenIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </Svg>
  );
}

function ScrollIcon() {
  return (
    <Svg>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 8h6M9 11h6M9 14h3" />
      <path d="M12 17.5l-1.5-1.5M12 17.5l1.5-1.5" />
    </Svg>
  );
}

function ClipboardIcon() {
  return (
    <Svg>
      <path d="M9 4h6v3H9z" />
      <path d="M9 5.5H6.5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H15" />
      <path d="M9 14l2 2 4-4" />
    </Svg>
  );
}

function AppIcon() {
  return (
    <Svg size={16}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </Svg>
  );
}

function CloseIcon() {
  return (
    <Svg size={16}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 6 16"
      width={6}
      height={16}
      aria-hidden
      className={className}
    >
      {[2, 6, 10, 14].flatMap((y) =>
        [1, 5].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1} fill="currentColor" />
        )),
      )}
    </svg>
  );
}

/** The app mark: corner brackets around a dot. */
function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`opacity-80 ${className}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
