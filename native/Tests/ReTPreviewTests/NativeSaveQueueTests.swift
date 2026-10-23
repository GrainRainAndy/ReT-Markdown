import XCTest
import AppKit
@testable import ReTPreview

final class NativeSaveQueueTests: RecoveryIsolatedTestCase {
 @MainActor func testSaveAsControlWithoutClose() async throws { try await runControl(autosave: false) }
 @MainActor func testSaveAsOverlappingNativeAutosave() async throws { try await runControl(autosave: true) }
 @MainActor func testQueuedNativeAutosaveWritesNewerInputAtSaveAsDestination() async throws { try await runControl(autosave: true, newerInput: true) }
 @MainActor private func runControl(autosave: Bool, newerInput: Bool = false) async throws {
  let document = try await attachEditor(source: "saved")
  let original = environment.root.appendingPathComponent("original.md")
  let target = environment.root.appendingPathComponent("copy.md")
  try Data("saved".utf8).write(to: original)
  document.fileURL = original
  document.fileType = "net.daringfireball.markdown"
  let window = NSWindow(contentRect:NSRect(x:0,y:0,width:400,height:300),styleMask:[.titled],backing:.buffered,defer:false)
  document.addWindowController(NSWindowController(window:window))
  DocumentTestEnvironment.controller.addDocument(document)
  defer { environment.close(document); DocumentTestEnvironment.controller.removeDocument(document) }
  _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'dirty');")
  try await eventually { document.state.received.source == "dirty" }
  var release: ((Result<Void,Error>) -> Void)?
  document.prepareAssetsForSave = { _,_,completion in
   if release == nil { release = completion } else { completion(.success(())) }
  }
  var committedSources: [String] = []
  document.didCommitSave = { _,snapshot in committedSources.append(snapshot.source) }
  var completions = 0, autosaveCompletions = 0
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); completions += 1 }
  try await eventually { release != nil }
  if autosave { document.autosave(withImplicitCancellability: false) { error in XCTAssertNil(error); autosaveCompletions += 1 } }
  if newerInput {
   _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'latest input');")
   try await eventually { document.state.received.source == "latest input" }
  }
  release?(.success(()))
  try await eventually { completions == 1 && (!autosave || autosaveCompletions == 1) }
  XCTAssertEqual(try Data(contentsOf:target),Data((newerInput ? "latest input" : "dirty").utf8))
  XCTAssertEqual(try Data(contentsOf:original),Data("saved".utf8))
  XCTAssertEqual(document.fileURL,target)
  XCTAssertFalse(document.state.isDirty)
  XCTAssertEqual(committedSources,newerInput ? ["dirty","latest input"] : ["dirty"])
  release?(.success(())) // duplicate preparation cannot commit twice
  XCTAssertEqual(completions,1)
  XCTAssertEqual(autosaveCompletions,autosave ? 1 : 0)
 }
 @MainActor func testManualSaveWaitsForAlreadyRequestedNativeAutosave() async throws {
  let document = try await attachEditor(source: "saved")
  defer { environment.close(document) }
  let original = environment.root.appendingPathComponent("original.md")
  let target = environment.root.appendingPathComponent("copy.md")
  try Data("saved".utf8).write(to:original)
  document.fileURL = original; document.fileType = "net.daringfireball.markdown"
  _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'new content');")
  try await eventually { document.state.received.source == "new content" }
  document.installAssetServices(document.host!)
  var autosaveCompletions = 0, redundantAutosaveCompletions = 0, saveCompletions = 0
  document.autosave(withImplicitCancellability:false) { error in XCTAssertNil(error); autosaveCompletions += 1 }
  document.autosave(withImplicitCancellability:true) { error in XCTAssertNil(error); redundantAutosaveCompletions += 1 }
  // AppKit may not yet have called the save override: its entire operation owns
  // the queue reservation, not only the eventual save(to:) call.
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); saveCompletions += 1 }
  try await eventually { autosaveCompletions == 1 && redundantAutosaveCompletions == 1 && saveCompletions == 1 }
  XCTAssertEqual(try Data(contentsOf:original),Data("new content".utf8))
  XCTAssertEqual(try Data(contentsOf:target),Data("new content".utf8))
  XCTAssertEqual(document.fileURL,target)
  XCTAssertFalse(document.state.isDirty)
 }
 @MainActor func testProductionAutosavePreflightFreezesSnapshotBeforeNewInputAndSaveAs() async throws {
  let document = try await attachEditor(source:"saved")
  defer { environment.close(document) }
  let original = environment.root.appendingPathComponent("original.md")
  let target = environment.root.appendingPathComponent("copy.md")
  try Data("saved".utf8).write(to:original)
  document.fileURL = original; document.fileType = "net.daringfireball.markdown"
  _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'first input');")
  try await eventually { document.state.received.source == "first input" }
  document.installAssetServices(document.host!)
  _ = try await evaluateEditor(document,"const receive=window.retNative.receive;window.retNative.receive=m=>{if(m.method==='collectAssets'){window.heldManifest=m;window.releaseManifest=()=>{window.retNative.receive=receive;receive(m)}}else receive(m)}")
  var autosaves = 0, saves = 0
  document.autosave(withImplicitCancellability:false) { error in
   XCTAssertNil(error); autosaves += 1
   XCTAssertEqual(try? Data(contentsOf:original),Data("first input".utf8))
   XCTAssertEqual(document.state.received.source,"later input")
   XCTAssertTrue(document.state.isDirty,"new input must remain dirty after saving the frozen preflight snapshot")
  }
  try await eventually { (try? await self.evaluateEditor(document,"return !!window.heldManifest")) as? Bool == true }
  _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'later input');")
  try await eventually { document.state.received.source == "later input" }
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); saves += 1 }
  _ = try await evaluateEditor(document,"window.releaseManifest()")
  try await eventually { autosaves == 1 && saves == 1 }
  XCTAssertEqual(try Data(contentsOf:original),Data("first input".utf8))
  XCTAssertEqual(try Data(contentsOf:target),Data("later input".utf8))
  XCTAssertEqual(document.fileURL,target)
  XCTAssertFalse(document.state.isDirty)
 }
 @MainActor func testUntitledNativeAutosavePreparesItsActualDestination() async throws {
  let document = try await attachEditor(source:"")
  defer { environment.close(document) }
  let autosaved = environment.root.appendingPathComponent("autosaved.md")
  try Data().write(to:autosaved)
  document.autosavedContentsFileURL = autosaved
  document.installAssetServices(document.host!)
  _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();document.execCommand('insertText',false,'untitled content');")
  try await eventually { document.state.received.source == "untitled content" }
  var completions = 0
  document.autosave(withImplicitCancellability:false) { error in XCTAssertNil(error); completions += 1 }
  try await eventually { completions == 1 }
  XCTAssertEqual(try Data(contentsOf:autosaved),Data("untitled content".utf8))
  XCTAssertNil(document.fileURL)
  XCTAssertTrue(document.state.isDirty,"autosave elsewhere is not a user Save As")
  XCTAssertEqual(document.assetTransaction?.target,autosaved)
 }
 @MainActor func testAutosaveRequiringUnmanagedAssetConfirmationCancelsWithoutWriting() async throws {
  let document = try await attachEditor(source:"![x](relative.png)")
  defer { environment.close(document) }
  let autosaved = environment.root.appendingPathComponent("autosaved.md")
  try Data("keep".utf8).write(to:autosaved)
  document.autosavedContentsFileURL = autosaved
  document.installAssetServices(document.host!)
  _ = try await evaluateEditor(document,"const e=document.querySelector('.ProseMirror');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'more');")
  try await eventually { document.state.isDirty }
  var completions = 0
  document.autosave(withImplicitCancellability:false) { error in
   XCTAssertEqual((error as? CocoaError)?.code,.userCancelled); completions += 1
  }
  try await eventually { completions == 1 }
  XCTAssertEqual(try Data(contentsOf:autosaved),Data("keep".utf8))
  XCTAssertNil(document.fileURL)
  XCTAssertTrue(document.state.isDirty)
 }
}
