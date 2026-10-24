export interface CommandShortcut {
  key: string;
  modifiers: readonly string[];
  /** Defaults to Command; false permits Control-only macOS bindings. */
  command?: boolean;
}
type KeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;
const codes: Readonly<Record<string, string>> = {
  "`": "Backquote",
  "/": "Slash",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  backspace: "Backspace",
};
export function matchesShortcut(
  event: KeyEvent,
  shortcut: CommandShortcut,
): boolean {
  if (
    !shortcut.key ||
    event.metaKey !== (shortcut.command !== false) ||
    event.ctrlKey !== shortcut.modifiers.includes("control") ||
    event.shiftKey !== shortcut.modifiers.includes("shift") ||
    event.altKey !== shortcut.modifiers.includes("alt")
  )
    return false;
  const key = shortcut.key.toLowerCase();
  const code =
    codes[key] ??
    (/^[a-z]$/.test(key)
      ? "Key" + key.toUpperCase()
      : /^\d$/.test(key)
        ? "Digit" + key
        : "");
  return event.key.toLowerCase() === key || (!!code && event.code === code);
}
export function shortcutLabel(shortcut: CommandShortcut): string {
  if (!shortcut.key) return "";
  return (
    (shortcut.modifiers.includes("control") ? "⌃" : "") +
    (shortcut.modifiers.includes("alt") ? "⌥" : "") +
    (shortcut.modifiers.includes("shift") ? "⇧" : "") +
    (shortcut.command === false ? "" : "⌘") +
    (shortcut.key === "backspace" ? "⌫" : shortcut.key.toUpperCase())
  );
}
