import { useState } from "react";
import { EffectsControls } from "../editor/EffectsPanel";
import { hasEffects, type Effects } from "../editor/effects";
import {
  api,
  CAPTURE_DELAYS,
  errorMessage,
  type AfterCapture,
  type CapturePreset,
  type SettingsView,
} from "../lib/api";
import { runPreset, type CaptureMode } from "../lib/capture";
import { Keys } from "../settings/Settings";
import { useShortcutRecorder } from "../settings/useShortcutRecorder";

const MODES: [CaptureMode, string][] = [
  ["interactive", "Region or window"],
  ["fullscreen", "Full screen"],
  ["scrolling", "Scrolling"],
];

const AFTER: [AfterCapture, string][] = [
  ["edit", "Open in editor"],
  ["copy", "Copy to clipboard"],
  ["save", "Only save it"],
];

const BLANK: CapturePreset = {
  id: "",
  name: "",
  mode: "interactive",
  delay: 0,
  cursor: false,
  effects: {},
  after: "copy",
  shortcut: null,
};

/** A short description of what a preset does, for its card. */
function describePreset(p: CapturePreset) {
  const bits = [MODES.find(([m]) => m === p.mode)?.[1] ?? p.mode];
  if (p.delay) bits.push(`${p.delay} s delay`);
  if (p.cursor) bits.push("pointer");
  const e = p.effects ?? {};
  const effects: string[] = [];
  if (e.border) effects.push("border");
  if (e.shadow) effects.push("shadow");
  if (e.torn?.length) effects.push("torn edge");
  if (effects.length) bits.push(effects.join(" + "));
  const after = { edit: "editor", copy: "clipboard", save: "gallery" }[p.after];
  return `${bits.join(" · ")} → ${after}`;
}

interface Props {
  view: SettingsView;
  onChange: (view: SettingsView) => void;
  notify: (message: string) => void;
}

/** The Capture page's presets: run one with a click, or add and edit them. */
export default function Presets({ view, onChange, notify }: Props) {
  const [editing, setEditing] = useState<CapturePreset | null>(null);
  const { presets } = view.settings;

  const remove = async (preset: CapturePreset) => {
    if (!window.confirm(`Delete the "${preset.name}" preset?`)) return;
    try {
      onChange(await api.deletePreset(preset.id));
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  return (
    <>
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-500 uppercase dark:text-zinc-400">
          Presets
        </h2>
        <button
          type="button"
          onClick={() => setEditing(BLANK)}
          className="text-sm text-brand-600 hover:underline dark:text-brand-500"
        >
          New preset
        </button>
      </div>

      {presets.length === 0 ? (
        <button
          type="button"
          onClick={() => setEditing(BLANK)}
          className="w-full rounded-xl border border-dashed border-zinc-300 p-5 text-left text-sm text-zinc-500 hover:border-brand-500 dark:border-zinc-700 dark:text-zinc-400"
        >
          Save a capture recipe — what to capture, a delay, a border or shadow,
          and where it goes — and run it with one click or its own shortcut.
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((p) => {
            const error = view.presetErrors[p.id];
            return (
              <div
                key={p.id}
                className="group relative rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:border-brand-500 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <button
                  type="button"
                  onClick={() =>
                    runPreset(p.id).catch((e) => notify(errorMessage(e)))
                  }
                  className="block w-full p-4 pr-24 text-left"
                >
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                    {describePreset(p)}
                  </span>
                  {p.shortcut && (
                    <span className="mt-2 block text-zinc-500">
                      <Keys accelerator={p.shortcut} />
                    </span>
                  )}
                  {error && (
                    <span className="mt-2 block text-xs text-red-600 dark:text-red-400">
                      {error}
                    </span>
                  )}
                </button>
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="rounded px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(p)}
                    className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PresetDialog
          preset={editing}
          onCancel={() => setEditing(null)}
          onSaved={(next) => {
            onChange(next);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function PresetDialog({
  preset,
  onCancel,
  onSaved,
}: {
  preset: CapturePreset;
  onCancel: () => void;
  onSaved: (view: SettingsView) => void;
}) {
  const [draft, setDraft] = useState({
    ...preset,
    effects: preset.effects ?? {},
  });
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<CapturePreset>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const [recording, setRecording] = useShortcutRecorder((shortcut) => {
    setProblem(undefined);
    set({ shortcut });
  }, setProblem);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await api.savePreset(draft));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !recording) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-label={preset.id ? "Edit preset" : "New preset"}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 className="border-b border-zinc-200 px-5 py-3 font-semibold dark:border-zinc-800">
          {preset.id ? "Edit preset" : "New preset"}
        </h2>
        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <Field label="Name">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Bug report, Docs screenshot"
              maxLength={40}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none select-text focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </Field>

          <Field label="Capture">
            <Pills
              value={draft.mode}
              options={MODES}
              onChange={(mode) => set({ mode })}
            />
          </Field>

          <Field label="Delay">
            <Pills
              value={draft.delay}
              options={CAPTURE_DELAYS.map(
                (d) => [d, d ? `${d} s` : "None"] as [number, string],
              )}
              onChange={(delay) => set({ delay })}
            />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.cursor}
                disabled={draft.mode === "scrolling"}
                onChange={(e) => set({ cursor: e.target.checked })}
                className="size-4 accent-brand-600"
              />
              Include the mouse pointer
            </label>
          </Field>

          <Field label="Effects">
            <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <EffectsControls
                effects={draft.effects}
                onChange={(effects: Effects) => set({ effects })}
              />
            </div>
          </Field>

          <Field label="Then">
            <Pills
              value={draft.after}
              options={AFTER}
              onChange={(after) => set({ after })}
            />
            {hasEffects(draft.effects) && draft.after !== "edit" && (
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                The gallery keeps the plain capture and the copy with effects.
              </p>
            )}
          </Field>

          <Field label="Shortcut">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setProblem(undefined);
                  setRecording(!recording);
                }}
                onBlur={() => setRecording(false)}
                className={`min-w-40 rounded-lg border px-3 py-1.5 text-sm ${
                  recording
                    ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-500"
                    : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                {recording ? (
                  "Press keys… (Esc to cancel)"
                ) : draft.shortcut ? (
                  <Keys accelerator={draft.shortcut} />
                ) : (
                  <span className="text-zinc-400">None</span>
                )}
              </button>
              {draft.shortcut && (
                <button
                  type="button"
                  onClick={() => set({ shortcut: null })}
                  className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Clear
                </button>
              )}
            </div>
          </Field>

          {problem && (
            <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !draft.name.trim()}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            Save preset
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function Pills<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([option, label]) => (
        <button
          key={String(option)}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            value === option
              ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-500"
              : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
