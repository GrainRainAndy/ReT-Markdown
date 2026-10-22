import AppKit
struct CommandDefinition: Decodable {
 let id: String, title: String, group: String, key: String
 let modifiers: [String]
 static func load(from url: URL? = Bundle.main.resourceURL?.appendingPathComponent("web/commands.json")) -> [CommandDefinition] {
  guard let url, let data = try? Data(contentsOf:url) else { return [] }
  return (try? JSONDecoder().decode([CommandDefinition].self,from:data)) ?? []
 }
}
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
  let definitions = CommandDefinition.load()
  func commands(_ menu: NSMenu, _ group: String) {
   for definition in definitions where definition.group == group {
    let entry = NSMenuItem(title:definition.title,action:#selector(MarkdownDocument.editorCommand(_:)),keyEquivalent:definition.key)
    entry.representedObject = definition.id
    entry.keyEquivalentModifierMask = [.command]
    if definition.modifiers.contains("shift") { entry.keyEquivalentModifierMask.insert(.shift) }
    if definition.modifiers.contains("alt") { entry.keyEquivalentModifierMask.insert(.option) }
    menu.addItem(entry)
   }
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
  commands(edit,"edit")
  edit.addItem(.separator())
  item(edit,"剪切",#selector(NSText.cut(_:)),"x"); item(edit,"拷贝",#selector(NSText.copy(_:)),"c")
  item(edit,"粘贴",#selector(NSText.paste(_:)),"v"); item(edit,"全选",#selector(NSText.selectAll(_:)),"a")
  let format = menu("格式"); commands(format,"format")
  let table = menu("表格"); commands(table,"table")
  let view = menu("显示"); commands(view,"view")
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
