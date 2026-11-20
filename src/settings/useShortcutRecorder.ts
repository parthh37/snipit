import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { acceleratorFromEvent, needsModifier } from "./shortcutFormat";

/**
 * Records the next key combination pressed. Global shortcuts are paused meanwhile, so Snipit's
 * own keys can be recorded too. Esc cancels.
 */
export function useShortcutRecorder(
  onRecorded: (accelerator: string) => void,
  onProblem: (message: string) => void,
) {
  const [recording, setRecording] = useState(false);
  // The listener lives as long as the recording; these always call the latest callbacks.
  const callbacks = useRef({ onRecorded, onProblem });
  useEffect(() => {
    callbacks.current = { onRecorded, onProblem };
  });

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
        callbacks.current.onProblem(
          "Add Ctrl, Alt, Shift or Win so normal typing isn't captured.",
        );
        return;
      }
      setRecording(false);
      callbacks.current.onRecorded(accel);
    };
    window.addEventListener("keydown", handle, true);
    window.addEventListener("keyup", handle, true);
    return () => {
      window.removeEventListener("keydown", handle, true);
      window.removeEventListener("keyup", handle, true);
      void api.pauseShortcuts(false);
    };
  }, [recording]);

  return [recording, setRecording] as const;
}
