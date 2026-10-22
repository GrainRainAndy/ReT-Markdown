import XCTest
import AppKit
@testable import ReTPreview

final class FlushBarrierTests: RecoveryIsolatedTestCase {
 @MainActor func testPendingFlushTimeoutCancelAndLateResponsesSettleOnce() async throws {
  let document = try await attachEditor(source:"saved")
  defer { environment.close(document) }
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));")
  var outcomes: [String:[Bool]] = [:]
  let host = document.host!
  let timed = host.flush(timeout:0.1) { outcomes["timed",default:[]].append((try? $0.get()) != nil) }!
  let cancelled = host.flush { outcomes["cancelled",default:[]].append((try? $0.get()) != nil) }!
  let first = host.flush { outcomes["first",default:[]].append((try? $0.get()) != nil) }!
  let second = host.flush { outcomes["second",default:[]].append((try? $0.get()) != nil) }!
  try await Task.sleep(nanoseconds:50_000_000)
  XCTAssertEqual(outcomes,[:],"pending status must not finish original callbacks")
  host.cancelFlush(cancelled)
  try await eventually { outcomes["timed"] == [false] }
  XCTAssertEqual(outcomes["cancelled"],[false])
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));")
  try await eventually { outcomes["first"] == [true] && outcomes["second"] == [true] }
  // Duplicate/stale ready messages must neither complete again nor adopt bytes.
  let arguments: [String:Any] = ["ids":[timed,cancelled,first,second],"documentId":document.state.documentID,"epoch":document.state.epoch]
  _ = try await evaluateEditor(document,"for(const requestId of ids) window.webkit.messageHandlers.ret.postMessage({v:1,documentId,epoch,requestId,method:'flushResult',payload:{status:'ready',source:'late overwrite',revision:99}})",arguments:arguments)
  try await Task.sleep(nanoseconds:100_000_000)
  XCTAssertEqual(outcomes,["timed":[false],"cancelled":[false],"first":[true],"second":[true]])
  XCTAssertEqual(document.state.received.source,"saved")
 }
 @MainActor func testSaveRequestedDuringCompositionWritesCommittedInputOnce() async throws {
  let document = try await attachEditor(source:"saved")
  defer { environment.close(document) }
  let target = environment.root.appendingPathComponent("composition.md")
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));")
  var completions = 0, commits = 0
  document.didCommitSave = { _,_ in commits += 1 }
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); completions += 1 }
  try await Task.sleep(nanoseconds:50_000_000)
  XCTAssertEqual(completions,0)
  XCTAssertFalse(FileManager.default.fileExists(atPath:target.path))
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror p').textContent='saved中文';")
  try await Task.sleep(nanoseconds:50_000_000)
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));")
  try await eventually { completions == 1 }
  XCTAssertEqual(commits,1)
  XCTAssertEqual(try String(contentsOf:target,encoding:.utf8),"saved中文")
  XCTAssertFalse(document.state.isDirty)
 }
 @MainActor func testStaleEpochDoesNotSettleOutstandingFlush() async throws {
  let document = try await attachEditor(source:"saved")
  defer { environment.close(document) }
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));")
  var results: [Bool] = []
  let id = document.host!.flush { results.append((try? $0.get()) != nil) }!
  _ = try await evaluateEditor(document,"window.webkit.messageHandlers.ret.postMessage({v:1,documentId,epoch:'stale-epoch',requestId,method:'flushResult',payload:{status:'ready',source:'bad',revision:99}})",arguments:["documentId":document.state.documentID,"requestId":id])
  try await Task.sleep(nanoseconds:50_000_000)
  XCTAssertTrue(results.isEmpty)
  _ = try await evaluateEditor(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));")
  try await eventually { results == [true] }
  XCTAssertEqual(document.state.received.source,"saved")
 }
}
