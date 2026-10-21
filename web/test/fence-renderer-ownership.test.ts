import { expect, it } from 'vitest';
import { syntaxSpans } from '../src/live/syntax';
import { isLiteralRange } from '../src/editor/structure';

for (const marker of ['```', '~~~']) it(`uses renderer fence ownership across quoted partial Tabs (${marker})`, () => {
  const text = `> - previous\n> - parent\n>   >>   ${marker}\n>   >>\t ${marker}\n>   >>   - x\n>   >>   ${marker}\n\n**outside**`;
  const opening = text.indexOf(marker), closing = text.lastIndexOf(marker);
  const bodyFrom = text.indexOf('\n', opening) + 1, bodyTo = text.lastIndexOf('\n', closing) + 1;
  const spans = syntaxSpans(text), codes = spans.filter(span => span.kind === 'code');
  expect(codes).toHaveLength(1);
  expect(codes[0]).toMatchObject({ from: opening, to: closing + marker.length,
    fence: { opening: { from: opening, to: opening + marker.length },
      closing: { from: closing, to: closing + marker.length }, body: { from: bodyFrom, to: bodyTo }, ownsEOF: false } });
  expect(spans.filter(s => s.from >= bodyFrom && s.to <= bodyTo)).toEqual([]);
  expect(isLiteralRange(text, text.indexOf('- x') + 3)).toBe(true);
  expect(isLiteralRange(text, text.indexOf('outside'))).toBe(false);
  expect(spans.some(s => s.kind === 'strong' && s.from >= closing)).toBe(true);
});
