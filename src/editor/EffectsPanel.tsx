import type { ReactNode } from "react";
import { TornIcon } from "./icons";
import { Panel, Row, Section, Segment, Segmented } from "./StylePanel";
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
 * Controls for whole-image effects. Used by the editor's side panel and by the capture preset
 * dialog, which is why it only talks in {@link Effects}.
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

/** The editor's Effects tab. */
export default function EffectsPanel({
  effects,
  header,
  onChange,
}: {
  effects: Effects;
  header: ReactNode;
  onChange: (next: Effects) => void;
}) {
  return (
    <Panel>
      {header}
      <Section
        title="Image effects"
        action={
          hasEffects(effects) && (
            <button
              type="button"
              onClick={() => onChange({})}
              className="rounded px-1.5 text-[11px] text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
            >
              Remove all
            </button>
          )
        }
      >
        <EffectsControls effects={effects} onChange={onChange} />
      </Section>
      <p className="px-3 py-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Effects frame the whole image and go into every copy and save. They stay
        editable: reopen the snip to change or remove them.
      </p>
    </Panel>
  );
}

/** "Styles | Effects" switch at the top of the side panel. */
export function PanelTabs({
  tab,
  onTab,
  effectsOn,
}: {
  tab: "styles" | "effects";
  onTab: (tab: "styles" | "effects") => void;
  /** Effects are in use, so the tab shows a dot. */
  effectsOn: boolean;
}) {
  const item = (id: "styles" | "effects", label: string, dot = false) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className={`relative flex-1 rounded-md py-1 text-xs font-medium transition ${
        tab === id
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {label}
      {dot && (
        <span className="absolute top-1.5 ml-1 inline-block size-1.5 rounded-full bg-brand-500" />
      )}
    </button>
  );
  return (
    <div
      role="tablist"
      className="m-2 mb-0 flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
    >
      {item("styles", "Styles")}
      {item("effects", "Effects", effectsOn)}
    </div>
  );
}
