/* eslint-disable react-refresh/only-export-components -- shares the editor helpers and constants that go with these components */
/**
 * The editor's top bar, laid out like Snagit's: app buttons on the left, the tool row (icon
 * over label) with a More menu and Undo/Redo in the middle, Copy All and Save on the right.
 */
import { useState, type ReactNode } from "react";
import {
  CaptureIcon,
  CheckIcon,
  CopyIcon,
  LibraryIcon,
  MoreIcon,
  RedoIcon,
  SaveIcon,
  ToolIcon,
  UndoIcon,
} from "./icons";
import { Popover } from "./controls";
import { TOOL_LABELS } from "./SidePanel";
import type { Tool } from "./types";

/** Every tool, in Snagit's order: the default bar first, then the More menu's. */
export const ALL_TOOLS: Tool[] = [
  "favorites",
  "arrow",
  "text",
  "callout",
  "shape",
  "stamp",
  "fill",
  "move",
  "selection",
  "blur",
  "simplify",
  "magicwand",
  "crop",
  "cutout",
  "pen",
  "line",
  "highlighter",
  "step",
  "eraser",
  "magnify",
];

export const DEFAULT_BAR: Tool[] = [
  "favorites",
  "arrow",
  "text",
  "callout",
  "shape",
  "stamp",
  "fill",
  "move",
  "selection",
];

export const TOOL_KEYS: Partial<Record<Tool, string>> = {
  move: "V",
  arrow: "A",
  text: "T",
  callout: "B",
  shape: "R",
  stamp: "M",
  fill: "F",
  selection: "S",
  blur: "U",
  simplify: "Y",
  magicwand: "W",
  crop: "C",
  cutout: "X",
  pen: "P",
  line: "L",
  highlighter: "H",
  step: "N",
  eraser: "E",
  magnify: "Z",
};

const BAR_KEY = "snipit.editor.toolbar";

export function loadBar(): Tool[] {
  try {
    const saved = JSON.parse(localStorage.getItem(BAR_KEY) ?? "null");
    if (Array.isArray(saved)) return saved.filter((t) => ALL_TOOLS.includes(t));
  } catch {
    // Use the default.
  }
  return DEFAULT_BAR;
}

export function saveBar(bar: Tool[]) {
  try {
    localStorage.setItem(BAR_KEY, JSON.stringify(bar));
  } catch {
    // Only a preference.
  }
}

interface Props {
  tool: Tool;
  onTool: (tool: Tool) => void;
  bar: Tool[];
  onBar: (bar: Tool[]) => void;
  /** The last tool picked from More; Snagit keeps it on the bar until another replaces it. */
  recent: Tool | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onLibrary: () => void;
  onCapture: () => void;
  onCopy: () => void;
  onSave: () => void;
  busy: boolean;
  copied: boolean;
}

export default function Toolbar(p: Props) {
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const inBar = new Set(p.bar);
  const shown = [...p.bar];
  if (p.recent && !inBar.has(p.recent)) shown.push(p.recent);
  const more = ALL_TOOLS.filter((t) => !inBar.has(t));

  return (
    <div className="flex h-[62px] shrink-0 items-stretch border-b border-zinc-300 bg-white px-1.5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-0.5 pr-2">
        <BigButton
          title="Back to the library (saves your changes)"
          label="Library"
          onClick={p.onLibrary}
        >
          <LibraryIcon />
        </BigButton>
        <BigButton title="New capture" label="Capture" onClick={p.onCapture}>
          <CaptureIcon />
        </BigButton>
      </div>

      <div className="flex min-w-0 flex-1 items-end justify-center gap-0.5 overflow-hidden pb-1">
        {shown.map((t) => (
          <ToolButton
            key={t}
            tool={t}
            active={p.tool === t}
            onClick={() => p.onTool(t)}
          />
        ))}
        <button
          type="button"
          title="More tools"
          aria-expanded={!!moreAnchor}
          onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)}
          className={`flex h-[50px] w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded text-[11px] ${
            moreAnchor || more.includes(p.tool)
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white"
              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          More
          <MoreIcon />
        </button>
        <div className="mx-1 h-9 w-px self-center bg-zinc-200 dark:bg-zinc-700" />
        <SmallTool
          title="Undo (Ctrl+Z)"
          label="Undo"
          disabled={!p.canUndo}
          onClick={p.onUndo}
        >
          <UndoIcon />
        </SmallTool>
        <SmallTool
          title="Redo (Ctrl+Y)"
          label="Redo"
          disabled={!p.canRedo}
          onClick={p.onRedo}
        >
          <RedoIcon />
        </SmallTool>
      </div>

      <div className="flex items-center gap-2 pl-2">
        <button
          type="button"
          title="Copy the whole image to the clipboard (Ctrl+C)"
          onClick={p.onCopy}
          disabled={p.busy}
          className="flex h-8 items-center gap-1.5 rounded px-2.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {p.copied ? <CheckIcon /> : <CopyIcon />}
          {p.copied ? "Copied" : "Copy All"}
        </button>
        <button
          type="button"
          title="Save to the library (Ctrl+S)"
          onClick={p.onSave}
          disabled={p.busy}
          className="flex h-8 items-center gap-1.5 rounded bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-500 disabled:opacity-60"
        >
          <SaveIcon size={16} />
          Save
        </button>
      </div>

      {moreAnchor && (
        <Popover anchor={moreAnchor} onClose={() => setMoreAnchor(null)}>
          <div className="w-[170px]">
            <div className="max-h-[60vh] overflow-y-auto">
              {more.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    p.onTool(t);
                    setMoreAnchor(null);
                  }}
                  className={`flex h-10 w-full items-center gap-3 rounded px-2.5 text-left text-[13px] ${
                    p.tool === t
                      ? "bg-zinc-200 dark:bg-zinc-700"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-zinc-700 dark:text-zinc-200">
                    <ToolIcon tool={t} size={20} />
                  </span>
                  <span className="flex-1">{TOOL_LABELS[t]}</span>
                  {TOOL_KEYS[t] && (
                    <span className="text-[10px] text-zinc-400">
                      {TOOL_KEYS[t]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-1 border-t border-zinc-200 pt-1 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => {
                  setMoreAnchor(null);
                  setCustomizing(true);
                }}
                className="w-full rounded px-2.5 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Customize Toolbar…
              </button>
            </div>
          </div>
        </Popover>
      )}

      {customizing && (
        <CustomizeDialog
          bar={p.bar}
          onDone={(bar) => {
            p.onBar(bar);
            setCustomizing(false);
          }}
          onCancel={() => setCustomizing(false)}
        />
      )}
    </div>
  );
}

function BigButton({
  title,
  label,
  onClick,
  children,
}: {
  title: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-[52px] w-[58px] flex-col items-center justify-center gap-1 rounded text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {children}
      {label}
    </button>
  );
}

function ToolButton({
  tool,
  active,
  onClick,
}: {
  tool: Tool;
  active: boolean;
  onClick: () => void;
}) {
  const key = TOOL_KEYS[tool];
  return (
    <button
      type="button"
      title={`${TOOL_LABELS[tool]}${key ? ` (${key})` : ""}`}
      aria-label={TOOL_LABELS[tool]}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-[50px] min-w-11 shrink-0 flex-col items-center justify-end gap-1 rounded px-1 pb-1 text-[11px] leading-none ${
        active
          ? "bg-zinc-200 text-brand-600 dark:bg-zinc-700 dark:text-brand-500"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      <ToolIcon tool={tool} />
      <span className={active ? "text-brand-600 dark:text-brand-500" : ""}>
        {TOOL_LABELS[tool]}
      </span>
    </button>
  );
}

function SmallTool({
  title,
  label,
  disabled,
  onClick,
  children,
}: {
  title: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[50px] w-11 shrink-0 flex-col items-center justify-end gap-1 rounded pb-1 text-[11px] leading-none text-zinc-700 hover:bg-zinc-100 disabled:opacity-35 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
      {label}
    </button>
  );
}

function CustomizeDialog({
  bar,
  onDone,
  onCancel,
}: {
  bar: Tool[];
  onDone: (bar: Tool[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState(new Set(bar));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-[340px] rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900">
        <h2 className="mb-1 text-sm font-semibold">Customize Toolbar</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Pick the tools to keep on the toolbar. The rest stay in More.
        </p>
        <div className="grid grid-cols-2 gap-1">
          {ALL_TOOLS.map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={picked.has(t)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(t);
                  else next.delete(t);
                  setPicked(next);
                }}
                className="accent-[#6c6cff]"
              />
              <ToolIcon tool={t} size={16} />
              {TOOL_LABELS[t]}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-between">
          <button
            type="button"
            onClick={() => setPicked(new Set(DEFAULT_BAR))}
            className="rounded px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onDone(ALL_TOOLS.filter((t) => picked.has(t)))}
              className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
