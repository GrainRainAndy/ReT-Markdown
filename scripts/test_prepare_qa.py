import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import plistlib
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("prepare_qa", Path(__file__).with_name("prepare-qa.py"))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class QAIdentityTests(unittest.TestCase):
    def test_identity_stays_stable_across_versions_and_sources(self):
        original = dict(CFBundleIdentifier="net.ret-markdown.app", CFBundleShortVersionString="0.1.0")
        a = qa.qa_plist(original, Path("/old.app"), "a" * 64)
        b = qa.qa_plist(dict(original, CFBundleShortVersionString="0.2.0"), Path("/new.app"), "b" * 64)
        for key in ("CFBundleIdentifier", "CFBundleName", "CFBundleDisplayName"):
            self.assertEqual(a[key], b[key])
        self.assertEqual(a["CFBundleIdentifier"], "net.ret-markdown.qa")
        self.assertNotEqual(a["ReTQASourceIdentity"], b["ReTQASourceIdentity"])
        self.assertNotEqual(a["ReTQASourceBundlePath"], b["ReTQASourceBundlePath"])
        self.assertEqual(original["CFBundleIdentifier"], "net.ret-markdown.app")

    def test_requires_full_identity(self):
        with self.assertRaises(ValueError):
            qa.qa_plist({}, Path("/old.app"), "73ecd74c")

    def test_running_bundle_is_never_replaced_or_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.app"
            (source / "Contents").mkdir(parents=True)
            (source / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "ReTMarkdown"}))
            destination = Path(directory) / "QA.app"
            destination.mkdir()
            marker = destination / "untouched"
            marker.write_text("keep")
            with patch.object(qa, "running_pids", return_value=[123]), patch.object(qa.subprocess, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "quit it manually"):
                    qa.publish(source, "a" * 64, destination)
                run.assert_not_called()
            self.assertEqual(marker.read_text(), "keep")

    def test_process_match_uses_full_destination_path(self):
        from types import SimpleNamespace
        text = "123 /workspace/build/qa/ReT Markdown QA.app/Contents/MacOS/ReTMarkdown\n124 /old/QA.app/Contents/MacOS/ReTMarkdown\n"
        with patch.object(qa.subprocess, "run", return_value=SimpleNamespace(stdout=text)):
            self.assertEqual(qa.running_pids(Path("/workspace/build/qa/ReT Markdown QA.app")), [123])

    def test_process_inspection_failure_is_not_treated_as_no_process(self):
        import subprocess
        with patch.object(qa.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "ps")):
            with self.assertRaises(subprocess.CalledProcessError):
                qa.running_pids(qa.QA_PATH)


if __name__ == "__main__":
    unittest.main()
