import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type AfterCapture,
  type SettingsView,
  type ShortcutAction,
} from "../lib/api";
import {
  acceleratorFromEvent,
  acceleratorParts,
  needsModifier,
} from "./shortcutFormat";

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  captureRegion: "Capture region or window",
  captureFullscreen: "Capture full screen",
  annotateClipboard: "Annotate clipboard image",
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

  const setAutostart = async (enabled: boolean) => {
    try {
      onChange(await api.setAutostart(enabled));
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
        <div className="flex gap-2">
          {(
            [
              ["edit", "Open in editor"],
              ["copy", "Copy to clipboard"],
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
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Every capture is also saved to the gallery.
        </p>
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
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string>();

  const save = async (value: string | null) => {
    try {
      onChange(await api.setShortcut(action, value));
      setProblem(undefined);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  useEffect(() => {
    if (!recording) return;
    void api.pauseShortcuts(true);

    const handle = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        e.type === "keydown" &&
        e.key === "Escape" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        setRecording(false);
        return;
      }
      // Windows only delivers keyup for Print Screen.
      if (e.type === "keyup" && e.code !== "PrintScreen") return;
      const accel = acceleratorFromEvent(e);
      if (!accel) return;
      if (needsModifier(accel)) {
        setProblem(
          "Add Ctrl, Alt, Shift or Win so normal typing isn't captured.",
        );
        return;
      }
      setRecording(false);
      void save(accel);
    };
    window.addEventListener("keydown", handle, true);
    window.addEventListener("keyup", handle, true);
    return () => {
      window.removeEventListener("keydown", handle, true);
      window.removeEventListener("keyup", handle, true);
      void api.pauseShortcuts(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

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
