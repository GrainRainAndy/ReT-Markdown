import { it, expect } from "vitest";
import commands from "../../editor/protocol/commands.json";
import {
  matchesShortcut,
  shortcutLabel,
} from "../../editor/protocol/shortcuts";
const event = (values: Partial<KeyboardEvent>) => ({
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  key: "",
  code: "",
  ...values,
});
it("matches physical punctuation and Option keys without conflating Command and Control", () => {
  expect(
    matchesShortcut(event({ key: "~", code: "Backquote", shiftKey: true }), {
      key: "`",
      modifiers: ["shift"],
    }),
  ).toBe(true);
  expect(
    matchesShortcut(event({ key: "ç", code: "KeyC", altKey: true }), {
      key: "c",
      modifiers: ["alt"],
    }),
  ).toBe(true);
  const strike = { key: "`", modifiers: ["control", "shift"], command: false };
  expect(
    matchesShortcut(
      event({
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        key: "~",
        code: "Backquote",
      }),
      strike,
    ),
  ).toBe(true);
  expect(
    matchesShortcut(
      event({ shiftKey: true, key: "~", code: "Backquote" }),
      strike,
    ),
  ).toBe(false);
  expect(shortcutLabel({ key: "/", modifiers: [] })).toBe("⌘/");
});
it("aligns existing commands with documented macOS defaults and keeps bindings unique", () => {
  const expected = {
    toggleSource: ["/", []],
    copyMarkdown: ["c", ["shift"]],
    replace: ["h", []],
    inlineCode: ["`", ["shift"]],
    strike: ["`", ["control", "shift"]],
    insertImage: ["i", ["control"]],
    table: ["t", ["alt"]],
    codeBlock: ["c", ["alt"]],
    mathBlock: ["b", ["alt"]],
    quote: ["q", ["alt"]],
    orderedList: ["o", ["alt"]],
    bulletList: ["u", ["alt"]],
  };
  for (const [id, binding] of Object.entries(expected)) {
    const c = commands.find((c) => c.id === id)!;
    expect([c.key, c.modifiers]).toEqual(binding);
  }
  const bindings = commands.filter((c) => c.key).map((c) => shortcutLabel(c));
  expect(new Set(bindings).size).toBe(bindings.length);
});
