# Markdown 编辑器排版参考

这是用于观察 Typora GitHub 主题的独立样本文档。正文同时包含中文与 English text，检查字体回退、行高、标点和段落间距。窗口缩放时，正文应维持舒适的阅读宽度。

## 标题与正文

一段普通正文，包含 **加粗文字**、*斜体文字*、~~删除线~~、`inline code` 和 [示例链接](https://example.com)。样式仅作用于呈现，不改变原始 Markdown 写法。

### 三级标题

> 引用区域用于观察左侧边线、缩进和文字颜色。

- 第一项：正文中的无序列表。
- 第二项：包含 `code` 的列表项。
  - 嵌套项目。

1. 有序列表第一项。
2. 有序列表第二项。

- [ ] 未完成任务
- [x] 已完成任务

## 代码与表格

```python
def render_markdown(source: str) -> str:
    """Keep Markdown as the document source."""
    return source
```

| 内容类型 | 编辑方式 | 保存格式 |
| --- | --- | --- |
| 正文与列表 | 单区实时编辑 | Markdown |
| 表格 | 单元格直接编辑 | Markdown |
| 数学公式 | LaTeX 表达式 | Markdown |

## 数学公式

行内公式：$E = mc^2$。以下为块级公式。

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

---

样本结束。
