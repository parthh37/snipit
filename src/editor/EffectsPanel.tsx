import type { ReactNode } from "react";
import { TornIcon } from "./icons";
import {
  SIDES,
  hasEffects,
  type EffectSize,
  type Effects,
  type Side,
} from "./effects";

const BORDER_COLORS = [
  "#ffffff",
  "#111827",
  "#6b7280",
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#facc15",
  "#a855f7",
];

const SIZE_DOT = { s: 6, m: 9, l: 13 };

const SIDE_NAMES: Record<Side, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
};

/**
 * Controls for whole-image effects. Used by the editor's Effects panel and by the capture
 * preset dialog, which is why it only talks in {@link Effects}.
 */
export function EffectsControls({
  effects,
  onChange,
}: {
  effects: Effects;
  onChange: (next: Effects) => void;
}) {
  const border = effects.border ?? null;
  const torn = new Set(effects.torn ?? []);

  const setBorder = (size: EffectSize | null) =>
    onChange({
      ...effects,
      border: size ? { size, color: border?.color ?? "#ffffff" } : null,
    });

  const toggleSide = (side: Side) => {
    const next = new Set(torn);
    if (next.has(side)) next.delete(side);
    else next.add(side);
    onChange({ ...effects, torn: SIDES.filter((s) => next.has(s)) });
  };

  return (
    <>
      <Row label="Border">
        <Segmented>
          <Segment
            active={!border}
            title="No border"
            onClick={() => setBorder(null)}
          >
            <span className="text-[11px]">Off</span>
          </Segment>
          {(["s", "m", "l"] as const).map((s) => (
            <Segment
              key={s}
              active={border?.size === s}
              title={`Border ${s.toUpperCase()}`}
              onClick={() => setBorder(s)}
            >
              <span
                className="rounded-[2px] border-current"
                style={{
                  width: 12,
                  height: 12,
                  borderWidth: SIZE_DOT[s] / 4,
                }}
              />
            </Segment>
          ))}
        </Segmented>
      </Row>
      {border && (
        <Row label="Color">
          <div className="flex flex-wrap gap-1.5">
            {BORDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-label={`Border color ${c}`}
                onClick={() =>
                  onChange({ ...effects, border: { ...border, color: c } })
                }
                className={`size-5 rounded-full border border-black/15 dark:border-white/20 ${
                  border.color === c
                    ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
                    : ""
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Row>
      )}
      <Row label="Shadow">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={!!effects.shadow}
            onChange={(e) => {
              onChange({ ...effects, shadow: e.target.checked });
              e.currentTarget.blur();
            }}
            className="size-4 accent-brand-600"
          />
          Drop shadow
        </label>
      </Row>
      <Row label="Torn edge">
        <Segmented>
          {SIDES.map((side) => (
            <Segment
              key={side}
              active={torn.has(side)}
              title={`Tear the ${SIDE_NAMES[side].toLowerCase()} edge`}
              onClick={() => toggleSide(side)}
            >
              <TornIcon side={side} />
            </Segment>
          ))}
        </Segmented>
      </Row>
    </>
  );
}

/**
 * The editor's Effects panel, in place of Quick Styles and Tool Properties (Snagit's Effects
 * button next to Properties).
 */
export default function EffectsPanel({
  effects,
  onChange,
}: {
  effects: Effects;
  onChange: (next: Effects) => void;
}) {
  return (
    <aside
      className="flex w-[262px] shrink-0 flex-col border-l border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      // Buttons here never keep the focus, so Space (pan) and the tool keys keep working.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      <div className="flex h-9 shrink-0 items-center justify-center border-b border-zinc-200 bg-zinc-100 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
        Effects
      </div>
      <div className="flex flex-col gap-2.5 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700">
        <EffectsControls effects={effects} onChange={onChange} />
      </div>
      <div className="flex items-start gap-2 px-3 py-3">
        <p className="flex-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Effects frame the whole image and go into every copy and save. They
          stay editable: reopen the snip to change or remove them.
        </p>
      </div>
      {hasEffects(effects) && (
        <div className="mt-auto border-t border-zinc-200 p-3 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => onChange({})}
            className="flex h-9 w-full items-center justify-center rounded border border-zinc-300 bg-zinc-50 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Remove all effects
          </button>
        </div>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

function Segmented({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-fit rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
      {children}
    </div>
  );
}

function Segment({
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
