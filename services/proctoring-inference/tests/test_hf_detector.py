import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from proctoring_inference import hf_detector


class ModelBundleTests(unittest.TestCase):
    def test_missing_bundle_fails_closed_without_importing_transformers(self):
        with tempfile.TemporaryDirectory() as location:
            with self.assertRaises(hf_detector.ModelUnavailable) as failure:
                hf_detector.verify_bundle(Path(location))
            self.assertEqual(failure.exception.code, "artifact_missing")

    def test_checks_all_local_artifact_hashes_before_load(self):
        with tempfile.TemporaryDirectory() as location:
            directory = Path(location)
            contents = {name: name.encode() for name in hf_detector.REQUIRED_FILES}
            hashes = {name: hashlib.sha256(value).hexdigest() for name, value in contents.items()}
            for name, value in contents.items():
                (directory / name).write_bytes(value)
            (directory / "manifest.json").write_text(json.dumps({
                "modelId": hf_detector.MODEL_ID,
                "revision": hf_detector.MODEL_COMMIT,
                "license": hf_detector.MODEL_LICENSE,
                "files": hashes,
            }))
            with patch.object(hf_detector, "MODEL_WEIGHTS_SHA256", hashes["model.safetensors"]):
                hf_detector.verify_bundle(directory)
                (directory / "config.json").write_bytes(b"changed")
                with self.assertRaises(hf_detector.ModelUnavailable) as failure:
                    hf_detector.verify_bundle(directory)
                self.assertEqual(failure.exception.code, "artifact_checksum_mismatch")


if __name__ == "__main__":
    unittest.main()
