const MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "OS",
  "AltGraph",
]);

/** Keys that are fine as a global shortcut without a modifier. */
const STANDALONE = /^(F\d{1,2}|PrintScreen|Pause|ScrollLock)$/;

/**
 * Turns a key event into an accelerator understood by the global-shortcut plugin,
 * e.g. `Ctrl+Shift+KeyS`. Returns `null` for a lone modifier press.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(e.code);
  return parts.join("+");
}

export function needsModifier(accelerator: string) {
  return !accelerator.includes("+") && !STANDALONE.test(accelerator);
}

/** `Ctrl+Shift+KeyS` → `["Ctrl", "Shift", "S"]` for display. */
export function acceleratorParts(accelerator: string) {
  return accelerator.split("+").map((part) =>
    part
      .replace(/^Key([A-Z])$/, "$1")
      .replace(/^Digit(\d)$/, "$1")
      .replace(/^Numpad(\w+)$/, "Num $1")
      .replace(/^Arrow(\w+)$/, "$1")
      .replace("PrintScreen", "PrtSc")
      .replace("Super", "Win"),
  );
}
