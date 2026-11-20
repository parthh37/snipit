import { useEffect, useRef, useState } from "react";
import {
  api,
  CAPTURE_DELAYS,
  errorMessage,
  type AfterCapture,
  type SettingsView,
  type ShortcutAction,
  type Theme,
} from "../lib/api";
import { acceleratorParts } from "./shortcutFormat";
import { useShortcutRecorder } from "./useShortcutRecorder";

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  captureRegion: "Capture region or window",
  captureFullscreen: "Capture full screen",
  captureScrolling: "Scrolling capture (long page)",
  annotateClipboard: "Annotate clipboard image",
  repeatLastCapture: "Repeat last capture (same area)",
};

interface Props {
  view: SettingsView | undefined;
  onChange: (view: SettingsView) => void;
  notify: (message: string) => void;
}

export default function Settings({ view, onChange, notify }: Props) {
  if (!view) return null;
  const { settings } = view;

  const setAfterCapture = async (mode: AfterCapture) => {
    try {
      const next = await api.setAfterCapture(mode);
      onChange({ ...view, settings: next });
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const setWidgetVisible = async (visible: boolean) => {
    try {
      const next = await api.setWidgetVisible(visible);
      onChange({ ...view, settings: next });
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const setAutostart = async (enabled: boolean) => {
    try {
      onChange(await api.setAutostart(enabled));
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const setAutoCheckUpdates = async (enabled: boolean) => {
    try {
      const next = await api.setAutoCheckUpdates(enabled);
      onChange({ ...view, settings: next });
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <Section
        title="Global shortcuts"
        hint="Work from any app, even when Snipit is in the tray."
      >
        <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
            <ShortcutRow
              key={action}
              action={action}
              accelerator={settings.shortcuts[action]}
              error={view.shortcutErrors[action]}
              onChange={onChange}
            />
          ))}
        </div>
      </Section>

      <Section
        title="After capture"
        hint="What happens to every new capture. It is always saved to the gallery too."
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["edit", "Open in editor"],
              ["copy", "Copy to clipboard"],
              ["save", "Only save it"],
            ] as const
          ).map(([mode, label]) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                settings.afterCapture === mode
                  ? "border-brand-500 bg-brand-500/10"
                  : "border-zinc-200 dark:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="after-capture"
                checked={settings.afterCapture === mode}
                onChange={() => void setAfterCapture(mode)}
                className="accent-brand-600"
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <CaptureOptions view={view} onChange={onChange} notify={notify} />

      <SavingOptions view={view} onChange={onChange} notify={notify} />

      <Section title="Appearance">
        <Choices<Theme>
          name="theme"
          value={settings.theme}
          options={[
            ["system", "Same as Windows"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          onChange={(theme) =>
            api
              .setTheme(theme)
              .then((next) => onChange({ ...view, settings: next }))
              .catch((e) => notify(errorMessage(e)))
          }
        />
      </Section>

      <Section
        title="Capture widget"
        hint="A small tab at the top of the screen that opens into capture buttons when you point at it. Drag its grip to slide it along the top edge or onto another monitor."
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.showWidget}
            onChange={(e) => void setWidgetVisible(e.target.checked)}
            className="size-4 accent-brand-600"
          />
          Show the capture widget on the desktop
        </label>
      </Section>

      <Section title="Startup">
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={view.autostart}
            onChange={(e) => void setAutostart(e.target.checked)}
            className="size-4 accent-brand-600"
          />
          Start Snipit when I sign in to Windows (runs in the system tray)
        </label>
      </Section>

      <Section
        title="Updates"
        hint="Snipit asks before installing anything. You can always check by hand from the tray menu."
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates}
            onChange={(e) => void setAutoCheckUpdates(e.target.checked)}
            className="size-4 accent-brand-600"
          />
          Check for updates automatically
        </label>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && (
        <p className="mt-0.5 mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      )}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

function ShortcutRow({
  action,
  accelerator,
  error,
  onChange,
}: {
  action: ShortcutAction;
  accelerator: string | undefined;
  error: string | undefined;
  onChange: (view: SettingsView) => void;
}) {
  const [problem, setProblem] = useState<string>();

  const save = async (value: string | null) => {
    try {
      onChange(await api.setShortcut(action, value));
      setProblem(undefined);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  const [recording, setRecording] = useShortcutRecorder(
    (accel) => void save(accel),
    setProblem,
  );

  const message = problem ?? error;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm">{SHORTCUT_LABELS[action]}</span>
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
          ) : accelerator ? (
            <Keys accelerator={accelerator} />
          ) : (
            <span className="text-zinc-400">Not set</span>
          )}
        </button>
        <button
          type="button"
          title="Remove shortcut"
          disabled={!accelerator}
          onClick={() => void save(null)}
          className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 disabled:invisible dark:hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>
      {message && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{message}</p>
      )}
    </div>
  );
}

export function Keys({ accelerator }: { accelerator: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {acceleratorParts(accelerator).map((part, i) => (
        <kbd
          key={i}
          className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-px font-sans text-xs dark:border-zinc-600 dark:bg-zinc-800"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

/** A row of radio buttons drawn as pills. */
function Choices<T extends string | number>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([option, label]) => (
        <label
          key={String(option)}
          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            value === option
              ? "border-brand-500 bg-brand-500/10"
              : "border-zinc-200 dark:border-zinc-700"
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
            className="accent-brand-600"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

interface SectionProps {
  view: SettingsView;
  onChange: (view: SettingsView) => void;
  notify: (message: string) => void;
}

/** Delay and mouse pointer, for every capture that isn't run from a preset. */
function CaptureOptions({ view, onChange, notify }: SectionProps) {
  const { captureDelay, captureCursor } = view.settings;
  const set = (delay: number, cursor: boolean) =>
    api
      .setCaptureOptions(delay, cursor)
      .then((next) => onChange({ ...view, settings: next }))
      .catch((e) => notify(errorMessage(e)));

  return (
    <Section
      title="Capture"
      hint="A delay gives you time to open a menu or hover over something first. Esc cancels the countdown."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-16 text-sm text-zinc-500 dark:text-zinc-400">
            Delay
          </span>
          <Choices<number>
            name="capture-delay"
            value={captureDelay}
            options={CAPTURE_DELAYS.map(
              (d) => [d, d ? `${d} seconds` : "None"] as const,
            )}
            onChange={(delay) => void set(delay, captureCursor)}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={captureCursor}
            onChange={(e) => void set(captureDelay, e.target.checked)}
            className="size-4 accent-brand-600"
          />
          Include the mouse pointer in captures
        </label>
      </div>
    </Section>
  );
}

const TEMPLATE_FIELDS: [string, string][] = [
  ["{date}", "2026-11-17"],
  ["{time}", "14-05-09"],
  ["{app}", "program captured"],
  ["{title}", "window title"],
  ["{mode}", "region, window…"],
];

/** Where snips are saved and what they are called. */
function SavingOptions({ view, onChange, notify }: SectionProps) {
  const saved = view.settings.filenameTemplate;
  const [template, setTemplate] = useState(saved);
  const [preview, setPreview] = useState<{ name?: string; error?: string }>({});

  // Follow changes made elsewhere (or the default restored after clearing the field).
  const [shownSaved, setShownSaved] = useState(saved);
  if (shownSaved !== saved) {
    setShownSaved(saved);
    setTemplate(saved);
  }

  useEffect(() => {
    let current = true;
    api
      .previewFilename(template.trim() || saved)
      .then((name) => current && setPreview({ name }))
      .catch((e) => current && setPreview({ error: errorMessage(e) }));
    return () => {
      current = false;
    };
  }, [template, saved]);

  const input = useRef<HTMLInputElement>(null);

  const commit = (value = template) => {
    if (value === saved) return;
    api
      .setFilenameTemplate(value)
      .then((next) => onChange({ ...view, settings: next }))
      .catch((e) => notify(errorMessage(e)));
  };

  const chooseFolder = () =>
    api
      .chooseOutputFolder()
      .then((next) => next && onChange(next))
      .catch((e) => notify(errorMessage(e)));

  const resetFolder = () =>
    api
      .resetOutputFolder()
      .then(onChange)
      .catch((e) => notify(errorMessage(e)));

  const insert = (field: string) => {
    const next = template + field;
    setTemplate(next);
    // While typing, leaving the field saves it; otherwise save now.
    if (document.activeElement !== input.current) commit(next);
  };

  return (
    <Section
      title="Saving"
      hint="Every capture is saved here first, whatever happens next."
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm text-zinc-500 dark:text-zinc-400">
            Folder
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-sans text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {view.galleryDir ?? "Pictures\\Snipit"}
            </code>
            <button
              type="button"
              onClick={() => void chooseFolder()}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Change…
            </button>
            {view.settings.outputFolder && (
              <button
                type="button"
                onClick={() => void resetFolder()}
                className="rounded-lg px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Use Pictures\Snipit
              </button>
            )}
          </div>
          {view.settings.outputFolder && (
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              The gallery shows this folder. Snips saved before the change stay
              where they were.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="filename-template"
            className="mb-1.5 block text-sm text-zinc-500 dark:text-zinc-400"
          >
            File name
          </label>
          <input
            id="filename-template"
            ref={input}
            value={template}
            spellCheck={false}
            onChange={(e) => setTemplate(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setTemplate(saved);
            }}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none select-text focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATE_FIELDS.map(([field, hint]) => (
              <button
                key={field}
                type="button"
                title={`Add ${field} (${hint})`}
                // Keep the focus in the field, so the template is saved when it is left.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(field)}
                className="rounded-md border border-zinc-200 px-1.5 py-0.5 font-mono text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {field}
              </button>
            ))}
          </div>
          <p
            className={`mt-2 text-xs ${
              preview.error
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {preview.error ?? (preview.name && `For example: ${preview.name}`)}
          </p>
        </div>
      </div>
    </Section>
  );
}
