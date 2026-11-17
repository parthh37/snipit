import { useState } from "react";
import type { ReactNode } from "react";
import { BothEndsIcon, LineStyleIcon, RoundedIcon } from "./icons";
import type { LineStyle } from "./types";

export type Size = "s" | "m" | "l";

/** The style controls' values. */
export interface ShapeStyle {
  filled: boolean;
  rounded: boolean;
  dash: LineStyle;
  bothEnds: boolean;
  opacity: number;
  shadow: boolean;
}

/** A saved look for a tool: what a quick-style tile applies. */
export interface Preset {
  color: string;
  size: Size;
  dash?: LineStyle;
  filled?: boolean;
  shadow?: boolean;
}

/** Tools (and shape types) that have quick styles. */
export type StyleKind =
  | "arrow"
  | "line"
  | "pen"
  | "rect"
  | "ellipse"
  | "text"
  | "callout"
  | "step"
  | "highlighter";

const STYLE_KINDS = new Set<string>([
  "arrow",
  "line",
  "pen",
  "rect",
  "ellipse",
  "text",
  "callout",
  "step",
  "highlighter",
]);

const isStyleKind = (t: string): t is StyleKind => STYLE_KINDS.has(t);

/** Tools (and shape types) that take a line style, opacity and shadow. */
const STYLED_TOOLS = new Set<string>([
  "arrow",
  "line",
  "pen",
  "rect",
  "ellipse",
]);

const OPACITIES = [1, 0.75, 0.5, 0.25];
const LINE_STYLES: LineStyle[] = ["solid", "dashed", "dotted"];
const SIZE_DOT = { s: 6, m: 9, l: 13 };

const THEME = ["#ef4444", "#3b82f6", "#16a34a", "#f59e0b"];
const EXTRA = ["#111827", "#ffffff", "#a855f7", "#f97316"];
const NEON = ["#facc15", "#4ade80", "#f472b6", "#60a5fa"];

/** Built-in quick styles: two rows of four per tool. */
function builtIn(kind: StyleKind): Preset[] {
  const rows = (a: (c: string) => Preset, b: (c: string) => Preset) => [
    ...THEME.map(a),
    ...THEME.map(b),
  ];
  switch (kind) {
    case "arrow":
      return rows(
        (color) => ({ color, size: "l", dash: "solid", shadow: true }),
        (color) => ({ color, size: "m", dash: "dashed", shadow: true }),
      );
    case "line":
      return rows(
        (color) => ({ color, size: "m", dash: "solid", shadow: true }),
        (color) => ({ color, size: "m", dash: "dotted", shadow: false }),
      );
    case "pen":
      return rows(
        (color) => ({ color, size: "m", dash: "solid", shadow: false }),
        (color) => ({ color, size: "l", dash: "solid", shadow: true }),
      );
    case "rect":
    case "ellipse":
      return rows(
        (color) => ({
          color,
          size: "m",
          filled: false,
          dash: "solid",
          shadow: true,
        }),
        (color) => ({ color, size: "m", filled: true, shadow: false }),
      );
    case "text":
      return [
        ...THEME.map((color) => ({ color, size: "m" as const })),
        ...EXTRA.map((color) => ({ color, size: "l" as const })),
      ];
    case "callout":
    case "step":
      return [
        ...THEME.map((color) => ({ color, size: "m" as const })),
        ...EXTRA.map((color) => ({ color, size: "m" as const })),
      ];
    case "highlighter":
      return [
        ...NEON.map((color) => ({ color, size: "m" as const })),
        ...NEON.map((color) => ({ color, size: "l" as const })),
      ];
  }
}

const storageKey = (kind: StyleKind) => `snipit.editor.styles.${kind}`;

function loadCustom(kind: StyleKind): Preset[] {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Preset[]) : [];
  } catch {
    return [];
  }
}

function saveCustom(kind: StyleKind, presets: Preset[]) {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify(presets));
  } catch {
    // Saved styles are a convenience; the current session still has them.
  }
}

const samePreset = (a: Preset, b: Preset) =>
  a.color === b.color &&
  a.size === b.size &&
  (a.dash ?? "solid") === (b.dash ?? "solid") &&
  !!a.filled === !!b.filled &&
  !!a.shadow === !!b.shadow;

interface Props {
  /** The tool, or the selected shape's type, whose look the panel shows. */
  target: string;
  /** Nothing to style: the Select tool with no shape picked. */
  empty: boolean;
  palette: string[];
  color: string;
  size: Size;
  style: ShapeStyle;
  onColor: (color: string) => void;
  onSize: (size: Size) => void;
  onStyle: (patch: Partial<ShapeStyle>) => void;
  onPreset: (preset: Preset) => void;
  /** Tabs at the top of the panel. */
  header?: ReactNode;
}

/**
 * The editor's right-hand panel: quick styles for the current tool on top, its properties
 * underneath. It styles the selected shape, or the next one drawn.
 */
export default function StylePanel({
  target,
  empty,
  palette,
  color,
  size,
  style,
  onColor,
  onSize,
  onStyle,
  onPreset,
  header,
}: Props) {
  const kind = isStyleKind(target) ? target : null;
  const [custom, setCustom] = useState<Record<string, Preset[]>>({});
  const saved = kind ? (custom[kind] ?? loadCustom(kind)) : [];
  const styled = STYLED_TOOLS.has(target);
  const boxy = target === "rect" || target === "ellipse";
  const obscure =
    target === "pixelate" || target === "blur" || target === "spotlight";

  const current: Preset = {
    color,
    size,
    ...(styled && { dash: style.dash, shadow: style.shadow }),
    ...(boxy && { filled: style.filled }),
  };

  const updateSaved = (next: Preset[]) => {
    if (!kind) return;
    saveCustom(kind, next);
    setCustom((c) => ({ ...c, [kind]: next }));
  };

  if (empty) {
    return (
      <Panel>
        {header}
        <p className="px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Pick a tool, or select a shape on the image to change its style.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      {header}
      {kind && (
        <Section
          title="Quick styles"
          action={
            <button
              type="button"
              title="Save the current style"
              aria-label="Save the current style"
              disabled={saved.some((p) => samePreset(p, current))}
              onClick={() => updateSaved([...saved, current].slice(-8))}
              className="flex size-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800 disabled:opacity-35 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
            >
              <PlusIcon />
            </button>
          }
        >
          <div className="grid grid-cols-4 gap-1.5">
            {[...builtIn(kind), ...saved].map((p, i, all) => {
              const isSaved = i >= all.length - saved.length;
              return (
                <div key={i} className="group relative">
                  <button
                    type="button"
                    title={describe(p)}
                    onClick={() => onPreset(p)}
                    className={`flex aspect-square w-full items-center justify-center rounded-md border bg-white transition dark:bg-zinc-800 ${
                      samePreset(p, current)
                        ? "border-brand-500 ring-1 ring-brand-500"
                        : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                    }`}
                  >
                    <PresetPreview kind={kind} preset={p} />
                  </button>
                  {isSaved && (
                    <button
                      type="button"
                      title="Remove this style"
                      aria-label="Remove this style"
                      onClick={() => updateSaved(saved.filter((s) => s !== p))}
                      className="absolute -top-1 -right-1 hidden size-4 items-center justify-center rounded-full bg-zinc-700 text-[10px] leading-none text-white group-hover:flex"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Properties">
        {!obscure && (
          <Row label="Color">
            <div className="flex flex-wrap gap-1.5">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={`Color ${c}`}
                  onClick={() => onColor(c)}
                  className={`size-5 rounded-full border border-black/15 dark:border-white/20 ${
                    color === c
                      ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
                      : ""
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Row>
        )}

        <Row
          label={
            target === "spotlight"
              ? "Dim"
              : target === "magnify"
                ? "Zoom"
                : obscure
                  ? "Strength"
                  : target === "text"
                    ? "Text size"
                    : "Size"
          }
        >
          <Segmented>
            {(["s", "m", "l"] as const).map((s) => (
              <Segment
                key={s}
                active={size === s}
                title={`Size ${s.toUpperCase()}`}
                onClick={() => onSize(s)}
              >
                <span
                  className="rounded-full bg-current"
                  style={{ width: SIZE_DOT[s], height: SIZE_DOT[s] }}
                />
              </Segment>
            ))}
          </Segmented>
        </Row>

        {boxy && (
          <Row label="Fill">
            <Segmented>
              <Segment
                active={!style.filled}
                title="Outline"
                onClick={() => onStyle({ filled: false })}
              >
                <span className="size-3.5 rounded-sm border-2 border-current" />
              </Segment>
              <Segment
                active={style.filled}
                title="Filled"
                onClick={() => onStyle({ filled: true })}
              >
                <span className="size-3.5 rounded-sm bg-current" />
              </Segment>
              {target === "rect" && (
                <Segment
                  active={style.rounded}
                  title="Rounded corners"
                  onClick={() => onStyle({ rounded: !style.rounded })}
                >
                  <RoundedIcon />
                </Segment>
              )}
            </Segmented>
          </Row>
        )}

        {styled && !(boxy && style.filled) && (
          <Row label="Line">
            <Segmented>
              {LINE_STYLES.map((d) => (
                <Segment
                  key={d}
                  active={style.dash === d}
                  title={d[0].toUpperCase() + d.slice(1)}
                  onClick={() => onStyle({ dash: d })}
                >
                  <LineStyleIcon style={d} />
                </Segment>
              ))}
            </Segmented>
          </Row>
        )}

        {target === "arrow" && (
          <Row label="Heads">
            <Segmented>
              <Segment
                active={!style.bothEnds}
                title="Head at the end"
                onClick={() => onStyle({ bothEnds: false })}
              >
                <OneEndIcon />
              </Segment>
              <Segment
                active={style.bothEnds}
                title="Heads at both ends"
                onClick={() => onStyle({ bothEnds: true })}
              >
                <BothEndsIcon />
              </Segment>
            </Segmented>
          </Row>
        )}

        {styled && (
          <>
            <Row label="Opacity">
              <Segmented>
                {OPACITIES.map((o) => (
                  <Segment
                    key={o}
                    active={style.opacity === o}
                    title={`${Math.round(o * 100)}%`}
                    onClick={() => onStyle({ opacity: o })}
                  >
                    <span className="text-[11px] tabular-nums">
                      {Math.round(o * 100)}
                    </span>
                  </Segment>
                ))}
              </Segmented>
            </Row>
            <Row label="Shadow">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={style.shadow}
                  onChange={(e) => {
                    onStyle({ shadow: e.target.checked });
                    e.currentTarget.blur();
                  }}
                  className="size-4 accent-brand-600"
                />
                Drop shadow
              </label>
            </Row>
          </>
        )}
      </Section>
    </Panel>
  );
}

function describe(p: Preset) {
  const bits = [p.color, `size ${p.size.toUpperCase()}`];
  if (p.dash && p.dash !== "solid") bits.push(p.dash);
  if (p.filled) bits.push("filled");
  if (p.shadow) bits.push("shadow");
  return bits.join(", ");
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <aside
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      // Buttons here never keep the focus, so Space (pan) and the tool keys keep working.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {children}
    </aside>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-zinc-200 px-3 pt-2.5 pb-3 dark:border-zinc-800">
      <div className="mb-2 flex h-6 items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {title}
        </h3>
        {action}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

export function Segmented({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-fit rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
      {children}
    </div>
  );
}

export function Segment({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-7 min-w-8 items-center justify-center rounded px-1.5 transition [&_svg]:size-4 ${
        active
          ? "bg-brand-500/15 text-brand-600 dark:text-brand-500"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

/** A small drawing of what a quick style looks like on the image. */
function PresetPreview({ kind, preset }: { kind: StyleKind; preset: Preset }) {
  const { color } = preset;
  const w = { s: 2, m: 3, l: 4.5 }[preset.size];
  const dash =
    preset.dash === "dashed"
      ? `${w * 2} ${w * 2}`
      : preset.dash === "dotted"
        ? `0.1 ${w * 2}`
        : undefined;
  const cap = "round";
  const shadow = preset.shadow
    ? { filter: "drop-shadow(1px 1.5px 1px rgb(0 0 0 / 0.35))" }
    : undefined;
  const light = color.toLowerCase() === "#ffffff";

  let body: ReactNode;
  switch (kind) {
    case "arrow":
      body = (
        <>
          <path
            d="M8 28L26 10"
            stroke={color}
            strokeWidth={w}
            strokeDasharray={dash}
            strokeLinecap={cap}
          />
          <path d="M29 7l-1.5 10-8.5-8.5z" fill={color} />
        </>
      );
      break;
    case "line":
      body = (
        <path
          d="M7 27L29 9"
          stroke={color}
          strokeWidth={w}
          strokeDasharray={dash}
          strokeLinecap={cap}
        />
      );
      break;
    case "pen":
      body = (
        <path
          d="M6 24c4-10 8-10 10-3s7 6 14-9"
          fill="none"
          stroke={color}
          strokeWidth={w}
          strokeLinecap="round"
        />
      );
      break;
    case "rect":
    case "ellipse": {
      const common = preset.filled
        ? { fill: color }
        : {
            fill: "none",
            stroke: color,
            strokeWidth: w,
            strokeDasharray: dash,
          };
      body =
        kind === "rect" ? (
          <rect x="7" y="9" width="22" height="18" rx="2" {...common} />
        ) : (
          <ellipse cx="18" cy="18" rx="12" ry="9" {...common} />
        );
      break;
    }
    case "text":
      body = (
        <text
          x="18"
          y="24"
          textAnchor="middle"
          fontSize={preset.size === "l" ? 17 : 14}
          fontWeight={700}
          fill={color}
          stroke={light ? "#71717a" : undefined}
          strokeWidth={light ? 0.5 : undefined}
          fontFamily="Segoe UI, system-ui, sans-serif"
        >
          Aa
        </text>
      );
      break;
    case "callout":
      body = (
        <path
          d="M7 9h22a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H16l-6 5v-5H7a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z"
          fill={color}
          stroke={light ? "#a1a1aa" : undefined}
        />
      );
      break;
    case "step":
      body = (
        <>
          <circle
            cx="18"
            cy="18"
            r="10"
            fill={color}
            stroke="#fff"
            strokeWidth="1.5"
          />
          <text
            x="18"
            y="22.5"
            textAnchor="middle"
            fontSize="12"
            fontWeight={700}
            fill={light ? "#111827" : "#fff"}
            fontFamily="Segoe UI, system-ui, sans-serif"
          >
            1
          </text>
        </>
      );
      break;
    case "highlighter":
      body = (
        <path
          d="M7 18h22"
          stroke={color}
          strokeOpacity={0.6}
          strokeWidth={preset.size === "l" ? 12 : 8}
        />
      );
      break;
  }
  return (
    <svg viewBox="0 0 36 36" className="size-9" style={shadow} aria-hidden>
      {body}
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function OneEndIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 19L19 5M11 5h8v8" />
    </svg>
  );
}
