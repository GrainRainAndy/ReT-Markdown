import { describe, expect, it } from 'vitest';
import { plainText, renderInlineContexts, renderMarkdown, richClipboard } from '../src/render/markdown';

describe('renderer review regressions', () => {
  it.each([
    { kind: 'math', item: '$\\oops$', prefix: '', newline: '\n', ranges: [[32, 39], [42, 49]] },
    { kind: 'image', item: '![a](a.png)', prefix: '', newline: '\n', ranges: [[32, 43], [46, 57]] },
    { kind: 'math', item: '$\\oops$', prefix: '😀 中文\r\n\r\n', newline: '\r\n', ranges: [[43, 50], [53, 60]] },
    { kind: 'image', item: '![a](a.png)', prefix: '😀 中文\r\n\r\n', newline: '\r\n', ranges: [[43, 54], [57, 68]] },
  ])('R1 maps $kind collisions within each cell (prefix "$prefix")', ({ kind, item, prefix, newline, ranges }) => {
    const source = prefix + ['| A | B | C |', '| - | - | - |', `|x\\|${item}|x|${item}|`].join(newline);
    const result = renderMarkdown(source);
    expect(result.issues.map(({ from, to }) => [from, to])).toEqual(ranges);
    for (const issue of result.issues) {
      expect(issue.kind).toBe(kind);
      expect(Number.isSafeInteger(issue.from) && Number.isSafeInteger(issue.to)).toBe(true);
      expect(issue.from).toBeGreaterThanOrEqual(0);
      expect(issue.to).toBeLessThanOrEqual(source.length);
      expect(source.slice(issue.from, issue.to)).toBe(item);
    }
    if (kind === 'math') {
      expect(result.html.match(/>\$\\oops\$<\/span>/g)).toHaveLength(2);
      expect(richClipboard(source).html.match(/>\$\\oops\$<\/span>/g)).toHaveLength(2);
    }
    expect(result.html).not.toMatch(/data-(?:from|to)="(?:undefined|NaN)"/);
  });

  it.each(['', '> ', '- ', '> - '])('R1 retains cell boundaries inside container "%s"', container => {
    for (const item of ['$\\oops$', '![a](a.png)', '$\\oops\\|😀$', '![a](dir\\|😀.png)']) {
      // Cover header/body cells, optional edge pipes, empty/padded cells, and the
      // parser's immediate-backslash rule even with two backslashes before a pipe.
      const rows = [
        ['| A | B | C |', '| - | - | - |', `|x\\|${item}|x|${item}|`],
        [`x\\|${item}|x|${item}`, '-|-|-', 'a|b|c'],
        ['A|B|C|D|E', '-|-|-|-|-', `|\t|x\\\\|${item}|x|${item}|`],
        ['A|B|C', '-|-|-', `x\\|${item}|x|${item}|ignored`, 'short'],
      ];
      for (const lines of rows) {
        const continuation = container.replace('- ', '  ');
        const source = '😀 中文\r\n\r\n' + lines.map((line, i) => (i ? continuation : container) + line).join('\r\n');
        const { html, issues } = renderMarkdown(source);
        expect(html).toContain('<table>');
        expect(issues.map(({ from, to }) => [from, to])).toEqual([
          [source.indexOf(item), source.indexOf(item) + item.length],
          [source.lastIndexOf(item), source.lastIndexOf(item) + item.length],
        ]);
        expect(issues.map(({ from, to }) => source.slice(from, to))).toEqual([item, item]);
      }
    }
  });

  it('R2 stops unfinished list math before an outdented paragraph and delimiter', () => {
    const source = '- $$\n  x\n\nOutside\n\n$$';
    const { html, issues } = renderMarkdown(source);
    expect(html).toContain('<p>Outside</p>');
    expect(issues.map(({ from, to }) => [from, to])).toEqual([[2, 9], [19, 21]]);
    expect(issues.every(issue => /unclosed/i.test(issue.message))).toBe(true);
    expect(source.slice(issues[0].from, issues[0].to)).toBe('$$\n  x\n');
    expect(html).not.toContain('<annotation');
    expect(plainText(source)).toContain('\n\nOutside\n\n');
  });

  it('R2 leaves a sibling list item outside unfinished math', () => {
    const source = '- $$\n  x\n- sibling\n\n$$';
    const { html, issues } = renderMarkdown(source);
    expect(html).toMatch(/<li>(?:<p>)?sibling(?:<\/p>)?\s*<\/li>/);
    expect(issues.map(({ from, to }) => source.slice(from, to))).toEqual(['$$\n  x', '$$']);
  });

  it.each([
    '- $$\n$$x$$\n\nOutside',
    '- outer\n  - $$\n    x\n  - sibling\n\nOutside',
    '> - $$\n>   x\n>\n> Outside\n>\n> $$',
  ])('R2 respects nested boundaries with UTF-16/CRLF: %s', input => {
    const source = '😀 中文\r\n\r\n' + input.replaceAll('\n', '\r\n');
    const { html, issues } = renderMarkdown(source);
    expect(html).toContain('<p>Outside</p>');
    const first = issues[0];
    expect(first.message).toMatch(/unclosed/i);
    expect(first.from).toBe(source.indexOf('$$'));
    expect(Number.isSafeInteger(first.to)).toBe(true);
    expect(source.slice(first.from, first.to)).not.toMatch(/Outside|sibling/);
    expect(first.to).toBeLessThan(source.indexOf('Outside'));
    if (input.includes('sibling')) expect(html).toContain('<li>sibling</li>');
  });

  it('R2 preserves blank lines and aligned math closed within its list', () => {
    const source = '- $$\n  \\begin{aligned}\n  x &= 1 \\\\\n\n  y &= 2\n  \\end{aligned}\n  $$\n\nOutside\n\n- sibling';
    const { html, issues } = renderMarkdown(source);
    expect(issues).toEqual([]);
    expect(html).toContain('katex-display');
    expect(html).toContain('<p>Outside</p>');
    expect(html).toContain('<li>sibling</li>');
    expect(html).toContain('x &amp;= 1 \\\\\n\ny &amp;= 2');
  });

  it.each(['https://example.org/', '//example.org/'])('R3 preserves remote encoded identity for %s', base => {
    const destination = base + 'a%2Fb%3Fq%3D1%23f.png';
    const source = `![a](${destination})`;
    const resolved: string[] = [];
    const options = { resolveImage: (path: string) => { resolved.push(path); return null; } };
    const result = renderMarkdown(source, options);
    const clipboard = richClipboard(source, options);
    for (const html of [result.html, clipboard.html]) {
      expect(html).toContain(`Remote image: ${destination}`);
      expect(html).not.toContain('<img');
    }
    expect(resolved).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});

describe('F08 document-context math projections', () => {
  const containers = [
    { name: 'quote', start: '> ', continuation: '> ' },
    { name: 'nested quote', start: '> > ', continuation: '> > ' },
    { name: 'list', start: '- ', continuation: '  ' },
    { name: 'quoted list', start: '> - ', continuation: '>   ' },
  ];

  it.each(containers)('renders $name display math without container prefixes', ({ start, continuation }) => {
    const source = `😀 中文\r\n\r\n${start}$$\r\n${continuation}\\frac{1}{2}\r\n${continuation}$$\r\n\r\nend`;
    const range = { from: source.indexOf('$$'), to: source.lastIndexOf('$$') + 2 };
    const [result] = renderInlineContexts(source, [range]);
    expect(result.issues).toEqual([]);
    expect(result.href).toBeNull();
    expect(result.html).toContain('katex-display');
    expect(result.html).toContain('<annotation encoding="application/x-tex">\\frac{1}{2}</annotation>');
    expect(renderMarkdown(source).html).toContain(result.html);
  });

  it.each(containers)('retains original UTF-16/CRLF error source and coordinates in $name', ({ start, continuation }) => {
    const source = `😀 中文\r\n\r\n${start}$$\r\n${continuation}\\oops\r\n${continuation}$$\r\n\r\n$\\otherOops$`;
    const range = { from: source.indexOf('$$'), to: source.lastIndexOf('$$') + 2 };
    const [result] = renderInlineContexts(source, [range]);
    expect(result.issues).toEqual([{ kind: 'math', message: expect.stringContaining('Undefined control sequence'), ...range }]);
    expect(result.issues).toEqual(renderMarkdown(source).issues.slice(0, 1));
    expect(result.html).toContain(`<div class="math-error"`);
    expect(result.html).toContain(`data-from="${range.from}" data-to="${range.to}"`);
    expect(result.html).toContain(source.slice(range.from, range.to).replaceAll('>', '&gt;'));
    expect(result.html).not.toContain('otherOops');
  });

  it('projects inline-child math tokens and keeps repeated errors at their own ranges', () => {
    const source = '> 😀 $x^2$ and $$y^2$$ and $\\oops$ then $\\oops$';
    const fragments = ['$x^2$', '$$y^2$$', '$\\oops$', '$\\oops$'];
    let cursor = 0;
    const ranges = fragments.map(fragment => {
      const from = source.indexOf(fragment, cursor);
      cursor = from + fragment.length;
      return { from, to: cursor };
    });
    const results = renderInlineContexts(source, ranges);
    expect(results[0].html).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
    expect(results[0].html).not.toContain('katex-display');
    expect(results[1].html).toContain('katex-display');
    expect(results[1].html).toContain('<annotation encoding="application/x-tex">y^2</annotation>');
    expect(results.flatMap(result => result.issues)).toEqual(renderMarkdown(source).issues);
    expect(results.slice(2).map(result => result.issues.map(({ from, to }) => ({ from, to })))).toEqual(ranges.slice(2).map(range => [range]));
  });
});

describe('offline Markdown rendering', () => {
  it('renders headings, inline formatting and nested lists', () => {
    const { html } = renderMarkdown('# 标题\n\n**bold** *italic* ~~gone~~ `x`\n\n> quote\n\n- one\n  - two\n\n1. first\n\n---');
    for (const fragment of ['<h1>标题</h1>', '<strong>bold</strong>', '<em>italic</em>', '<s>gone</s>', '<code>x</code>', '<blockquote>', '<ul>', '<ol>', '<hr>']) expect(html).toContain(fragment);
  });

  it('renders aligned GFM tables and disabled task checkboxes', () => {
    const { html } = renderMarkdown('| Left | Right |\n| :--- | ---: |\n| a | b |\n\n- [x] done\n- [ ] todo');
    expect(html).toContain('<table>');
    expect(html).toContain('text-align:right');
    expect(html).toMatch(/<input[^>]*checked[^>]*>/);
    expect(html).toMatch(/<input[^>]*disabled[^>]*>/);
  });

  it('highlights known code and safely escapes unknown language code', () => {
    const { html } = renderMarkdown('```javascript\nconst x = 1;\n```\n\n```not-a-language\n<script>x</script>\n```');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('shows unsupported HTML as inert source text', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src="https://evil.test/x" onerror="alert(1)">\n\n<iframe src="https://evil.test"></iframe>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<(script|img|iframe)\b/);
  });

  it('keeps safe inline/reference links and rejects executable schemes', () => {
    const { html } = renderMarkdown('[safe](https://example.org) [mail](mailto:a@example.org) [ref][id]\n\n[id]: https://example.org/ref\n\n[bad](javascript:alert%281%29) [data](data:text/html,boom)');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('href="mailto:a@example.org"');
    expect(html).toContain('href="https://example.org/ref"');
    expect(html).not.toMatch(/href="(?:javascript|data):/);
  });

  it('uses the first valid reference after rejecting an executable definition', () => {
    const source = '[label][ref]\n\n[ref]: javascript:alert%281%29\n\n[ref]: https://example.com/valid';
    const { html, issues } = renderMarkdown(source);
    expect(html).toContain('<p><a href="https://example.com/valid">label</a></p>');
    expect(html).not.toContain('href="javascript:');
    expect(issues).toEqual([]);
  });

  it('uses visible remote placeholders without export-blocking issues', () => {
    const { html, issues } = renderMarkdown('![remote](https://evil.test/a.png) ![other](//evil.test/b.png)');
    expect(html).toContain('https://evil.test/a.png');
    expect(html).toContain('remote-image');
    expect(html).not.toContain('<img');
    expect(issues).toEqual([]);
  });

  it('requires an explicit resolver and reports exact missing local image offsets', () => {
    const source = '😀 中文\n\n![图](<图片/带 空格.png>)';
    const result = renderMarkdown(source);
    expect(result.html).toContain('图片/带 空格.png');
    expect(result.issues).toEqual([{ kind: 'image', message: expect.any(String), from: 7, to: 26 }]);
    expect(source.slice(result.issues[0].from, result.issues[0].to)).toBe('![图](<图片/带 空格.png>)');
  });

  it('passes decoded Chinese/space paths to the resolver and only emits its local URL', () => {
    const result = renderMarkdown('![图](%E5%9B%BE%E7%89%87/a%20b.png)', {
      resolveImage: path => path === '图片/a b.png' ? 'ret-resource://document/42' : null,
    });
    expect(result.html).toContain('src="ret-resource://document/42"');
    expect(result.issues).toEqual([]);
  });

  it('does not trust remote resolver outputs or resolve remote Markdown images', () => {
    const { html, issues } = renderMarkdown('![a](a.png) ![b](https://remote.test/b)', { resolveImage: () => 'https://remote.test/a' });
    expect(html).not.toContain('<img');
    expect(issues).toHaveLength(1);
  });

  it('renders inline and display math while leaving code and escaped dollars literal', () => {
    const result = renderMarkdown('inline $x^2$ and \\$5\n\n$$\n\\frac{a}{b}\n$$\n\n`$code$`\n\n```text\n$alsoCode$\n```');
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain('katex-display');
    expect(result.html).toContain('<code>$code$</code>');
    expect(result.html).toContain('$alsoCode$');
    expect(result.issues).toEqual([]);
  });

  it('preserves incorrect formulas and locates both repeated occurrences', () => {
    const source = '😀 $\\badcommand$ and $\\badcommand$';
    const result = renderMarkdown(source);
    expect(result.html).toContain('$\\badcommand$');
    expect(result.issues.map(({ kind, from, to }) => ({ kind, from, to }))).toEqual([
      { kind: 'math', from: 3, to: 16 }, { kind: 'math', from: 21, to: 34 },
    ]);
    expect(result.issues[0].message).toMatch(/badcommand/);
  });

  it('preserves unclosed inline and block formulas with precise source ranges', () => {
    const source = 'prefix $unfinished\n\n$$\nx + y';
    const { html, issues } = renderMarkdown(source);
    expect(html).toContain('$unfinished');
    expect(html).toContain('$$');
    expect(issues.map(({ from, to }) => ({ from, to }))).toEqual([{ from: 7, to: 18 }, { from: 20, to: 28 }]);
  });

  it('locates errors within nested blocks, tables and CRLF input in UTF-16', () => {
    const source = '> 😀 $\\oops$\r\n\r\n| a |\r\n| - |\r\n| $\\oops$ |\r\n\r\n- ![图](missing.png)';
    const result = renderMarkdown(source);
    expect(result.issues.map(issue => source.slice(issue.from, issue.to))).toEqual(['$\\oops$', '$\\oops$', '![图](missing.png)']);
    expect(result.issues[0].from).toBe(5);
    expect(new Set(result.issues.map(issue => issue.from)).size).toBe(3);
  });

  it('disallows trusted KaTeX HTML and remote-image commands', () => {
    const result = renderMarkdown('$\\href{javascript:alert(1)}{x}$ $\\includegraphics{https://evil.test/a.png}$');
    expect(result.html).toContain('class="katex"');
    expect(result.html).not.toMatch(/<a\b|<img\b/);
    expect(result.html).not.toContain('href="javascript:');
  });

  it('provides readable plain text and rich clipboard fallback without changing source', () => {
    const source = '# Heading\n\n**bold** [site](https://example.org) ![diagram](a.png)\n\n- one\n- two\n\n`code` and $x^2$';
    expect(plainText(source)).toBe('Heading\n\nbold site diagram\n\n- one\n- two\n\ncode and x^2');
    const clipboard = richClipboard(source);
    expect(clipboard.html).toContain('<h1>Heading</h1>');
    expect(clipboard.text).toBe('Heading\n\nbold site diagram\n\n- one\n- two\n\ncode and x^2');
    expect(source).toContain('**bold**');
  });

  it('packages rich clipboard typography and colors without remote style resources', () => {
    const { html } = richClipboard('# Heading\n\n**bold** $x^2$');
    expect(html).toContain('<style>');
    expect(html).toMatch(/font-family:\s*["']?Open Sans/);
    expect(html).toContain('2.25em');
    expect(html).toContain('#333333');
    expect(html).toContain('<math');
    expect(html).not.toMatch(/@import|url\(["']?https?:/);
  });

  it('locates reference images and repeated errors in escaped-pipe table cells', () => {
    const source = '![图][asset]\n\n[asset]: <资源/图 1.png>\n\n| a | b |\n| - | - |\n| x\\|$\\oops$ | $\\oops$ |';
    const result = renderMarkdown(source);
    expect(result.issues.map(issue => source.slice(issue.from, issue.to))).toEqual(['![图][asset]', '$\\oops$', '$\\oops$']);
    expect(result.issues[1].from).toBe(source.indexOf('$\\oops$'));
    expect(result.issues[2].from).toBe(source.lastIndexOf('$\\oops$'));
  });

  it('keeps formulas and images in raw HTML inert', () => {
    const result = renderMarkdown('<img title="$\\oops$" src="https://never.test/a">');
    expect(result.html).toContain('&lt;img');
    expect(result.html).not.toContain('math-error');
    expect(result.issues).toEqual([]);
  });

  it('retains TeX as plain text for an unclosed formula', () => {
    expect(plainText('before $unfinished')).toBe('before $unfinished');
  });

  it('resolves explicit local file destinations', () => {
    const local = renderMarkdown('![local](file:///tmp/a.png)', { resolveImage: () => 'file:///tmp/a.png' });
    expect(local.html).toContain('src="file:///tmp/a.png"');
    expect(local.issues).toEqual([]);
  });
  it('rejects network file authorities returned by a resolver', () => {
    const network = renderMarkdown('![local](a.png)', { resolveImage: () => 'file://remote-host/share/a.png' });
    expect(network.html).not.toContain('<img');
    expect(network.issues).toHaveLength(1);
  });
});
