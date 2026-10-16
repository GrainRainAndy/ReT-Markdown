#!/usr/bin/env python3
"""Generate reproducible acceptance inputs; large inputs stay outside source files."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)

small = {
    "bom-crlf.md": b"\xef\xbb\xbf" + "# 保真\r\n\r\n* 星号\r\n+ 加号\r\n- 减号\r\n\r\n末尾无换行".encode(),
    "mixed-eol.md": "第一行\r\n第二行\n第三行\r\n第四行".encode(),
    "unsupported.md": b'---\ntitle: untouched\n---\n\n<script>alert("never execute")</script>\n\n:::custom\npreserve\n:::\n\nUnclosed **bold and $math\n',
    "table-locality.md": "前缀 **保留**\n\n| 名称 | 值 |\n| :--- | ---: |\n| A\\|B | `x` |\n| 中文🙂 |  2  |\n\n后缀 *保留*".encode(),
    "remote-and-missing.md": b"![remote](https://example.invalid/never-request.png)\n\n![missing](missing-local.png)\n",
    "unicode-selection.md": "**中文👨‍👩‍👧‍👦e\u0301** 与 [链接](https://example.invalid)\n\n$\\frac{a}{b}$\n".encode(),
}
for name, data in small.items():
    (OUT / name).write_bytes(data)

assets = OUT / "assets"
assets.mkdir(exist_ok=True)
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e8edf4"/><text x="32" y="80" font-size="32">Local image {}</text></svg>'
for i in range(10):
    (assets / f"截图 {i}.svg").write_text(svg.format(i), encoding="utf-8")

paragraph = "中文写作与 English text，保留标点、列表符号和源文。The source remains authoritative.\n\n"
regular = "# 常规性能夹具\n\n"
for i in range(20):
    regular += f"## 小节 {i}\n\n```typescript\nconst value = {i};\n```\n\n$$\n\\frac{{a_{i}}}{{b}} + \\sqrt{{x}}\n$$\n\n"
    if i < 10:
        regular += f"![本地截图](<assets/截图 {i}.svg>)\n\n"
while len(regular.encode()) < 256 * 1024:
    regular += paragraph
(OUT / "regular-256k.md").write_text(regular, encoding="utf-8")

chunk = "## 边界夹具\n\n" + paragraph + "* 原始星号\n  + 嵌套加号\n\n```text\nsource remains unchanged\n```\n\n"
boundary = chunk * (1024 * 1024 // len(chunk.encode()) + 1)
(OUT / "boundary-1m.md").write_text(boundary, encoding="utf-8")

pdf = "# PDF 分页验收\n\n"
for i in range(35):
    pdf += f"## 验收小节 {i}\n\n" + paragraph * 4
    pdf += "```python\n" + "print('searchable code 中文')\n" * 10 + "```\n\n"
    pdf += "$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n"
    if i % 4 == 0:
        pdf += f"![本地图片](<assets/截图 {i % 10}.svg>)\n\n"
pdf += "## 跨页表格\n\n| 行 | 内容 |\n| --- | --- |\n" + "".join(f"| {i} | 中文可搜索 table text |\n" for i in range(100))
pdf += "\n## 长代码行\n\n```text\n" + "long-code-" * 100 + "\n```\n"
(OUT / "pagination.md").write_text(pdf, encoding="utf-8")

manifest = {}
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.name != 'manifest.json':
        data = p.read_bytes()
        manifest[str(p.relative_to(OUT))] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f"Generated {len(manifest)} fixture files in {OUT}")
