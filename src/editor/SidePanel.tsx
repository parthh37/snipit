/* eslint-disable react-refresh/only-export-components -- shares the editor helpers and constants that go with these components */
/**
 * The editor's right-hand panel, laid out like Snagit's: a Quick Styles gallery (with a
 * theme picker and favourite stars) above the active tool's properties, and a
 * "Select All (tool)" button at the bottom.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  ALL_STAMPS,
  STAMP_CATEGORIES,
  THEMES,
  quickStyles,
  sameStyle,
  type ArrowStyle,
  type BlurStyle,
  type CalloutStyle,
  type CutOutStyle,
  type EraserStyle,
  type Favorite,
  type FillStyle,
  type HighlightStyle,
  type MagnifyStyle,
  type PenStyle,
  type QuickStyle,
  type SelectionStyle,
  type ShapeToolStyle,
  type SimplifyStyle,
  type StampStyle,
  type StepToolStyle,
  type StyledTool,
  type Styles,
  type TextToolStyle,
  type WandStyle,
} from "./toolStyles";
import {
  CapSelect,
  CheckRow,
  ColorChip,
  ColorTile,
  DashSelect,
  Dropdown,
  Row,
  ShadowTile,
  SliderRow,
  ToggleGroup,
} from "./controls";
import {
  AlignIcon,
  BoldIcon,
  ItalicIcon,
  SearchIcon,
  SelectAllIcon,
  StarIcon,
  UnderlineIcon,
  VAlignIcon,
} from "./icons";
import {
  boxPolygon,
  calloutPath,
  capPath,
  dashArray,
  stepPointer,
} from "./geometry";
import { FONTS, stepLabel, type Tool } from "./types";
import { EMOJI_FONT } from "./ShapeNode";

export const TOOL_LABELS: Record<Tool, string> = {
  favorites: "Favorites",
  arrow: "Arrow",
  text: "Text",
  callout: "Callout",
  shape: "Shape",
  stamp: "Stamp",
  fill: "Fill",
  move: "Move",
  selection: "Selection",
  blur: "Blur",
  simplify: "Simplify",
  magicwand: "Magic Wand",
  crop: "Crop",
  cutout: "Cut Out",
  pen: "Pen",
  line: "Line",
  highlighter: "Highlighter",
  step: "Step",
  eraser: "Eraser",
  magnify: "Magnify",
};

interface Props {
  /** The tool whose properties show: the active one, or the selected objects' tool. */
  tool: Tool;
  styles: Styles;
  onStyle: (tool: StyledTool, patch: QuickStyle) => void;
  theme: string;
  onTheme: (name: string) => void;
  favorites: Favorite[];
  onToggleFavorite: (fav: Favorite) => void;
  /** Applies a Quick Style (or a favourite, which may switch tool). */
  onQuickStyle: (tool: StyledTool, style: QuickStyle) => void;
  onSelectAll?: () => void;
  onResetSteps?: () => void;
  /** How many objects are selected (the panel edits those as well as the tool). */
  selectedCount: number;
}

export default function SidePanel(props: Props) {
  const { tool } = props;
  const styled = tool !== "crop" && tool !== "favorites";
  const theme = THEMES.find((t) => t.name === props.theme) ?? THEMES[0];
  const styleTool = styled ? (tool as StyledTool) : null;
  const gallery = styleTool ? quickStyles(styleTool, theme) : [];
  const selectAllLabel = TOOL_LABELS[tool];
  const canSelectAll = !!props.onSelectAll;

  return (
    <aside className="flex w-[262px] shrink-0 flex-col border-l border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <Header>Quick Styles</Header>
      <div className="flex max-h-[42%] min-h-[150px] flex-col border-b border-zinc-200 dark:border-zinc-700">
        {tool === "favorites" ? (
          <FavoritesGallery
            favorites={props.favorites}
            onApply={(f) => props.onQuickStyle(f.tool, f.style)}
            onToggle={props.onToggleFavorite}
          />
        ) : tool === "stamp" ? (
          <StampGallery
            value={props.styles.stamp.glyph}
            onPick={(glyph) => props.onStyle("stamp", { glyph })}
          />
        ) : gallery.length > 0 && styleTool ? (
          <>
            {styleTool !== "highlighter" &&
              styleTool !== "blur" &&
              styleTool !== "cutout" && (
                <div className="flex items-center gap-1.5 px-2 pt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                  Theme:
                  <Dropdown
                    className="h-6 flex-1"
                    value={theme.name}
                    onChange={props.onTheme}
                    options={THEMES.map((t) => ({
                      value: t.name,
                      label: (
                        <span className="flex items-center gap-2">
                          <span className="flex">
                            {t.colors.map((c) => (
                              <span
                                key={c}
                                className="size-3 border border-black/10"
                                style={{ background: c }}
                              />
                            ))}
                          </span>
                          {t.name}
                        </span>
                      ),
                    }))}
                  />
                </div>
              )}
            <div className="grid grid-cols-4 gap-1.5 overflow-y-auto p-2">
              {gallery.map((style, i) => {
                const fav = props.favorites.some(
                  (f) => f.tool === styleTool && sameStyle(f.style, style),
                );
                const current = isCurrent(props.styles[styleTool], style);
                return (
                  <StyleTile
                    key={i}
                    tool={styleTool}
                    style={{ ...props.styles[styleTool], ...style } as never}
                    current={current}
                    favorite={fav}
                    onApply={() => props.onQuickStyle(styleTool, style)}
                    onToggleFavorite={() =>
                      props.onToggleFavorite({ tool: styleTool, style })
                    }
                  />
                );
              })}
            </div>
          </>
        ) : (
          <p className="m-auto px-6 text-center text-xs text-zinc-500">
            {tool === "crop"
              ? "Drag the handles to choose the area to keep."
              : "This tool has no quick styles."}
          </p>
        )}
      </div>

      <Header>Tool Properties</Header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Properties {...props} />
      </div>

      {canSelectAll && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
          <button
            type="button"
            onClick={props.onSelectAll}
            className="flex h-9 w-full items-center justify-center gap-2 rounded border border-zinc-300 bg-zinc-50 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <SelectAllIcon /> Select All ({selectAllLabel})
          </button>
        </div>
      )}
    </aside>
  );
}

function Header({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-center border-b border-zinc-200 bg-zinc-100 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </div>
  );
}

const isCurrent = (current: object, style: QuickStyle) =>
  Object.entries(style).every(
    ([k, v]) => (current as Record<string, unknown>)[k] === v,
  );

function StyleTile({
  tool,
  style,
  current,
  favorite,
  onApply,
  onToggleFavorite,
}: {
  tool: StyledTool;
  style: Styles[StyledTool];
  current: boolean;
  favorite: boolean;
  onApply: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onApply}
        className={`flex aspect-square w-full items-center justify-center rounded border-2 bg-white dark:bg-zinc-100 ${
          current
            ? "border-[#2b7bd6]"
            : "border-transparent hover:border-zinc-300"
        }`}
      >
        <StylePreview tool={tool} style={style} />
      </button>
      <button
        type="button"
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={onToggleFavorite}
        className={`absolute top-0.5 right-0.5 ${
          favorite ? "" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <StarIcon on={favorite} />
      </button>
    </div>
  );
}

/** A small drawing of what a style looks like, for the Quick Styles tiles. */
export function StylePreview({
  tool,
  style,
}: {
  tool: StyledTool;
  style: Styles[StyledTool];
}) {
  const box = (children: ReactNode) => (
    <svg viewBox="0 0 48 48" className="size-[46px]" aria-hidden>
      <defs>
        <filter id="tile-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="1.5"
            dy="1.5"
            stdDeviation="1.2"
            floodOpacity="0.35"
          />
        </filter>
      </defs>
      {children}
    </svg>
  );
  const sh = (on: unknown) => (on ? "url(#tile-shadow)" : undefined);
  switch (tool) {
    case "arrow":
    case "line": {
      const s = style as ArrowStyle;
      const w = Math.min(7, Math.max(2, s.strokeWidth / 2));
      const path = (cap: string, start: boolean) => {
        const tip = start ? { x: 40, y: 8 } : { x: 8, y: 40 };
        const dir = start
          ? { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
          : { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
        const p = new Path2DRecorder();
        capPath(
          p as unknown as Path2D,
          cap as never,
          tip,
          dir,
          w,
          start ? s.startSize : s.endSize,
        );
        return p.d;
      };
      return box(
        <g filter={sh(s.shadow)} color={s.stroke} opacity={s.opacity}>
          <path
            d="M38 10L12 36"
            stroke={s.stroke}
            strokeWidth={w}
            strokeLinecap={s.startCap === "round" ? "round" : "butt"}
            strokeDasharray={dashArray(s.dash, w, false).join(" ")}
          />
          <path
            d={path(s.endCap, false)}
            fill={s.stroke}
            stroke={s.stroke}
            strokeWidth={s.endCap === "open" || s.endCap === "tbar" ? w : 0}
          />
          <path
            d={path(s.startCap, true)}
            fill={s.stroke}
            stroke={s.stroke}
            strokeWidth={s.startCap === "open" || s.startCap === "tbar" ? w : 0}
          />
        </g>,
      );
    }
    case "pen": {
      const s = style as PenStyle;
      return box(
        <path
          d="M6 34c6-18 12-22 16-14s4 14 10 10 6-14 10-18"
          fill="none"
          stroke={s.stroke}
          strokeWidth={Math.min(9, s.strokeWidth / 1.5)}
          strokeLinecap={s.nib === "round" ? "round" : "square"}
          strokeLinejoin="round"
        />,
      );
    }
    case "text": {
      const s = style as TextToolStyle;
      return box(
        <text
          x="24"
          y="34"
          textAnchor="middle"
          fontSize={Math.min(30, 12 + s.fontSize / 3)}
          fontFamily={s.font}
          fontWeight={s.bold ? 700 : 400}
          fill={s.textColor}
          stroke={s.outline ?? "none"}
          strokeWidth={s.outline ? 1.5 : 0}
          paintOrder="stroke"
          filter={sh(s.shadow)}
        >
          A
        </text>,
      );
    }
    case "callout": {
      const s = style as CalloutStyle;
      const p = new Path2DRecorder();
      const pointer =
        s.body === "speech" || s.body === "speechRound" || s.body === "cloud";
      calloutPath(p as unknown as Path2D, {
        body: s.body,
        width: 36,
        height: 24,
        tail: pointer ? { x: 6, y: 34 } : null,
      });
      return box(
        <g filter={sh(s.shadow)}>
          {!pointer && s.body !== "arrowRight" && s.body !== "arrowLeft" && (
            <path d="M14 30L8 42" stroke={s.arrowColor} strokeWidth={2.5} />
          )}
          <path
            d={p.d}
            transform="translate(6 6)"
            fill={s.fill ?? "none"}
            stroke={s.outline ?? "none"}
            strokeWidth={s.outline ? 2 : 0}
          />
          <text
            x="24"
            y="22.5"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill={s.textColor}
          >
            A
          </text>
        </g>,
      );
    }
    case "shape": {
      const s = style as ShapeToolStyle;
      const common = {
        fill: s.fill ?? "none",
        stroke: s.outline ?? "none",
        strokeWidth: s.outline
          ? Math.min(5, Math.max(1.5, s.strokeWidth / 2))
          : 0,
        strokeDasharray: dashArray(s.dash, 2.5, false).join(" "),
        opacity: s.opacity,
        filter: sh(s.shadow),
      };
      if (s.kind === "ellipse")
        return box(<ellipse cx="24" cy="24" rx="16" ry="13" {...common} />);
      if (s.kind === "rect" || s.kind === "rounded")
        return box(
          <rect
            x="8"
            y="11"
            width="32"
            height="26"
            rx={s.kind === "rounded" ? 7 : 0}
            {...common}
          />,
        );
      return box(
        <polygon
          points={boxPolygon(s.kind, 32, 28)
            .map((p) => `${p.x + 8},${p.y + 10}`)
            .join(" ")}
          {...common}
        />,
      );
    }
    case "step": {
      const s = style as StepToolStyle;
      const pointed = s.style === "circlePoint" || s.style === "squarePoint";
      const square = s.style === "square" || s.style === "squarePoint";
      const ptr = stepPointer(26, 135)
        .map((p) => `${p.x + 24},${p.y + 24}`)
        .join(" ");
      return box(
        <g filter={sh(s.shadow)}>
          {square ? (
            <rect x="11" y="11" width="26" height="26" rx="5" fill={s.fill} />
          ) : (
            <circle cx="24" cy="24" r="13" fill={s.fill} />
          )}
          {pointed && <polygon points={ptr} fill={s.fill} />}
          <text
            x="24"
            y="29.5"
            textAnchor="middle"
            fontSize="15"
            fontWeight="700"
            fill={s.textColor}
          >
            {stepLabel(1, s.sequence)}
          </text>
        </g>,
      );
    }
    case "highlighter": {
      const s = style as HighlightStyle;
      return box(
        <>
          <text x="24" y="29" textAnchor="middle" fontSize="13" fill="#333">
            Abc
          </text>
          <rect
            x="6"
            y="16"
            width="36"
            height="17"
            fill={s.color}
            opacity={s.opacity}
            style={{ mixBlendMode: "multiply" }}
          />
        </>,
      );
    }
    case "blur": {
      const s = style as BlurStyle;
      if (s.mode === "redact")
        return box(<rect x="8" y="14" width="32" height="20" fill={s.color} />);
      if (s.mode === "pixelate") {
        const n =
          s.intensity < 20
            ? 6
            : s.intensity < 40
              ? 4
              : s.intensity < 60
                ? 3
                : 2;
        const cell = 30 / n;
        const cells: ReactNode[] = [];
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const v = (x * 7 + y * 13 + x * y) % 5;
            cells.push(
              <rect
                key={`${x}-${y}`}
                x={9 + x * cell}
                y={9 + y * cell}
                width={cell}
                height={cell}
                fill={["#222", "#555", "#888", "#bbb", "#eee"][v]}
              />,
            );
          }
        return box(<>{cells}</>);
      }
      return box(
        <>
          <filter id={`b${s.intensity}`}>
            <feGaussianBlur stdDeviation={s.intensity / 25} />
          </filter>
          <path
            d="M24 9s10 11 10 18a10 10 0 01-20 0c0-7 10-18 10-18z"
            fill="#333"
            filter={`url(#b${s.intensity})`}
          />
        </>,
      );
    }
    case "magnify": {
      const s = style as MagnifyStyle;
      return box(
        <>
          {s.lens === "oval" ? (
            <circle
              cx="24"
              cy="24"
              r="15"
              fill="#eef2f7"
              stroke={s.outline}
              strokeWidth="3"
            />
          ) : (
            <rect
              x="9"
              y="9"
              width="30"
              height="30"
              rx={s.lens === "rounded" ? 8 : 0}
              fill="#eef2f7"
              stroke={s.outline}
              strokeWidth="3"
            />
          )}
          <text
            x="24"
            y="28"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#444"
          >
            {s.scale}%
          </text>
        </>,
      );
    }
    case "simplify": {
      const s = style as SimplifyStyle;
      const c = s.color ?? "#9aa4b2";
      return box(
        <>
          <rect x="7" y="9" width="34" height="8" rx={s.radius / 3} fill={c} />
          <rect
            x="7"
            y="21"
            width="20"
            height="18"
            rx={s.radius / 3}
            fill={c}
            opacity="0.7"
          />
          <rect
            x="30"
            y="21"
            width="11"
            height="8"
            rx={s.radius / 3}
            fill={c}
            opacity="0.5"
          />
          {s.color === null && (
            <text x="35" y="38" textAnchor="middle" fontSize="8" fill="#333">
              auto
            </text>
          )}
        </>,
      );
    }
    case "cutout": {
      const s = style as CutOutStyle;
      const edge = (x: number) => {
        let d = `M${x} 6`;
        for (let y = 6; y <= 42; y += 4) {
          const o =
            s.edge === "sharktooth"
              ? (y / 4) % 2
                ? 3
                : -3
              : s.edge === "saw"
                ? ((y % 8) / 8) * 6 - 3
                : s.edge === "wave"
                  ? Math.sin(y / 3) * 3
                  : s.edge === "torn"
                    ? ((y * 37) % 7) - 3
                    : 0;
          d += ` L${x + o} ${y}`;
        }
        return d;
      };
      return box(
        <>
          <rect x="6" y="6" width="16" height="36" fill="#9fb4cc" />
          <rect x="26" y="6" width="16" height="36" fill="#9fb4cc" />
          {s.edge !== "none" && s.edge !== "fade" && (
            <>
              <path d={edge(22)} stroke="#334" fill="none" strokeWidth="1.5" />
              <path d={edge(26)} stroke="#334" fill="none" strokeWidth="1.5" />
            </>
          )}
          {s.edge === "fade" && (
            <rect
              x="18"
              y="6"
              width="12"
              height="36"
              fill="#9fb4cc"
              opacity="0.6"
            />
          )}
          <text x="24" y="47" textAnchor="middle" fontSize="6" fill="#555">
            {s.edge}
          </text>
        </>,
      );
    }
    default:
      return box(null);
  }
}

/** Collects canvas path calls as an SVG path string (to reuse geometry.ts in previews). */
class Path2DRecorder {
  d = "";
  moveTo(x: number, y: number) {
    this.d += `M${x} ${y}`;
  }
  lineTo(x: number, y: number) {
    this.d += `L${x} ${y}`;
  }
  closePath() {
    this.d += "Z";
  }
  rect(x: number, y: number, w: number, h: number) {
    this.d += `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
  arc(x: number, y: number, r: number) {
    this.d += `M${x + r} ${y}A${r} ${r} 0 1 0 ${x - r} ${y}A${r} ${r} 0 1 0 ${x + r} ${y}`;
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.d += `M${x + rx} ${y}A${rx} ${ry} 0 1 0 ${x - rx} ${y}A${rx} ${ry} 0 1 0 ${x + rx} ${y}`;
  }
  arcTo(x1: number, y1: number) {
    this.d += `L${x1} ${y1}`;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.d += `Q${cx} ${cy} ${x} ${y}`;
  }
}

function FavoritesGallery({
  favorites,
  onApply,
  onToggle,
}: {
  favorites: Favorite[];
  onApply: (f: Favorite) => void;
  onToggle: (f: Favorite) => void;
}) {
  if (!favorites.length) {
    return (
      <p className="m-auto px-8 text-center text-xs text-zinc-500">
        Click the star icon to add a Quick Style to your favorites.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-1.5 overflow-y-auto p-2">
      {favorites.map((f, i) => (
        <StyleTile
          key={i}
          tool={f.tool}
          style={f.style as never}
          current={false}
          favorite
          onApply={() => onApply(f)}
          onToggleFavorite={() => onToggle(f)}
        />
      ))}
    </div>
  );
}

function StampGallery({
  value,
  onPick,
}: {
  value: string;
  onPick: (glyph: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(STAMP_CATEGORIES[0].name);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return ALL_STAMPS.filter((s) => s.name.includes(q));
    return STAMP_CATEGORIES.find((c) => c.name === category)?.stamps ?? [];
  }, [query, category]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
      <label className="flex h-7 items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 dark:border-zinc-600 dark:bg-zinc-800">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search Stamps"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        <SearchIcon />
      </label>
      {!query && (
        <Dropdown
          className="h-6"
          value={category}
          onChange={setCategory}
          options={STAMP_CATEGORIES.map((c) => ({
            value: c.name,
            label: c.name,
          }))}
        />
      )}
      <div className="grid min-h-0 grid-cols-4 gap-1 overflow-y-auto">
        {list.map((s) => (
          <button
            key={s.glyph + s.name}
            type="button"
            title={s.name}
            onClick={() => onPick(s.glyph)}
            className={`flex aspect-square items-center justify-center rounded border-2 text-[28px] leading-none ${
              s.glyph === value
                ? "border-[#2b7bd6]"
                : "border-transparent hover:border-zinc-300"
            }`}
            style={{ fontFamily: EMOJI_FONT }}
          >
            {s.glyph}
          </button>
        ))}
        {!list.length && (
          <p className="col-span-4 py-4 text-center text-xs text-zinc-500">
            No stamps found
          </p>
        )}
      </div>
    </div>
  );
}

// ---- per-tool properties ---------------------------------------------------------------------

function Properties(props: Props) {
  const { tool, styles, onStyle } = props;
  const pad = (children: ReactNode) => (
    <div className="space-y-2.5 px-3 py-3">{children}</div>
  );
  const tiles = (children: ReactNode) => (
    <div className="flex justify-around border-b border-zinc-200 px-2 pt-2 pb-3 dark:border-zinc-700">
      {children}
    </div>
  );

  switch (tool) {
    case "arrow":
    case "line": {
      const s = styles[tool];
      const set = (p: Partial<ArrowStyle>) => onStyle(tool, p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Color"
                value={s.stroke}
                onChange={(c) => c && set({ stroke: c })}
              />
              <ShadowTile
                value={s.shadow}
                onChange={(shadow) => set({ shadow })}
              />
            </>,
          )}
          {pad(
            <>
              <div className="flex items-center gap-1">
                <CapSelect
                  title="Start style"
                  start
                  value={s.startCap}
                  onChange={(startCap) => set({ startCap })}
                />
                <DashSelect value={s.dash} onChange={(dash) => set({ dash })} />
                <CapSelect
                  title="End style"
                  value={s.endCap}
                  onChange={(endCap) => set({ endCap })}
                />
              </div>
              <SliderRow
                label="Width"
                min={1}
                max={60}
                value={s.strokeWidth}
                onChange={(strokeWidth) => set({ strokeWidth })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
              <SliderRow
                label="Start Size"
                min={1}
                max={10}
                value={s.startSize}
                disabled={!sizable(s.startCap)}
                onChange={(startSize) => set({ startSize })}
              />
              <SliderRow
                label="End Size"
                min={1}
                max={10}
                value={s.endSize}
                disabled={!sizable(s.endCap)}
                onChange={(endSize) => set({ endSize })}
              />
              <CheckRow
                label="Bezier Curve"
                title="Bend the line with a handle in its middle"
                checked={s.bezier}
                onChange={(bezier) => set({ bezier })}
              />
            </>,
          )}
        </>
      );
    }
    case "pen": {
      const s = styles.pen;
      const set = (p: Partial<PenStyle>) => onStyle("pen", p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Color"
                value={s.stroke}
                onChange={(c) => c && set({ stroke: c })}
              />
              <ShadowTile
                value={s.shadow}
                onChange={(shadow) => set({ shadow })}
              />
            </>,
          )}
          {pad(
            <>
              <Row label="Shape">
                <Dropdown
                  className="h-6 flex-1"
                  value={s.nib}
                  onChange={(nib) => set({ nib })}
                  options={[
                    { value: "round", label: "● Round" },
                    { value: "square", label: "■ Square" },
                    { value: "horizontal", label: "▬ Horizontal" },
                    { value: "vertical", label: "▮ Vertical" },
                    { value: "slash", label: "⟋ Right slant" },
                    { value: "backslash", label: "⟍ Left slant" },
                  ]}
                />
              </Row>
              <SliderRow
                label="Width"
                min={1}
                max={60}
                value={s.strokeWidth}
                onChange={(strokeWidth) => set({ strokeWidth })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
              <CheckRow
                label="Smoothing"
                checked={s.smooth}
                onChange={(smooth) => set({ smooth })}
              />
            </>,
          )}
        </>
      );
    }
    case "text": {
      const s = styles.text;
      const set = (p: Partial<TextToolStyle>) => onStyle("text", p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Fill"
                value={s.textColor}
                onChange={(c) => c && set({ textColor: c })}
              />
              <ColorTile
                label="Outline"
                outline
                allowNone
                value={s.outline}
                onChange={(outline) =>
                  set({
                    outline,
                    outlineWidth:
                      outline && !s.outlineWidth ? 2 : s.outlineWidth,
                  })
                }
              />
              <ShadowTile
                value={s.shadow}
                onChange={(shadow) => set({ shadow })}
              />
            </>,
          )}
          {pad(
            <>
              <FontRows s={s} set={set} />
              <SliderRow
                label="Line Width"
                min={0}
                max={20}
                value={s.outlineWidth}
                onChange={(outlineWidth) => set({ outlineWidth })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
              <SliderRow
                label="Padding"
                min={0}
                max={40}
                value={s.padding}
                onChange={(padding) => set({ padding })}
              />
            </>,
          )}
        </>
      );
    }
    case "callout": {
      const s = styles.callout;
      const set = (p: Partial<CalloutStyle>) => onStyle("callout", p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Fill"
                allowNone
                value={s.fill}
                onChange={(fill) => set({ fill })}
              />
              <ColorTile
                label="Outline"
                outline
                allowNone
                value={s.outline}
                onChange={(outline) => set({ outline })}
              />
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  Shape
                </span>
                <Dropdown
                  className="h-12 w-12"
                  value={s.body}
                  onChange={(body) => set({ body })}
                  columns={2}
                  renderValue={(v) => <BodyGlyph body={v} />}
                  options={(
                    [
                      "rect",
                      "rounded",
                      "oval",
                      "cloud",
                      "speech",
                      "speechRound",
                      "arrowRight",
                      "arrowLeft",
                    ] as const
                  ).map((b) => ({
                    value: b,
                    label: <BodyGlyph body={b} />,
                    title: b,
                  }))}
                />
              </div>
              <ShadowTile
                value={s.shadow}
                onChange={(shadow) => set({ shadow })}
              />
            </>,
          )}
          {pad(
            <>
              <FontRows s={s} set={set} />
              <SliderRow
                label="Outline Size"
                min={0}
                max={20}
                value={s.strokeWidth}
                onChange={(strokeWidth) => set({ strokeWidth })}
              />
              <Row label="Outline Style">
                <DashSelect value={s.dash} onChange={(dash) => set({ dash })} />
              </Row>
              <div className="border-t border-zinc-200 pt-2.5 dark:border-zinc-700" />
              <Row label="Arrow Style">
                <DashSelect
                  value={s.arrowDash}
                  onChange={(arrowDash) => set({ arrowDash })}
                />
                <CapSelect
                  title="Arrow end"
                  value={s.arrowCap}
                  onChange={(arrowCap) => set({ arrowCap })}
                />
              </Row>
              <Row label="Arrow Color">
                <ColorChip
                  title="Arrow colour"
                  value={s.arrowColor}
                  onChange={(arrowColor) => set({ arrowColor })}
                />
              </Row>
              <SliderRow
                label="Arrow Size"
                min={1}
                max={30}
                value={s.arrowWidth}
                onChange={(arrowWidth) => set({ arrowWidth })}
              />
              <SliderRow
                label="Padding"
                min={0}
                max={60}
                value={s.padding}
                onChange={(padding) => set({ padding })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
            </>,
          )}
        </>
      );
    }
    case "shape": {
      const s = styles.shape;
      const set = (p: Partial<ShapeToolStyle>) => onStyle("shape", p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Fill"
                allowNone
                value={s.fill}
                onChange={(fill) => set({ fill })}
              />
              <ColorTile
                label="Outline"
                outline
                allowNone
                value={s.outline}
                onChange={(outline) => set({ outline })}
              />
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  Shape
                </span>
                <Dropdown
                  className="h-12 w-12"
                  value={s.kind}
                  onChange={(kind) => set({ kind })}
                  columns={2}
                  renderValue={(v) => <KindGlyph kind={v} />}
                  options={(
                    [
                      "rect",
                      "rounded",
                      "ellipse",
                      "triangle",
                      "diamond",
                      "hexagon",
                      "star",
                    ] as const
                  ).map((k) => ({
                    value: k,
                    label: <KindGlyph kind={k} />,
                    title: k,
                  }))}
                />
              </div>
              <ShadowTile
                value={s.shadow}
                onChange={(shadow) => set({ shadow })}
              />
            </>,
          )}
          {pad(
            <>
              <Row label="Line Style">
                <DashSelect value={s.dash} onChange={(dash) => set({ dash })} />
              </Row>
              <SliderRow
                label="Width"
                min={0}
                max={40}
                value={s.strokeWidth}
                onChange={(strokeWidth) => set({ strokeWidth })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
            </>,
          )}
        </>
      );
    }
    case "step": {
      const s = styles.step;
      const set = (p: Partial<StepToolStyle>) => onStyle("step", p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Fill"
                value={s.fill}
                onChange={(c) => c && set({ fill: c })}
              />
              <ColorTile
                label="Text"
                value={s.textColor}
                onChange={(c) => c && set({ textColor: c })}
              />
              <ShadowTile
                value={s.shadow}
                onChange={(shadow) => set({ shadow })}
              />
            </>,
          )}
          {pad(
            <>
              <Row label="Style">
                <Dropdown
                  className="h-6 flex-1"
                  value={s.style}
                  onChange={(style) => set({ style })}
                  options={[
                    { value: "circle", label: "● Circle" },
                    { value: "square", label: "■ Square" },
                    { value: "circlePoint", label: "◕ Pointed circle" },
                    { value: "squarePoint", label: "◩ Pointed square" },
                  ]}
                />
              </Row>
              <Row label="Type">
                <Dropdown
                  className="h-6 flex-1"
                  value={s.sequence}
                  onChange={(sequence) => set({ sequence })}
                  options={[
                    { value: "123", label: "1, 2, 3" },
                    { value: "ABC", label: "A, B, C" },
                    { value: "abc", label: "a, b, c" },
                  ]}
                />
                <button
                  type="button"
                  title="Start the sequence again at 1 (or A)"
                  onClick={props.onResetSteps}
                  className="h-6 rounded border border-zinc-300 px-2 text-[11px] hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  Reset
                </button>
              </Row>
              <SliderRow
                label="Size"
                min={12}
                max={120}
                value={s.size}
                onChange={(size) => set({ size })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
            </>,
          )}
        </>
      );
    }
    case "highlighter": {
      const s = styles.highlighter;
      const set = (p: Partial<HighlightStyle>) => onStyle("highlighter", p);
      return (
        <>
          {tiles(
            <ColorTile
              label="Fill"
              value={s.color}
              onChange={(c) => c && set({ color: c })}
            />,
          )}
          {pad(
            <SliderRow
              label="Opacity"
              min={5}
              max={100}
              value={Math.round(s.opacity * 100)}
              onChange={(v) => set({ opacity: v / 100 })}
            />,
          )}
        </>
      );
    }
    case "blur": {
      const s = styles.blur;
      const set = (p: Partial<BlurStyle>) => onStyle("blur", p);
      return (
        <>
          {tiles(
            <>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  Type
                </span>
                <Dropdown
                  className="h-12 w-[72px]"
                  value={s.mode}
                  onChange={(mode) => set({ mode })}
                  options={[
                    { value: "blur", label: "Blur" },
                    { value: "pixelate", label: "Pixelate" },
                    { value: "redact", label: "Solid" },
                  ]}
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  Shape
                </span>
                <Dropdown
                  className="h-12 w-[72px]"
                  value={s.ellipse ? "ellipse" : "rect"}
                  onChange={(v) => set({ ellipse: v === "ellipse" })}
                  options={[
                    { value: "rect", label: "▭ Rectangle" },
                    { value: "ellipse", label: "◯ Ellipse" },
                  ]}
                />
              </div>
              {s.mode === "redact" && (
                <ColorTile
                  label="Color"
                  value={s.color}
                  onChange={(c) => c && set({ color: c })}
                />
              )}
            </>,
          )}
          {pad(
            s.mode !== "redact" ? (
              <SliderRow
                label="Intensity"
                min={1}
                max={100}
                value={s.intensity}
                onChange={(intensity) => set({ intensity })}
              />
            ) : (
              <p className="text-xs text-zinc-500">
                Solid boxes hide what is under them completely.
              </p>
            ),
          )}
        </>
      );
    }
    case "magnify": {
      const s = styles.magnify;
      const set = (p: Partial<MagnifyStyle>) => onStyle("magnify", p);
      return (
        <>
          {tiles(
            <>
              <ColorTile
                label="Outline"
                outline
                value={s.outline}
                onChange={(c) => c && set({ outline: c })}
              />
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  Shape
                </span>
                <Dropdown
                  className="h-12 w-[72px]"
                  value={s.lens}
                  onChange={(lens) => set({ lens })}
                  options={[
                    { value: "oval", label: "◯ Oval" },
                    { value: "rect", label: "▭ Rectangle" },
                    { value: "rounded", label: "▢ Rounded" },
                  ]}
                />
              </div>
            </>,
          )}
          {pad(
            <>
              <SliderRow
                label="Magnify"
                min={110}
                max={800}
                step={10}
                value={s.scale}
                onChange={(scale) => set({ scale })}
                suffix="%"
              />
              <SliderRow
                label="Width"
                min={0}
                max={20}
                value={s.strokeWidth}
                onChange={(strokeWidth) => set({ strokeWidth })}
              />
            </>,
          )}
        </>
      );
    }
    case "simplify": {
      const s = styles.simplify;
      const set = (p: Partial<SimplifyStyle>) => onStyle("simplify", p);
      return (
        <>
          {tiles(
            <ColorTile
              label="Color"
              allowNone
              value={s.color}
              onChange={(color) => set({ color })}
            />,
          )}
          {pad(
            <>
              <p className="text-[11px] text-zinc-500">
                Drag over detailed parts of the image to replace them with plain
                blocks. With no colour picked, each block takes the main colour
                under it.
              </p>
              <SliderRow
                label="Corners"
                min={0}
                max={40}
                value={s.radius}
                onChange={(radius) => set({ radius })}
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
            </>,
          )}
        </>
      );
    }
    case "stamp": {
      const s = styles.stamp;
      const set = (p: Partial<StampStyle>) => onStyle("stamp", p);
      return (
        <>
          {tiles(
            <ShadowTile
              value={s.shadow}
              onChange={(shadow) => set({ shadow })}
            />,
          )}
          {pad(
            <SliderRow
              label="Opacity"
              min={0}
              max={100}
              value={Math.round(s.opacity * 100)}
              onChange={(v) => set({ opacity: v / 100 })}
            />,
          )}
        </>
      );
    }
    case "fill": {
      const s = styles.fill;
      const set = (p: Partial<FillStyle>) => onStyle("fill", p);
      return (
        <>
          {tiles(
            <ColorTile
              label="Fill"
              value={s.color}
              onChange={(c) => c && set({ color: c })}
            />,
          )}
          {pad(
            <>
              <SliderRow
                label="Tolerance"
                min={0}
                max={100}
                value={s.tolerance}
                onChange={(tolerance) => set({ tolerance })}
                suffix="%"
              />
              <SliderRow
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(s.opacity * 100)}
                onChange={(v) => set({ opacity: v / 100 })}
              />
              <p className="text-[11px] text-zinc-500">
                Click an area of the image to fill it and the matching colours
                around it.
              </p>
            </>,
          )}
        </>
      );
    }
    case "eraser": {
      const s = styles.eraser;
      const set = (p: Partial<EraserStyle>) => onStyle("eraser", p);
      return pad(
        <>
          <SliderRow
            label="Width"
            min={1}
            max={150}
            value={s.width}
            onChange={(width) => set({ width })}
          />
          <SliderRow
            label="Opacity"
            min={1}
            max={100}
            value={Math.round(s.opacity * 100)}
            onChange={(v) => set({ opacity: v / 100 })}
          />
          <CheckRow
            label="Anti-alias"
            checked={s.antialias}
            onChange={(antialias) => set({ antialias })}
          />
          <p className="text-[11px] text-zinc-500">
            Erases the image's pixels to transparency. Objects drawn on top are
            not affected.
          </p>
        </>,
      );
    }
    case "magicwand": {
      const s = styles.magicwand;
      const set = (p: Partial<WandStyle>) => onStyle("magicwand", p);
      return pad(
        <>
          <SliderRow
            label="Tolerance"
            min={0}
            max={100}
            value={s.tolerance}
            onChange={(tolerance) => set({ tolerance })}
            suffix="%"
          />
          <CheckRow
            label="Select all matching colors"
            title="Select the colour everywhere in the image, not just the touching area"
            checked={s.global}
            onChange={(global) => set({ global })}
          />
          <BackgroundFill
            value={s.fillMode}
            onChange={(fillMode) => set({ fillMode })}
          />
          <p className="text-[11px] text-zinc-500">
            Click a colour to select it. The selection lifts off as an object
            you can move, restyle or delete.
          </p>
        </>,
      );
    }
    case "selection": {
      const s = styles.selection;
      const set = (p: Partial<SelectionStyle>) => onStyle("selection", p);
      return pad(
        <>
          <Row label="Shape">
            <ToggleGroup
              value={s.shape}
              onChange={(shape) => set({ shape })}
              options={[
                {
                  value: "rect",
                  title: "Rectangle",
                  icon: <span className="text-xs">▭</span>,
                },
                {
                  value: "ellipse",
                  title: "Ellipse",
                  icon: <span className="text-xs">◯</span>,
                },
                {
                  value: "freehand",
                  title: "Freehand",
                  icon: <span className="text-xs">✎</span>,
                },
              ]}
            />
          </Row>
          <BackgroundFill
            value={s.fillMode}
            onChange={(fillMode) => set({ fillMode })}
          />
          <p className="text-[11px] text-zinc-500">
            Drag over part of the image to select it; then move it, or press
            Delete to remove it.
          </p>
        </>,
      );
    }
    case "move":
      return pad(
        <p className="text-[11px] text-zinc-500">
          Click objects to select them (Shift-click adds more), or drag a box
          around several. Drag to move them; arrow keys nudge. To move part of
          the image itself, use Selection or Magic Wand.
        </p>,
      );
    case "cutout": {
      const s = styles.cutout;
      const set = (p: Partial<CutOutStyle>) => onStyle("cutout", p);
      return pad(
        <>
          <Row label="Direction">
            <ToggleGroup
              value={s.vertical ? "v" : "h"}
              onChange={(v) => set({ vertical: v === "v" })}
              options={[
                {
                  value: "v",
                  title: "Vertical: remove columns",
                  icon: <span className="text-xs">⇹</span>,
                },
                {
                  value: "h",
                  title: "Horizontal: remove rows",
                  icon: <span className="text-xs">⤒</span>,
                },
              ]}
            />
          </Row>
          <Row label="Edges">
            <Dropdown
              className="h-6 flex-1"
              value={s.edge}
              onChange={(edge) => set({ edge })}
              options={[
                { value: "none", label: "None" },
                { value: "fade", label: "Fade" },
                { value: "sharktooth", label: "Sharktooth" },
                { value: "saw", label: "Saw" },
                { value: "wave", label: "Wave" },
                { value: "torn", label: "Torn" },
              ]}
            />
          </Row>
          <p className="text-[11px] text-zinc-500">
            Drag across the part of the image to remove. The two sides are
            joined with the chosen edge.
          </p>
        </>,
      );
    }
    case "crop":
      return pad(
        <p className="text-[11px] text-zinc-500">
          Drag the handles or draw a new box, then press Enter or Crop. Esc
          cancels.
        </p>,
      );
    case "favorites":
      return pad(
        <p className="text-[11px] text-zinc-500">
          Your starred Quick Styles from every tool. Click one to switch to its
          tool with that style.
        </p>,
      );
    default:
      return null;
  }
}

const sizable = (cap: string) => cap !== "none" && cap !== "round";

function BackgroundFill({
  value,
  onChange,
}: {
  value: "transparent" | "auto";
  onChange: (v: "transparent" | "auto") => void;
}) {
  return (
    <Row label="Background">
      <Dropdown
        className="h-6 flex-1"
        value={value}
        onChange={onChange}
        options={[
          {
            value: "auto",
            label: "Auto Fill",
            title: "Fill the hole from the pixels around it",
          },
          {
            value: "transparent",
            label: "Transparent",
            title: "Leave a transparent hole",
          },
        ]}
      />
    </Row>
  );
}

function FontRows<T extends TextToolStyle | CalloutStyle>({
  s,
  set,
}: {
  s: T;
  set: (p: Partial<T>) => void;
}) {
  const formats = [
    ...(s.bold ? ["bold" as const] : []),
    ...(s.italic ? ["italic" as const] : []),
    ...(s.underline ? ["underline" as const] : []),
  ];
  return (
    <>
      <Row label="Font">
        <Dropdown
          className="h-6 min-w-0 flex-1"
          value={s.font}
          onChange={(font) => set({ font } as Partial<T>)}
          options={FONTS.map((f) => ({
            value: f,
            label: <span style={{ fontFamily: f }}>{f}</span>,
          }))}
        />
        {"body" in s && (
          <ColorChip
            title="Text colour"
            value={s.textColor}
            onChange={(textColor) => set({ textColor } as Partial<T>)}
          />
        )}
      </Row>
      <SliderRow
        label="Font Size"
        min={6}
        max={160}
        value={s.fontSize}
        onChange={(fontSize) => set({ fontSize } as Partial<T>)}
      />
      <Row label="Format">
        <ToggleGroup
          value={formats}
          onChange={(f) => set({ [f]: !s[f] } as Partial<T>)}
          options={[
            { value: "bold", title: "Bold", icon: <BoldIcon /> },
            { value: "italic", title: "Italic", icon: <ItalicIcon /> },
            { value: "underline", title: "Underline", icon: <UnderlineIcon /> },
          ]}
        />
        <ToggleGroup
          value={s.align}
          onChange={(align) => set({ align } as Partial<T>)}
          options={(["left", "center", "right"] as const).map((a) => ({
            value: a,
            title: `Align ${a}`,
            icon: <AlignIcon align={a} />,
          }))}
        />
      </Row>
      <Row label="Vertical">
        <ToggleGroup
          value={s.valign}
          onChange={(valign) => set({ valign } as Partial<T>)}
          options={(["top", "middle", "bottom"] as const).map((v) => ({
            value: v,
            title: `Align ${v}`,
            icon: <VAlignIcon valign={v} />,
          }))}
        />
      </Row>
    </>
  );
}

function BodyGlyph({ body }: { body: CalloutStyle["body"] }) {
  const p = new Path2DRecorder();
  const pointer =
    body === "speech" || body === "speechRound" || body === "cloud";
  calloutPath(p as unknown as Path2D, {
    body,
    width: 26,
    height: 18,
    tail: pointer ? { x: 4, y: 26 } : null,
  });
  return (
    <svg width={34} height={32} viewBox="0 0 34 32" aria-hidden>
      {!pointer && body !== "arrowRight" && body !== "arrowLeft" && (
        <path d="M10 22L5 30" stroke="currentColor" strokeWidth={2} />
      )}
      <path
        d={p.d}
        transform="translate(4 3)"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
    </svg>
  );
}

function KindGlyph({ kind }: { kind: ShapeToolStyle["kind"] }) {
  if (kind === "ellipse")
    return (
      <svg width={30} height={26} viewBox="0 0 30 26" aria-hidden>
        <ellipse
          cx="15"
          cy="13"
          rx="12"
          ry="10"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />
      </svg>
    );
  if (kind === "rect" || kind === "rounded")
    return (
      <svg width={30} height={26} viewBox="0 0 30 26" aria-hidden>
        <rect
          x="3"
          y="3"
          width="24"
          height="20"
          rx={kind === "rounded" ? 6 : 0}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />
      </svg>
    );
  return (
    <svg width={30} height={26} viewBox="0 0 30 26" aria-hidden>
      <polygon
        points={boxPolygon(kind, 24, 20)
          .map((p) => `${p.x + 3},${p.y + 3}`)
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      />
    </svg>
  );
}
