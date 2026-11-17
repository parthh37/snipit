/* eslint-disable react-refresh/only-export-components -- shares the editor helpers and constants that go with these components */
/** Small form controls for the side panel, modelled on Snagit's tool properties. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, EyedropperIcon } from "./icons";
import type { Cap, Dash, ShadowDir } from "./types";
import { dashArray } from "./geometry";

/** A floating menu anchored under `anchor`; closes on outside click or Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  align = "left",
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 200;
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(6, Math.min(window.innerWidth - w - 6, left));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 6) top = Math.max(6, r.top - h - 4);
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (
        ref.current?.contains(e.target as Node) ||
        anchor.contains(e.target as Node)
      )
        return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 rounded-md border border-zinc-300 bg-white p-1 text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      style={pos}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A button that opens a popover menu. */
export function MenuButton({
  label,
  title,
  className = "",
  children,
  align,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={`flex items-center justify-between gap-1 rounded border border-zinc-300 bg-white px-1.5 text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 ${className}`}
      >
        {label}
        <ChevronDown />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align={align}>
          {children(() => setAnchor(null))}
        </Popover>
      )}
    </>
  );
}

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  title,
  className = "h-6",
  renderValue,
  columns = 1,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  title?: string;
  className?: string;
  renderValue?: (v: T) => ReactNode;
  columns?: number;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <MenuButton
      title={title}
      className={className}
      label={
        <span className="flex min-w-0 flex-1 items-center truncate text-xs">
          {renderValue ? renderValue(value) : (current?.label ?? String(value))}
        </span>
      }
    >
      {(close) => (
        <div
          className="grid max-h-80 gap-0.5 overflow-auto"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              title={o.title}
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={`flex items-center rounded px-2 py-1 text-left text-xs ${
                o.value === value
                  ? "bg-brand-500/15 text-brand-600 dark:text-brand-500"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

const PALETTE = [
  ["#000000", "#3f3f46", "#71717a", "#a1a1aa", "#d4d4d8", "#ffffff"],
  ["#e5191c", "#f97316", "#ffd200", "#35b13a", "#1b8fe5", "#8b5cf6"],
  ["#fca5a5", "#fdba74", "#fde68a", "#86efac", "#93c5fd", "#c4b5fd"],
  ["#991b1b", "#9a3412", "#a16207", "#166534", "#1e3a8a", "#5b21b6"],
  ["#ec4899", "#14b8a6", "#06b6d4", "#84cc16", "#78350f", "#0f172a"],
];

const RECENT_KEY = "snipit.editor.recentColors";

function recentColors(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberColor(c: string) {
  try {
    const list = [c, ...recentColors().filter((x) => x !== c)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Only a convenience.
  }
}

/** The colour picker grid: palette, recent colours, hex entry and the eyedropper. */
function ColorGrid({
  value,
  allowNone,
  onPick,
}: {
  value: string | null;
  allowNone?: boolean;
  onPick: (c: string | null) => void;
}) {
  const [hex, setHex] = useState(value ?? "");
  const recent = recentColors();
  const pick = (c: string | null) => {
    if (c) rememberColor(c);
    onPick(c);
  };
  const eyedrop = async () => {
    const Dropper = (
      window as unknown as {
        EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
      }
    ).EyeDropper;
    if (!Dropper) return;
    try {
      const { sRGBHex } = await new Dropper().open();
      pick(sRGBHex);
    } catch {
      // Cancelled.
    }
  };
  const swatch = (c: string) => (
    <button
      key={c}
      type="button"
      title={c}
      onClick={() => pick(c)}
      className={`size-6 rounded-sm border ${
        c.toLowerCase() === value?.toLowerCase()
          ? "border-brand-500 ring-2 ring-brand-500/40"
          : "border-black/15 dark:border-white/20"
      }`}
      style={{ background: c }}
    />
  );
  return (
    <div className="w-[176px] space-y-2 p-1">
      <div className="grid grid-cols-6 gap-1">{PALETTE.flat().map(swatch)}</div>
      {recent.length > 0 && (
        <>
          <div className="text-[10px] text-zinc-500">Recent</div>
          <div className="grid grid-cols-6 gap-1">{recent.map(swatch)}</div>
        </>
      )}
      <div className="flex items-center gap-1">
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && /^#?[0-9a-f]{6}$/i.test(hex)) {
              pick(hex.startsWith("#") ? hex : `#${hex}`);
            }
          }}
          placeholder="#rrggbb"
          className="h-6 w-0 flex-1 rounded border border-zinc-300 bg-white px-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
        />
        <label
          title="More colours"
          className="relative size-6 cursor-pointer overflow-hidden rounded border border-zinc-300 dark:border-zinc-600"
          style={{
            background:
              "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
          }}
        >
          <input
            type="color"
            value={value ?? "#000000"}
            onChange={(e) => pick(e.target.value)}
            className="absolute inset-0 opacity-0"
          />
        </label>
        {"EyeDropper" in window && (
          <button
            type="button"
            title="Pick a colour from the screen"
            onClick={() => void eyedrop()}
            className="flex size-6 items-center justify-center rounded border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            <EyedropperIcon size={14} />
          </button>
        )}
      </div>
      {allowNone && (
        <button
          type="button"
          onClick={() => pick(null)}
          className="flex w-full items-center gap-2 rounded px-1 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <NoColor /> No colour
        </button>
      )}
    </div>
  );
}

function NoColor({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="0.5" y="0.5" width="15" height="15" fill="#fff" stroke="#bbb" />
      <path d="M2 14L14 2" stroke="#e5191c" strokeWidth="1.5" />
    </svg>
  );
}

/** Snagit's big colour tile: a labelled swatch that opens the picker. */
export function ColorTile({
  label,
  value,
  onChange,
  allowNone,
  outline,
}: {
  label: string;
  value: string | null;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
  /** Shows the colour as a ring (for outlines) rather than a filled square. */
  outline?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
        {label}
      </span>
      <button
        type="button"
        title={`${label}: ${value ?? "none"}`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex h-12 w-12 flex-col items-center justify-center rounded border border-zinc-300 bg-white shadow-sm hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800"
      >
        <span className="flex size-[30px] items-center justify-center">
          {value === null ? (
            <NoColor size={28} />
          ) : outline ? (
            <span
              className="size-7 rounded-sm"
              style={{
                boxShadow: `inset 0 0 0 5px ${value}`,
                backgroundImage:
                  "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)",
                backgroundSize: "8px 8px",
              }}
            />
          ) : (
            <span
              className="size-7 rounded-sm border border-black/15"
              style={{ background: value }}
            />
          )}
        </span>
        <ChevronDown size={9} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <ColorGrid
            value={value}
            allowNone={allowNone}
            onPick={(c) => {
              onChange(c);
              setAnchor(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

/** A compact colour button used inline in a row (e.g. next to Font). */
export function ColorChip({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (c: string) => void;
  title: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        title={title}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex h-6 items-center gap-1 rounded border border-zinc-300 bg-white px-1 dark:border-zinc-600 dark:bg-zinc-800"
      >
        <span
          className="h-3.5 w-6 rounded-sm border border-black/15"
          style={{ background: value }}
        />
        <ChevronDown size={10} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="right">
          <ColorGrid
            value={value}
            onPick={(c) => {
              if (c) onChange(c);
              setAnchor(null);
            }}
          />
        </Popover>
      )}
    </>
  );
}

const SHADOW_CELLS: ShadowDir[] = [
  "tl",
  "t",
  "tr",
  "l",
  "center",
  "r",
  "bl",
  "b",
  "br",
];
const SHADOW_NAMES: Record<ShadowDir, string> = {
  tl: "Above left",
  t: "Above",
  tr: "Above right",
  l: "Left",
  center: "All sides",
  r: "Right",
  bl: "Below left",
  b: "Below",
  br: "Below right",
};

/** Snagit's shadow picker: a 3×3 grid of directions; clicking the lit cell turns it off. */
export function ShadowTile({
  value,
  onChange,
}: {
  value: ShadowDir | null | undefined;
  onChange: (v: ShadowDir | null) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <MenuLabel
        label="Shadow"
        items={[
          { label: "No shadow", run: () => onChange(null) },
          { label: "Below right", run: () => onChange("br") },
          { label: "All sides", run: () => onChange("center") },
        ]}
      />
      <div className="grid h-12 w-12 grid-cols-3 overflow-hidden rounded border border-zinc-300 bg-white shadow-sm dark:border-zinc-600 dark:bg-zinc-800">
        {SHADOW_CELLS.map((dir) => (
          <button
            key={dir}
            type="button"
            title={`Shadow ${SHADOW_NAMES[dir]}`}
            aria-pressed={value === dir}
            onClick={() => onChange(value === dir ? null : dir)}
            className={`border-[0.5px] border-zinc-200 dark:border-zinc-700 ${
              value === dir
                ? "bg-zinc-500 dark:bg-zinc-300"
                : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function MenuLabel({
  label,
  items,
}: {
  label: string;
  items: { label: string; run: () => void }[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex items-center gap-0.5 text-[11px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
      >
        {label}
        <ChevronDown size={9} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                it.run();
                setAnchor(null);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {it.label}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Label, slider and number box in one row. */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  /** What is typed in the number box; `null` shows the current value. */
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? String(value);
  const commit = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n))
      onChange(Math.min(max, Math.max(min, n)));
    setTyped(null);
  };
  return (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-45" : ""}`}>
      <span className="w-[62px] shrink-0 text-right text-[11px] text-zinc-600 dark:text-zinc-300">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="snip-slider h-4 min-w-0 flex-1"
      />
      <span className="relative">
        <input
          value={text}
          disabled={disabled}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "ArrowUp") onChange(Math.min(max, value + step));
            if (e.key === "ArrowDown") onChange(Math.max(min, value - step));
          }}
          className="h-6 w-12 rounded border border-zinc-300 bg-white pr-1 text-right text-xs tabular-nums dark:border-zinc-600 dark:bg-zinc-800"
        />
        {suffix && (
          <span className="pointer-events-none absolute top-1 -right-3 text-[10px] text-zinc-500">
            {suffix}
          </span>
        )}
      </span>
    </div>
  );
}

export function CheckRow({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <label
      title={title}
      className="ml-[70px] flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-200"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[#6c6cff]"
      />
      {label}
    </label>
  );
}

/** Label + arbitrary control, aligned with the slider rows. */
export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[62px] shrink-0 text-right text-[11px] text-zinc-600 dark:text-zinc-300">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

/** A row of toggle buttons (bold/italic, alignment…). */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; title: string; icon: ReactNode }[];
  value: T | T[];
  onChange: (v: T) => void;
}) {
  const on = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-600">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={on(o.value)}
          onClick={() => onChange(o.value)}
          className={`flex h-6 w-7 items-center justify-center border-r border-zinc-300 last:border-r-0 dark:border-zinc-600 ${
            on(o.value)
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-600 dark:text-white"
              : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

// ---- line end and dash pickers ---------------------------------------------------------------

export const CAPS: { value: Cap; title: string }[] = [
  { value: "none", title: "Flat" },
  { value: "round", title: "Round" },
  { value: "arrow", title: "Arrow" },
  { value: "barbed", title: "Barbed arrow" },
  { value: "open", title: "Line arrow" },
  { value: "circle", title: "Round anchor" },
  { value: "square", title: "Square anchor" },
  { value: "diamond", title: "Diamond anchor" },
  { value: "tbar", title: "T-bar" },
];

/** A cap drawn pointing right (or left when `start`), with a stub of line. */
export function CapGlyph({ cap, start }: { cap: Cap; start?: boolean }) {
  const shape = (() => {
    switch (cap) {
      case "arrow":
        return <path d="M22 8L12 2v12z" fill="currentColor" />;
      case "barbed":
        return <path d="M22 8L11 2l3 6-3 6z" fill="currentColor" />;
      case "open":
        return (
          <path
            d="M14 2l8 6-8 6"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          />
        );
      case "circle":
        return <circle cx="18" cy="8" r="4.5" fill="currentColor" />;
      case "square":
        return (
          <rect x="13.5" y="3.5" width="9" height="9" fill="currentColor" />
        );
      case "diamond":
        return <path d="M18 2.5l5 5.5-5 5.5-5-5.5z" fill="currentColor" />;
      case "tbar":
        return <path d="M20 2v12" stroke="currentColor" strokeWidth={2.5} />;
      default:
        return null;
    }
  })();
  return (
    <svg
      width={26}
      height={16}
      viewBox="0 0 26 16"
      style={start ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden
    >
      <path
        d={`M2 8H${cap === "round" ? 18 : cap === "none" ? 20 : 15}`}
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap={cap === "round" ? "round" : "butt"}
      />
      {shape}
    </svg>
  );
}

export const DASHES: { value: Dash; title: string }[] = [
  { value: "solid", title: "Solid" },
  { value: "dash", title: "Dash" },
  { value: "dot", title: "Dot" },
  { value: "dashdot", title: "Dash dot" },
  { value: "dashdotdot", title: "Dash dot dot" },
];

export function DashGlyph({ dash }: { dash: Dash }) {
  return (
    <svg width={80} height={10} viewBox="0 0 80 10" aria-hidden>
      <path
        d="M3 5H77"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap={
          dash === "dot" || dash.includes("dot") ? "round" : "butt"
        }
        strokeDasharray={dashArray(
          dash,
          3,
          dash !== "solid" && dash !== "dash",
        ).join(" ")}
      />
    </svg>
  );
}

export function CapSelect({
  value,
  onChange,
  start,
  title,
}: {
  value: Cap;
  onChange: (c: Cap) => void;
  start?: boolean;
  title: string;
}) {
  return (
    <Dropdown
      title={title}
      value={value}
      onChange={onChange}
      className="h-6 w-[50px]"
      renderValue={(v) => <CapGlyph cap={v} start={start} />}
      options={CAPS.map((c) => ({
        value: c.value,
        title: c.title,
        label: <CapGlyph cap={c.value} start={start} />,
      }))}
    />
  );
}

export function DashSelect({
  value,
  onChange,
  className = "h-6 flex-1",
}: {
  value: Dash;
  onChange: (d: Dash) => void;
  className?: string;
}) {
  return (
    <Dropdown
      title="Line style"
      value={value}
      onChange={onChange}
      className={className}
      renderValue={(v) => <DashGlyph dash={v} />}
      options={DASHES.map((d) => ({
        value: d.value,
        title: d.title,
        label: <DashGlyph dash={d.value} />,
      }))}
    />
  );
}
