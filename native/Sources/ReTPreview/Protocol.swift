import Foundation
import CoreFoundation
struct BridgeEnvelope {
 let requestID: String
 let method: String
 let payload: [String: Any]
 static func integer(_ value: Any?) -> Int? {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 9_007_199_254_740_991, number.doubleValue.rounded() == number.doubleValue else { return nil }
  return number.intValue
 }
 static func parse(_ body: Any, trusted: Bool, documentID: String, epoch: String) -> Self? {
  guard trusted, let object = body as? [String: Any], integer(object["v"]) == 1,
   let doc = object["documentId"] as? String, let session = object["epoch"] as? String,
   let id = object["requestId"] as? String, !id.isEmpty, id.utf8.count <= 128,
   let method = object["method"] as? String, let payload = object["payload"] as? [String: Any] else { return nil }
  let matching = doc == documentID && session == epoch
  guard matching || (method == "ready" && doc.isEmpty && session.isEmpty) else { return nil }
  func snapshotValid() -> Bool { (payload["source"] as? String).map { $0.utf8.count <= 32 * 1024 * 1024 } == true && integer(payload["revision"]) != nil }
  switch method {
  case "ready", "save", "saveAs", "exportPDF", "open", "new": guard payload.isEmpty else { return nil }
  case "checkpoint":
   guard snapshotValid(), let dirty = payload["dirty"] as? NSNumber, CFGetTypeID(dirty) == CFBooleanGetTypeID() else { return nil }
   if let resolution = payload["resolvesRecoveryDraft"] { guard let flag = resolution as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { return nil } }
  case "recoveryDraft":
   guard Set(payload.keys) == ["draft"], let draft = payload["draft"], draft is NSNull || RecoveryDraft.parse(draft) != nil else { return nil }
  case "flushResult":
   guard let status = payload["status"] as? String else { return nil }
   if status == "ready" { guard snapshotValid() else { return nil } }
   else if status == "pending" { guard let reason = payload["reason"] as? String, reason.utf8.count <= 1024 else { return nil } }
   else { return nil }
  case "importImage":
   guard Set(payload.keys).isSubset(of: ["dataURL", "fileName"]) else { return nil }
   if let data = payload["dataURL"] { guard let text = data as? String, text.utf8.count <= 40 * 1024 * 1024 else { return nil } }
   if let name = payload["fileName"] { guard let text = name as? String, text.utf8.count <= 1024 else { return nil } }
  case "exportContent": guard let html = payload["html"] as? String, html.utf8.count <= 64 * 1024 * 1024, integer(payload["revision"]) != nil else { return nil }
  default: return nil
  }
  return Self(requestID: id, method: method, payload: payload)
 }
}
enum HostFailure: LocalizedError {
 case unavailable(String), pending(String), stale, externalConflict
 var errorDescription: String? {
  switch self {
  case .unavailable(let reason): return reason
  case .pending(let reason): return "输入尚未提交：\(reason)。请完成输入后重试。"
  case .stale: return "编辑器返回了过期版本；文稿没有保存。"
  case .externalConflict: return "磁盘上的文件已改变。请先处理外部版本，或另存本地副本。"
  }
 }
}
