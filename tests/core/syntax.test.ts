import { describe, expect, it } from 'vitest';
import { parseDocument, type SyntaxNode } from '../../editor/syntax/parse';
import { buildProjection } from '../../editor/syntax/projection';
import { mapSourceToText, mapTextToSource } from '../../editor/syntax/mapping';

const flatten = (node: SyntaxNode): SyntaxNode[] => [node, ...node.children.flatMap(flatten)];

describe('lossless syntax index', () => {
  it.each(['', '\uFEFF# 标题\r\n\r\ntext\n', '> a\n>\n> - [x] b\n', '```ts\n- literal\n\n```\n', '$$\nx^2\n$$\n', '| a | b |\n| --- | ---: |\n| x | y |\n', 'Title\n=====\n\n[ref]: /a "T"\n\n[a][ref]', '<script>x</script>\n\n:::unknown\nx\n:::'])('covers every source character exactly once: %j', source => {
    const parsed = parseDocument(source);
    expect(parsed.source).toBe(source);
    expect(parsed.spans.map(span => source.slice(span.from, span.to)).join('')).toBe(source);
    let end = 0;
    for (const span of parsed.spans) { expect(span.from).toBe(end); expect(span.to).toBeGreaterThan(span.from); end = span.to; }
    expect(end).toBe(source.length);
    for (const node of flatten(parsed.root)) expect(node.raw).toBe(source.slice(node.from, node.to));
  });
  it('retains structure, raw HTML, references, Setext style and inline provenance', () => {
    const source = 'Title\n=====\n\n> - [x] **a** and \\*b\\*\n\n[ref]: /a\n\n[x][ref]\n\n<script>x</script>';
    const nodes = flatten(parseDocument(source).root);
    expect(nodes.map(node => node.type)).toEqual(expect.arrayContaining(['heading', 'blockquote', 'list', 'listItem', 'strong', 'definition', 'linkReference', 'raw']));
    expect(nodes.find(node => node.type === 'heading')?.raw).toBe('Title\n=====');
    expect(nodes.find(node => node.type === 'strong')?.raw).toBe('**a**');
    expect(nodes.find(node => node.type === 'raw')?.raw).toBe('<script>x</script>');
    expect(parseDocument(source).spans.some(span => span.kind === 'gap')).toBe(true);
  });
  it('keeps incomplete code and unsupported content literal without adding closers', () => {
    const parsed = parseDocument('```ts\nconst x = 1\n');
    const code = parsed.root.children[0]!;
    expect(code.type).toBe('code');
    expect(code.raw).toBe('```ts\nconst x = 1\n');
    expect(code.attributes.closed).toBe(false);
  });
  it.each([
    ['$x$', ['inlineMath']], ['$ x$', []], ['$x $', []], ['$x$2', []], ['$x\ny$', []],
    ['\\$x$', []], ['`$x$`', []], ['$$x$$', []], ['$20 and $30', []],
    ['$$\nx\n$$', ['math']], ['$$\nx', ['math']],
  ])('uses the project math dialect: %j', (source, expected) => {
    expect(flatten(parseDocument(source).root).filter(node => node.type === 'inlineMath' || node.type === 'math').map(node => node.type)).toEqual(expected);
  });
});

describe('editable projection', () => {
  it.each([
    ['A\n\nB', []], ['A\n\n\nB', [3]], ['A\n\n\n\nB', [3, 4]],
    ['A\n', []], ['A\n\n', [3]], ['A\n\n\n', [3, 4]],
    ['A\n \n\nB', [4]], ['', [0]], [' \n\n', [0, 2, 3]],
    ['A\r\n\r\n\r\nB', [5]], ['\n\nA', [0, 1]],
  ])('gives each editable blank a distinct source coordinate: %j', (source, offsets) => {
    expect(buildProjection(source).blocks.filter(node => node.type === 'gap').map(node => node.from)).toEqual(offsets);
  });
  it('maps normalized CRLF, escape and entity text to exact UTF16 ranges', () => {
    const projection = buildProjection('a\\*b &amp; 中😀\r\nc');
    const leaf = projection.blocks[0]!.children[0]!;
    expect(leaf.text).toBe('a*b & 中😀\nc');
    expect(mapTextToSource(leaf.mapping, 2, 'after')).toBe(3);
    expect(mapTextToSource(leaf.mapping, 5, 'after')).toBe(10);
    expect(mapSourceToText(leaf.mapping, 7, 'before')).toBe(4);
    expect(mapSourceToText(leaf.mapping, 7, 'after')).toBe(5);
    expect(mapTextToSource(leaf.mapping, leaf.text!.length, 'after')).toBe(17);
  });
  it('leaves hidden Markdown delimiters addressable through source ranges', () => {
    const block = buildProjection('**bold**').blocks[0]!;
    expect(block.children[0]!.type).toBe('strong');
    expect(block.children[0]!.from).toBe(0);
    expect(block.children[0]!.to).toBe(8);
    expect(block.children[0]!.children[0]!.text).toBe('bold');
    expect(mapTextToSource(block.children[0]!.children[0]!.mapping, 0, 'after')).toBe(2);
  });
});

describe('literal bodies and container mapping', () => {
  it('maps nested quote text without treating container prefixes as editable text', () => {
    const quote = buildProjection('> a\r\n> b').blocks[0]!;
    const text = quote.children[0]!.children[0]!;
    expect(text.text).toBe('a\nb');
    expect(mapTextToSource(text.mapping, 2, 'after')).toBe(7);
    expect(mapTextToSource(text.mapping, 2, 'before')).toBe(5);
    expect(mapSourceToText(text.mapping, 6, 'after')).toBe(2);
  });
  it('maps inline code content while preserving original delimiters and normalization', () => {
    const node = buildProjection('`` a ` b ``').blocks[0]!.children[0]!;
    expect(node.type).toBe('inlineCode');
    expect(node.text).toBe('a ` b');
    expect(mapTextToSource(node.mapping, 0)).toBe(3);
    expect(mapTextToSource(node.mapping, 5)).toBe(8);
    expect(node.raw).toBe('`` a ` b ``');
  });
  it.each([
    ['```ts\r\nx\r\n\r\n```', 'x\n\n', 7, 12, true],
    ['~~~\nx\n', 'x\n', 4, 6, false],
    ['$$\nx\n\n$$', 'x\n\n', 3, 6, true],
    ['```\n```', '', 4, 4, true],
  ])('preserves literal-body trailing newlines without exposing fences: %j', (source, text, from, to, closed) => {
    const node = buildProjection(source).blocks[0]!;
    expect(node.text).toBe(text);
    expect(node.mapping.from).toBe(from);
    expect(node.mapping.to).toBe(to);
    expect(node.attributes.closed).toBe(closed);
  });
  it('treats footnote syntax as unsupported source rather than adding an unapproved extension', () => {
    const parsed = parseDocument('[^n]: footnote\n\ntext[^n]');
    expect(flatten(parsed.root).some(node => node.type.startsWith('footnote'))).toBe(false);
  });
  it('does not create an empty paragraph for a UTF8 BOM before first content', () => {
    expect(buildProjection('\uFEFFA').blocks.map(node => node.type)).toEqual(['paragraph']);
  });
});

it('keeps BOM in coverage while all semantic offsets still address the actual source', () => {
  const source = '\uFEFF# A\r\n\r\nB';
  const parsed = parseDocument(source);
  expect(parsed.root.children[0]!.from).toBe(1);
  expect(parsed.root.children[0]!.raw).toBe('# A');
  const projection = buildProjection(source);
  expect(projection.blocks[0]!.children[0]!.text).toBe('A');
  expect(mapTextToSource(projection.blocks[0]!.children[0]!.mapping, 0)).toBe(3);
});

it('maps fenced literal bodies inside a quote without consuming quote prefixes', () => {
  const node = buildProjection('> ```\n> \\*x\n> ```').blocks[0]!.children[0]!;
  expect(node.attributes.closed).toBe(true);
  expect(node.text).toBe('\\*x\n');
  expect(mapTextToSource(node.mapping, 0)).toBe(8);
  expect(mapTextToSource(node.mapping, 3)).toBe(11);
});
it('maps indented code to its literal body', () => {
  const node = buildProjection('    a\n    b\n').blocks[0]!;
  expect(node.text).toBe('a\nb');
  expect(mapTextToSource(node.mapping, 0)).toBe(4);
  expect(mapTextToSource(node.mapping, 2)).toBe(10);
});
it('treats only the first leading BOM as encoding metadata', () => {
  const node = buildProjection('\uFEFF\uFEFFa').blocks[0]!.children[0]!;
  expect(node.text).toBe('\uFEFFa');
  expect(node.from).toBe(1);
  expect(node.to).toBe(3);
});

it('falls back to a literal editable leaf when parser replacement text has no exact source mapping', () => {
  const leaf = buildProjection('a\u0000b').blocks[0]!.children[0]!;
  expect(leaf.type).toBe('raw');
  expect(leaf.text).toBe('a\u0000b');
  expect(mapTextToSource(leaf.mapping, 2)).toBe(2);
});

describe('review regressions: exact literal semantics', () => {
  it.each(['$x\ty$', '$中\t😀$', '$x\t\ty$'])('keeps tab-containing inline math in its full UTF16 source range: %j', source => {
    const paragraph = buildProjection(source).blocks[0]!;
    expect(paragraph.children).toHaveLength(1);
    const math = paragraph.children[0]!;
    expect(math.type).toBe('inlineMath');
    expect(math.from).toBe(0);
    expect(math.to).toBe(source.length);
    expect(math.raw).toBe(source);
    expect(math.text).toBe(source.slice(1, -1));
    expect(mapTextToSource(math.mapping, math.text!.length)).toBe(source.length - 1);
  });
  it('maps quote-contained multiline inline code without exposing quote markers', () => {
    const node = buildProjection('> `a\n> b`').blocks[0]!.children[0]!.children[0]!;
    expect(node.type).toBe('inlineCode');
    expect(node.text).toBe('a b');
    expect(node.mapping.from).toBe(3);
    expect(node.mapping.to).toBe(8);
    expect(mapTextToSource(node.mapping, 2, 'before')).toBe(5);
    expect(mapTextToSource(node.mapping, 2, 'after')).toBe(7);
    expect(mapSourceToText(node.mapping, 6)).toBe(2);
  });
  it('maps GFM escaped pipes in inline code while keeping other escapes literal', () => {
    const node = buildProjection('| `x\\|y\\*` |\n| --- |').blocks[0]!.children[0]!.children[0]!.children[0]!;
    expect(node.type).toBe('inlineCode');
    expect(node.text).toBe('x|y\\*');
    expect(mapTextToSource(node.mapping, 1)).toBe(4);
    expect(mapTextToSource(node.mapping, 2)).toBe(6);
    expect(mapSourceToText(node.mapping, 5, 'before')).toBe(1);
    expect(mapSourceToText(node.mapping, 5, 'after')).toBe(2);
  });
  it.each([
    ['$$\nx\n$$$\nafter', 'x\n$$$\nafter', false],
    ['$$\nx\n$$$\nafter\n$$', 'x\n$$$\nafter\n', true],
    ['$$\r\nx\r\n$$$\r\nafter\r\n$$', 'x\n$$$\nafter\n', true],
  ])('keeps longer dollar lines in the math body until an exact closer: %j', (source, body, closed) => {
    const projection = buildProjection(source);
    expect(projection.blocks).toHaveLength(1);
    const math = projection.blocks[0]!;
    expect(math.type).toBe('math');
    expect(math.raw).toBe(source);
    expect(math.to).toBe(source.length);
    expect(math.text).toBe(body);
    expect(math.attributes.closed).toBe(closed);
  });
});

it('does not mistake a literal quoted dollar line for a math closing fence', () => {
  const node = buildProjection('$$\nx\n> $$').blocks[0]!;
  expect(node.attributes.closed).toBe(false);
  expect(node.text).toBe('x\n> $$');
});
it('keeps longer math dollar lines literal inside quote containers', () => {
  const node = buildProjection('> $$\n> x\n> $$$\n> y\n> $$').blocks[0]!.children[0]!;
  expect(node.type).toBe('math');
  expect(node.attributes.closed).toBe(true);
  expect(node.text).toBe('x\n$$$\ny\n');
});
it('does not mistake a literal quoted code fence for an actual closer', () => {
  const node = buildProjection('```\nx\n> ```').blocks[0]!;
  expect(node.attributes.closed).toBe(false);
  expect(node.text).toBe('x\n> ```');
});
it('keeps fence-shaped indented code as literal content', () => {
  const node = buildProjection('    ```\n    x').blocks[0]!;
  expect(node.type).toBe('code');
  expect(node.attributes.fence).toBeUndefined();
  expect(node.text).toBe('```\nx');
});
