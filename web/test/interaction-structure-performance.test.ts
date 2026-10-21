import { expect, it } from 'vitest';
import { structureContext } from '../src/editor/structure';

it('bounds quote-prefix searches to linear work across long unquoted code bodies', () => {
  // Count the searchable characters in the actual parser's quote lookups. This
  // catches repeated backward scans without a machine-dependent time budget.
  const count = (lines: number) => {
    const text = '```text\n' + 'payload\n'.repeat(lines) + '```';
    const original = String.prototype.lastIndexOf;
    let searched = 0;
    String.prototype.lastIndexOf = function (this: string, value: string, position?: number) {
      const result = original.call(this, value, position);
      if (value === '>') {
        const end = position === undefined ? this.length - 1 : Math.min(position, this.length - 1);
        searched += Math.max(0, end - result);
      }
      return result;
    };
    try { expect(structureContext(text).literals).toHaveLength(1); }
    finally { String.prototype.lastIndexOf = original; }
    return { searched, size: text.length };
  };
  const small = count(2000), large = count(4000);
  expect(large.searched).toBeLessThan(large.size * 16);
  expect(large.searched).toBeLessThan(small.searched * 2.6 + 16);
});
