import AppKit
@MainActor enum Menus {
 static func install() {
  let root = NSMenu()
  func menu(_ title: String) -> NSMenu {
   let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
   let submenu = NSMenu(title: title); item.submenu = submenu; root.addItem(item); return submenu
  }
  func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command) {
   let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
   entry.keyEquivalentModifierMask = modifiers; menu.addItem(entry)
  }
  func command(_ menu: NSMenu, _ title: String, _ id: String, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command) {
   let entry = NSMenuItem(title: title, action: #selector(MarkdownDocument.editorCommand(_:)), keyEquivalent: key)
   entry.representedObject = id; entry.keyEquivalentModifierMask = modifiers; menu.addItem(entry)
  }
  let app = menu("ReT Markdown Preview")
  item(app, "关于 ReT Markdown Preview", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
  app.addItem(.separator()); item(app, "隐藏 ReT Markdown Preview", #selector(NSApplication.hide(_:)), "h")
  item(app, "退出 ReT Markdown Preview", #selector(NSApplication.terminate(_:)), "q")
  let file = menu("文件")
  item(file, "新建", #selector(NSDocumentController.newDocument(_:)), "n")
  item(file, "打开…", #selector(NSDocumentController.openDocument(_:)), "o")
  file.addItem(.separator()); item(file, "关闭", #selector(NSWindow.performClose(_:)), "w")
  item(file, "保存", #selector(NSDocument.save(_:)), "s")
  item(file, "另存为…", #selector(NSDocument.saveAs(_:)), "s", [.command, .shift])
  item(file, "恢复到已存版本…", #selector(NSDocument.revertToSaved(_:)))
  item(file, "导出 PDF…", #selector(MarkdownDocument.exportPDF(_:)), "p", [.command, .shift])
  let edit = menu("编辑")
  command(edit, "撤销", "undo", "z"); command(edit, "重做", "redo", "z", [.command,.shift])
  edit.addItem(.separator())
  item(edit, "剪切", #selector(NSText.cut(_:)), "x"); item(edit, "拷贝", #selector(NSText.copy(_:)), "c")
  item(edit, "粘贴", #selector(NSText.paste(_:)), "v"); item(edit, "全选", #selector(NSText.selectAll(_:)), "a")
  command(edit, "拷贝 Markdown", "copyMarkdown"); command(edit, "拷贝纯文本", "copyPlain"); command(edit, "拷贝富文本", "copyRich")
  edit.addItem(.separator()); command(edit, "查找", "find", "f"); command(edit, "替换", "replace", "f", [.command,.option])
  let format = menu("格式")
  command(format, "加粗", "bold", "b"); command(format, "斜体", "italic", "i"); command(format, "链接", "link", "k")
  format.addItem(.separator())
  for level in 1...6 { command(format, "标题 \(level)", "heading\(level)", String(level)) }
  format.addItem(.separator())
  for (title,id) in [("无序列表","bulletList"),("有序列表","orderedList"),("引用","quote"),("代码块","codeBlock"),("数学块","mathBlock"),("表格","table"),("插入图片…","insertImage")] { command(format,title,id) }
  command(format, "代码语言…", "codeLanguage"); command(format, "行内公式源码…", "inlineMathSource")
  let table = menu("表格")
  for (title,id) in [("选取单元格区域","tableSelectCells"),("插入行","tableAddRow"),("删除行","tableDeleteRow"),("插入列","tableAddColumn"),("删除列","tableDeleteColumn"),("靠左对齐","tableAlignLeft"),("居中对齐","tableAlignCenter"),("靠右对齐","tableAlignRight")] { command(table,title,id) }
  let view = menu("显示")
  command(view, "切换源码", "toggleSource", "/")
  for (title, mode) in [("跟随系统","system"),("浅色","light"),("深色","dark")] {
   let entry = NSMenuItem(title:title,action:#selector(MarkdownDocument.changeAppearance(_:)),keyEquivalent:"")
   entry.representedObject = mode; view.addItem(entry)
  }
  let window = menu("窗口")
  item(window, "最小化", #selector(NSWindow.performMiniaturize(_:)), "m")
  item(window, "缩放", #selector(NSWindow.performZoom(_:)))
  NSApp.windowsMenu = window; NSApp.mainMenu = root
 }
}
extension MarkdownDocument {
 @objc func editorCommand(_ sender: NSMenuItem) { if let id = sender.representedObject as? String { host?.command(id) } }
 @objc func exportPDF(_ sender: Any?) { host?.requestExport() }
 @objc func changeAppearance(_ sender: NSMenuItem) {
  guard let mode = sender.representedObject as? String else { return }
  windowControllers.first?.window?.appearance = mode == "system" ? nil : NSAppearance(named: mode == "dark" ? .darkAqua : .aqua)
  host?.send("appearance", payload:["mode":mode])
 }
}
