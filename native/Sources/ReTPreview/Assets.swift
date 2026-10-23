import AppKit
import ImageIO
import CryptoKit
import Darwin

struct ImageResource { let data: Data; let mimeType: String }
enum AssetFailure: LocalizedError {
 case invalid(String), unmanaged([String])
 var errorDescription: String? {
  switch self {
  case .invalid(let reason): return "图片操作失败：\(reason)"
  case .unmanaged(let paths): return "这些普通相对引用在新位置可能失效：\n" + paths.joined(separator: "\n")
  }
 }
}
enum ImageValidation {
 static let maximumBytes = 30 * 1024 * 1024
 static func validate(_ data: Data) throws -> (mime: String, ext: String) {
  guard !data.isEmpty, data.count <= maximumBytes else { throw AssetFailure.invalid("图片为空或超过 30 MB。") }
  if let text = String(data: data, encoding: .utf8), text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<") {
   let delegate = StaticSVG()
   guard !text.localizedCaseInsensitiveContains("<!DOCTYPE"), !text.localizedCaseInsensitiveContains("<!ENTITY") else { throw AssetFailure.invalid("SVG 含有外部实体。") }
   let parser = XMLParser(data: data); parser.shouldResolveExternalEntities = false; parser.delegate = delegate
   guard parser.parse(), delegate.safe, delegate.root else { throw AssetFailure.invalid("只支持安全的静态 SVG。") }
   return ("image/svg+xml", "svg")
  }
  guard let image = CGImageSourceCreateWithData(data as CFData, nil), let type = CGImageSourceGetType(image) as String?,
   let format = ["public.png":("image/png","png"), "public.jpeg":("image/jpeg","jpg"), "com.compuserve.gif":("image/gif","gif")][type],
   CGImageSourceGetCount(image) > 0, CGImageSourceGetCount(image) <= 1000 else { throw AssetFailure.invalid("仅支持 PNG、JPEG、GIF 和安全静态 SVG。") }
  var total = 0
  for i in 0..<CGImageSourceGetCount(image) {
   guard let props = CGImageSourceCopyPropertiesAtIndex(image, i, nil) as? [String: Any], let w = props[kCGImagePropertyPixelWidth as String] as? Int, let h = props[kCGImagePropertyPixelHeight as String] as? Int, w > 0, h > 0, w <= 32768, h <= 32768 else { throw AssetFailure.invalid("图片尺寸无效。") }
   total += w * h
   guard total <= 40_000_000 else { throw AssetFailure.invalid("图片解码像素超过 4000 万。") }
  }
  return format
 }
 static func clipboard(_ pasteboard: NSPasteboard = .general) throws -> (data: Data, name: String) {
  for (type, name) in [("public.png","clipboard.png"),("public.jpeg","clipboard.jpg"),("com.compuserve.gif","clipboard.gif"),("public.svg-image","clipboard.svg")] {
   if let data = pasteboard.data(forType: NSPasteboard.PasteboardType(type)) { _ = try validate(data); return (data,name) }
  }
  // AppKit commonly publishes copied screenshots as TIFF. Normalize into supported PNG.
  if let data = pasteboard.data(forType: .tiff) {
   guard data.count <= maximumBytes, let source = CGImageSourceCreateWithData(data as CFData, nil), let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any], let w = props[kCGImagePropertyPixelWidth as String] as? Int, let h = props[kCGImagePropertyPixelHeight as String] as? Int, w > 0, h > 0, w <= 32768, h <= 32768, w * h <= 40_000_000,
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw AssetFailure.invalid("剪贴板图片过大或无效。") }
   _ = try validate(png); return (png,"clipboard.png")
  }
  throw AssetFailure.invalid("剪贴板没有支持的图片。")
 }
 private final class StaticSVG: NSObject, XMLParserDelegate {
  var safe = true, root = false, depth = 0, count = 0
  let tags: Set<String> = ["svg","g","rect","path","circle","ellipse","line","polyline","polygon","defs","linearGradient","radialGradient","stop","clipPath","title","desc","text","tspan"]
  let attributes: Set<String> = ["xmlns","width","height","viewBox","version","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","d","points","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","opacity","transform","id","offset","stop-color","stop-opacity","gradientUnits","gradientTransform","font-family","font-size","text-anchor","dx","dy","preserveAspectRatio"]
  func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName qName: String?, attributes attrs: [String: String]) {
   if depth == 0 { root = name == "svg" }
   depth += 1; count += 1
   if depth > 64 || count > 100000 || !tags.contains(name) { safe = false }
   for (key,value) in attrs {
    if !attributes.contains(key) || value.localizedCaseInsensitiveContains("url(") || value.contains("&") || (key == "xmlns" && value != "http://www.w3.org/2000/svg") { safe = false }
   }
  }
  func parser(_ parser: XMLParser, didEndElement: String, namespaceURI: String?, qualifiedName: String?) { depth -= 1 }
  func parser(_ parser: XMLParser, foundProcessingInstructionWithTarget: String, data: String?) { safe = false }
 }
}

/// Persistent ownership journal. Paths stay stable across first save/SaveAs, so live
/// N+1 edits and undo history require no textual rewriting. Only frozen references copy.
final class AssetStore {
 struct Entry: Codable { var operationID: String; var path: String; var digest: String; var roots: [URL] }
 struct Transaction: Codable { let id: String; let target: URL; let snapshot: Snapshot; let paths: [String]; var committed: Bool }
 private struct Journal: Codable { var entries: [Entry] = []; var transactions: [Transaction] = []; var recoveredRoots: [URL] = [] }
 let directory: URL
 let documentID: String
 let token = UUID().uuidString.lowercased()
 private var journal: Journal
 private var journalURL: URL { directory.appendingPathComponent(documentID + ".json") }
 private var staging: URL { directory.appendingPathComponent(documentID, isDirectory: true) }
 init(directory: URL, documentID: String) throws {
  guard !documentID.isEmpty, documentID.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 }) else { throw AssetFailure.invalid("无效文稿身份。") }
  self.directory = directory; self.documentID = documentID
  let url = directory.appendingPathComponent(documentID + ".json")
  journal = FileManager.default.fileExists(atPath: url.path) ? try JSONDecoder().decode(Journal.self, from: Data(contentsOf: url)) : Journal()
 }
 private func persist() throws {
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
 }
 private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format:"%02x",$0) }.joined() }
 static func relative(_ value: String, decode: Bool = true) throws -> String {
  let path = decode ? (value.removingPercentEncoding ?? value) : value
  guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains(":"), !path.unicodeScalars.contains(where: { $0.value < 32 }), !path.split(separator:"/",omittingEmptySubsequences:false).contains(where: { $0 == ".." || $0 == "." || $0.isEmpty }) else { throw AssetFailure.invalid("不安全的资源路径。") }
  return path
 }
 /// Reject symlinks even when they happen to resolve inside the authorized root.
 static func authorized(_ path: String, root: URL) throws -> URL {
  let relative = try Self.relative(path, decode: false)
  let base = root.standardizedFileURL.resolvingSymlinksInPath()
  var current = base
  for component in relative.split(separator:"/") {
   current.appendPathComponent(String(component))
   if (try? current.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink) == true { throw AssetFailure.invalid("资源路径含有符号链接。") }
  }
  guard current.standardizedFileURL.path.hasPrefix(base.path + "/") else { throw AssetFailure.invalid("资源超出授权目录。") }
  return current
 }
 func importImage(_ data: Data, fileName: String, operationID: String, documentURL: URL?) throws -> String {
  let hash = digest(data)
  if let existing = journal.entries.first(where: {$0.operationID == operationID}) {
   guard existing.digest == hash else { throw AssetFailure.invalid("重复请求的内容不一致。") }
   let url = try Self.authorized(existing.path, root: existing.roots[0])
   if !FileManager.default.fileExists(atPath: url.path) { try install(data, path:existing.path,root:existing.roots[0],hash:hash) }
   guard digest(try Self.readAsset(existing.path,root:existing.roots[0])) == hash else { throw AssetFailure.invalid("已导入资源发生冲突。") }
   return existing.path
  }
  let type = try ImageValidation.validate(data)
  guard !fileName.contains("/"), !fileName.contains("\\"), fileName.utf8.count <= 1024 else { throw AssetFailure.invalid("文件名无效。") }
  let stem = (fileName as NSString).deletingPathExtension
  let name = String(stem.isEmpty ? "image" : stem).prefix(80) + "-" + UUID().uuidString.lowercased() + "." + type.ext
  let assetDirectory = documentURL.map { $0.deletingPathExtension().lastPathComponent + ".assets" } ?? (documentID + ".assets")
  let path = assetDirectory + "/" + name
  let root = documentURL?.deletingLastPathComponent() ?? staging
  _ = try Self.authorized(path, root: root)
  journal.entries.append(Entry(operationID:operationID,path:path,digest:hash,roots:[root]))
  try persist() // Intent precedes installation; crash/retry uses same operation and path.
  try install(data,path:path,root:root,hash:hash)
  return path
 }
 /// Descriptor-relative no-follow traversal prevents path/symlink races after validation.
 private static func parent<T>(_ path: String, root: URL, create: Bool, _ body: (Int32,String) throws -> T) throws -> T {
  let path = try relative(path,decode:false)
  let base = root.standardizedFileURL.resolvingSymlinksInPath()
  if create { try FileManager.default.createDirectory(at:base,withIntermediateDirectories:true) }
  var descriptor = open(base.path,O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
  guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue:errno) ?? .EACCES) }
  defer { Darwin.close(descriptor) }
  let components = path.split(separator:"/").map(String.init)
  for component in components.dropLast() {
   var next = openat(descriptor,component,O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
   if next < 0, errno == ENOENT, create {
    guard mkdirat(descriptor,component,0o755) == 0 || errno == EEXIST else { throw POSIXError(POSIXErrorCode(rawValue:errno) ?? .EIO) }
    next = openat(descriptor,component,O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
   }
   guard next >= 0 else { throw AssetFailure.invalid("资源目录无权限或含符号链接。") }
   Darwin.close(descriptor); descriptor = next
  }
  return try body(descriptor,components.last!)
 }
 private static func readAsset(_ path: String, root: URL) throws -> Data {
  try parent(path,root:root,create:false) { parent,name in
   let descriptor = openat(parent,name,O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
   guard descriptor >= 0 else { throw CocoaError(.fileReadNoPermission) }
   let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
   defer { try? file.close() }
   var stat = stat()
   guard fstat(descriptor,&stat) == 0, stat.st_mode & S_IFMT == S_IFREG, stat.st_size <= ImageValidation.maximumBytes else { throw AssetFailure.invalid("图片不是普通文件或超过 30 MB。") }
   let bytes = try file.read(upToCount:ImageValidation.maximumBytes+1) ?? Data()
   guard bytes.count <= ImageValidation.maximumBytes else { throw AssetFailure.invalid("图片超过 30 MB。") }
   return bytes
  }
 }
 private func install(_ data: Data, path: String, root: URL, hash: String) throws {
  if let existing = try? Self.readAsset(path,root:root) {
   guard digest(existing) == hash else { throw AssetFailure.invalid("目标资源已存在且内容不同：\(path)") }; return
  }
  try Self.parent(path,root:root,create:true) { parent,name in
   let temporary = ".ret-import-" + UUID().uuidString
   let descriptor = openat(parent,temporary,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,0o600)
   guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue:errno) ?? .EIO) }
   let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
   defer { try? file.close(); unlinkat(parent,temporary,0) }
   try file.write(contentsOf:data)
   guard fsync(descriptor) == 0 else { throw POSIXError(POSIXErrorCode(rawValue:errno) ?? .EIO) }
   // Exclusive rename installs a complete file atomically without requiring hard links.
   if renameatx_np(parent,temporary,parent,name,UInt32(RENAME_EXCL)) != 0 {
    guard errno == EEXIST, let existing = try? Self.readAsset(path,root:root), digest(existing) == hash else { throw AssetFailure.invalid("目标资源安装失败或名称冲突：\(path)") }
   }
  }
 }
 /// Markdown destinations and capability URL paths decode exactly once here.
 func resolve(path: String, documentURL: URL?) throws -> ImageResource {
  try resolveNormalizedPath(Self.relative(path),documentURL:documentURL)
 }
 /// Journal paths and already decoded manifests are filesystem names, not URI text.
 private func resolveNormalizedPath(_ path: String, documentURL: URL?) throws -> ImageResource {
  let path = try Self.relative(path,decode:false)
  var roots: [URL] = []
  if let entry = journal.entries.first(where: {$0.path == path}) { roots = entry.roots }
  else { roots = (documentURL.map {[$0.deletingLastPathComponent()]} ?? []) + journal.recoveredRoots }
  for root in roots {
   _ = try Self.authorized(path,root:root)
   if let data = try? Self.readAsset(path,root:root), let type = try? ImageValidation.validate(data) { return ImageResource(data:data,mimeType:type.mime) }
  }
  throw AssetFailure.invalid("找不到图片：\(path)")
 }
 func resolve(url: URL, documentURL: URL?) throws -> ImageResource {
  guard url.scheme == "ret-asset", url.host == token, url.query == nil, url.fragment == nil else { throw AssetFailure.invalid("资源能力已失效。") }
  return try resolve(path: String((URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "").dropFirst()), documentURL:documentURL)
 }
 func freeze(references: [String], documentURL: URL?) throws -> [String: ImageResource] {
  var result: [String: ImageResource] = [:], total = 0
  for reference in Set(references) {
   guard let path = try? Self.relative(reference), let image = try? resolveNormalizedPath(path,documentURL:documentURL) else { continue }
   total += image.data.count
   guard total <= 256 * 1024 * 1024 else { throw AssetFailure.invalid("导出资源超过 256 MB。") }
   result[path] = image
  }
  return result
 }
 func prepareSave(to target: URL, snapshot: Snapshot, references: [String], documentURL: URL?, acceptUnmanaged: Bool = false) throws -> Transaction {
  let paths = Set(references.compactMap { try? Self.relative($0) })
  let managed = Set(journal.entries.map(\.path))
  let targetRoot = target.deletingLastPathComponent()
  if targetRoot != documentURL?.deletingLastPathComponent(), !acceptUnmanaged {
   let risks = paths.subtracting(managed).filter { path in
    guard let old = try? resolveNormalizedPath(path,documentURL:documentURL) else { return true }
    guard let bytes = try? Self.readAsset(path,root:targetRoot) else { return true }
    return bytes != old.data
   }.sorted()
   if !risks.isEmpty { throw AssetFailure.unmanaged(risks) }
  }
  let selected = paths.intersection(managed).sorted()
  var transaction = journal.transactions.first(where: {$0.target == target && $0.snapshot == snapshot && $0.paths == selected}) ?? Transaction(id:UUID().uuidString,target:target,snapshot:snapshot,paths:selected,committed:false)
  transaction.committed = false
  journal.transactions.removeAll { $0.id == transaction.id || $0.target == target || $0.committed }; journal.transactions.append(transaction)
  try persist()
  for path in selected {
   let image = try resolveNormalizedPath(path,documentURL:documentURL)
   _ = try Self.authorized(path,root:targetRoot)
   try install(image.data,path:path,root:targetRoot,hash:digest(image.data))
  }
  return transaction
 }
 func commit(_ transaction: Transaction) throws {
  guard let i = journal.transactions.firstIndex(where: {$0.id == transaction.id}) else { throw AssetFailure.invalid("资源事务不存在。") }
  for n in journal.entries.indices where transaction.paths.contains(journal.entries[n].path) {
   let root = transaction.target.deletingLastPathComponent()
   journal.entries[n].roots.removeAll {$0 == root}; journal.entries[n].roots.insert(root,at:0)
  }
  journal.transactions[i].committed = true
  try persist()
  var identities = (try? JSONDecoder().decode([String:String].self,from:Data(contentsOf:directory.appendingPathComponent("documents.json")))) ?? [:]
  identities[transaction.target.standardizedFileURL.path] = documentID
  try JSONEncoder().encode(identities).write(to:directory.appendingPathComponent("documents.json"),options:.atomic)
 }
 func adopt(documentURL: URL) throws {
  guard journal.entries.isEmpty,
   let data = try? Data(contentsOf:directory.appendingPathComponent("documents.json")),
   let identities = try? JSONDecoder().decode([String:String].self,from:data) else { return }
  if let owner = identities[documentURL.standardizedFileURL.path], owner != documentID {
   try recover(from:owner,originalURL:documentURL); return
  }
  // A file may be renamed while the app is closed. Ownership is attached to managed
  // files in the already authorized document directory, rather than its old filename.
  let base = documentURL.deletingLastPathComponent().standardizedFileURL
  let owners = Set(identities.filter { URL(fileURLWithPath:$0.key).deletingLastPathComponent().standardizedFileURL == base }.values)
  for owner in owners where owner != documentID {
   let old = try AssetStore(directory:directory,documentID:owner)
   for entry in old.journal.entries where entry.roots.contains(where: {$0.standardizedFileURL == base}) && !journal.entries.contains(where: {$0.path == entry.path}) {
    journal.entries.append(Entry(operationID:entry.operationID,path:entry.path,digest:entry.digest,roots:[base]))
   }
  }
  if !journal.entries.isEmpty { try persist() }
 }
 /// Freeze the complete ownership/root mapping; later imports cannot alter this copy.
 func recoveryBinding(for id: String, originalURL: URL?) throws -> (URL, Data) {
  let target = try AssetStore(directory:directory, documentID:id)
  var snapshot = journal
  if let originalURL { snapshot.recoveredRoots.append(originalURL.deletingLastPathComponent()) }
  return (target.journalURL, try JSONEncoder().encode(snapshot))
 }
 func recover(from oldID: String, originalURL: URL?) throws {
  let old = try AssetStore(directory:directory,documentID:oldID)
  journal.entries = old.journal.entries
  journal.recoveredRoots = old.journal.recoveredRoots
  if let originalURL { journal.recoveredRoots.append(originalURL.deletingLastPathComponent()) }
  try persist()
 }
}

@MainActor extension MarkdownDocument {
 func assets() throws -> AssetStore {
  if let assetStore { return assetStore }
  let value = try AssetStore(directory:assetDirectory,documentID:state.documentID)
  if let fileURL { try value.adopt(documentURL:fileURL) }
  assetStore = value; return value
 }
 func installAssetServices(_ editor: EditorHost) {
  do { _ = try assets() } catch { report(error,operation:"assets") }
  editor.resolveAsset = { [weak self] url in
   guard let self, !self.closed else { throw CocoaError(.userCancelled) }
   let image = try self.assets().resolve(url:url,documentURL:self.fileURL)
   return (image.data,image.mimeType)
  }
  editor.onImportImage = { [weak self] envelope in self?.importImage(envelope) }
  editor.onSessionInvalidated = { [weak self] in self?.serviceGeneration += 1; self?.pdfExport?.cancel() }
  prepareAssetsForSave = { [weak self, weak editor] url,snapshot,completion in
   guard let self, let editor else { completion(.failure(CocoaError(.userCancelled))); return }
   let generation = self.serviceGeneration
   editor.collectAssets(for:snapshot) { [weak self] result in
    guard let self, !self.closed, self.serviceGeneration == generation else { completion(.failure(CocoaError(.userCancelled))); return }
    switch result {
    case .failure(let error): completion(.failure(error))
    case .success(let references): self.prepareAssetSave(url,snapshot:snapshot,references:references,generation:generation,accept:false,completion:completion)
    }
   }
  }
  preflightAssetsForAutosave = { [weak self, weak editor] snapshot,completion in
   guard let self, let editor else { completion(.failure(CocoaError(.userCancelled))); return }
   let generation = self.serviceGeneration
   editor.collectAssets(for:snapshot) { [weak self] result in
    guard let self, !self.closed, self.serviceGeneration == generation else { completion(.failure(CocoaError(.userCancelled))); return }
    switch result {
    case .failure(let error): completion(.failure(error))
    case .success(let references):
     completion(.success { [weak self] url,preparedSnapshot,finish in
      guard let self, !self.closed, self.serviceGeneration == generation, preparedSnapshot == snapshot else { finish(.failure(CocoaError(.userCancelled))); return }
      // AppKit resolves the autosave URL only after preflight. Keep target checks
      // and resource copies here, but never hold native file access for a sheet.
      self.prepareAssetSave(url,snapshot:snapshot,references:references,generation:generation,accept:false,allowConfirmation:false,completion:finish)
     })
    }
   }
  }
  didCommitSave = { [weak self] _,_ in
   guard let self, let transaction = self.assetTransaction else { return }
   do { try self.assets().commit(transaction); self.assetTransaction = nil }
   catch { self.report(error,operation:"assetJournal") }
  }
  pdfExport = PDFExportController(document:self,host:editor)
  editor.onExportPDF = { [weak self] in self?.pdfExport?.chooseDestination() }
  editor.onExportContent = { [weak self] envelope in self?.pdfExport?.receive(envelope) }
 }
 private func prepareAssetSave(_ target: URL, snapshot: Snapshot, references: [String], generation: Int, accept: Bool, allowConfirmation: Bool = true, completion: @escaping (Result<Void,Error>) -> Void) {
  guard !closed, serviceGeneration == generation else { completion(.failure(CocoaError(.userCancelled))); return }
  do {
   assetTransaction = try assets().prepareSave(to:target,snapshot:snapshot,references:references,documentURL:fileURL,acceptUnmanaged:accept)
   completion(.success(()))
  } catch AssetFailure.unmanaged(let paths) {
   guard allowConfirmation else { completion(.failure(CocoaError(.userCancelled))); return }
   guard let window = windowControllers.first?.window else { completion(.failure(AssetFailure.unmanaged(paths))); return }
   let alert = NSAlert(); alert.messageText = "另存后这些普通图片引用可能失效"
   alert.informativeText = paths.joined(separator:"\n") + "\n这些资源不会被复制。您可以取消，或明确保留原引用。"
   alert.addButton(withTitle:"取消"); alert.addButton(withTitle:"保留原引用并保存")
   alert.beginSheetModal(for:window) { [weak self] choice in
    guard let self, choice == .alertSecondButtonReturn else { completion(.failure(CocoaError(.userCancelled))); return }
    self.prepareAssetSave(target,snapshot:snapshot,references:references,generation:generation,accept:true,completion:completion)
   }
  } catch { completion(.failure(error)) }
 }
 private func importImage(_ envelope: BridgeEnvelope) {
  let generation = serviceGeneration
  let finish: (Result<(Data,String),Error>) -> Void = { [weak self] result in
   guard let self, !self.closed, self.serviceGeneration == generation else { return }
   do {
    let (data,name) = try result.get()
    let path = try self.assets().importImage(data,fileName:name,operationID:envelope.requestID,documentURL:self.fileURL)
    self.host?.send("assetResult",payload:["relativePath":path,"requestId":envelope.requestID],requestID:envelope.requestID)
   } catch {
    self.host?.send("assetResult",payload:["relativePath":"","requestId":envelope.requestID,"error":error.localizedDescription],requestID:envelope.requestID)
   }
  }
  if envelope.payload["source"] as? String == "clipboard" {
   do { let image = try ImageValidation.clipboard(); finish(.success((image.data,image.name))) } catch { finish(.failure(error)) }; return
  }
  if let dataURL = envelope.payload["dataURL"] as? String {
   guard let comma = dataURL.firstIndex(of:","), dataURL[..<comma].hasPrefix("data:image/"), dataURL[..<comma].hasSuffix(";base64"), let bytes = Data(base64Encoded:String(dataURL[dataURL.index(after:comma)...])) else { finish(.failure(AssetFailure.invalid("图片数据无效。"))); return }
   finish(.success((bytes,envelope.payload["fileName"] as? String ?? "image"))); return
  }
  guard let window = windowControllers.first?.window else { finish(.failure(CocoaError(.userCancelled))); return }
  let panel = NSOpenPanel(); panel.allowedContentTypes = [.png,.jpeg,.gif,.svg]; panel.allowsMultipleSelection = false; panel.canChooseDirectories = false
  panel.beginSheetModal(for:window) { response in
   guard response == .OK, let url = panel.url else { finish(.failure(CocoaError(.userCancelled))); return }
   let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
   do {
    let size = try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? Int.max
    guard size <= ImageValidation.maximumBytes else { throw AssetFailure.invalid("图片超过 30 MB。") }
    finish(.success((try Data(contentsOf:url),url.lastPathComponent)))
   } catch { finish(.failure(error)) }
  }
 }
}
