import hashlib
import io
import json
import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from proctoring_inference.contract import InferenceRequest
from proctoring_inference.worker import WorkerConfig, infer


def jpeg():
    output = io.BytesIO()
    Image.new("RGB", (128, 96), (10, 30, 50)).save(output, format="JPEG")
    return output.getvalue()


class FakeS3:
    def __init__(self, image):
        self.image = image
        self.calls = 0

    def get_object(self, **_args):
        self.calls += 1
        return {"ContentLength": len(self.image), "Body": io.BytesIO(self.image)}


class FakeRekognition:
    def __init__(self, faces=1, fail=False):
        self.faces = faces
        self.fail = fail
        self.calls = 0

    def detect_faces(self, **args):
        self.calls += 1
        assert args["Image"]["Bytes"].startswith(b"\xff\xd8")
        if self.fail:
            raise RuntimeError("private AWS details must not be logged")
        return {"FaceDetails": [{} for _ in range(self.faces)]}


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.image = jpeg()
        self.request = InferenceRequest(
            organization_id="00000000-0000-4000-8000-000000000002",
            evidence_id="00000000-0000-4000-8000-000000000001",
            object_key="sealed/tenant/session/image.jpg",
            sha256=hashlib.sha256(self.image).hexdigest(),
            model_revision="proctoring-v1",
            expires_at=datetime(2026, 9, 30, tzinfo=timezone.utc),
        )
        self.config = WorkerConfig(
            bucket="private-bucket",
            result_queue_url="https://sqs.us-west-2.amazonaws.com/123/result",
            model_revision="proctoring-v1",
        )
        self.now = datetime(2026, 9, 24, tzinfo=timezone.utc)

    def test_rekognition_count_and_explicit_disabled_hf(self):
        rekognition = FakeRekognition(faces=2)
        result = json.loads(infer(self.request, self.config, FakeS3(self.image), rekognition, now=self.now))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["organizationId"], self.request.organization_id)
        self.assertEqual(result["detectors"][0]["findings"], [{"label": "face_count", "confidence": None, "count": 2}])
        self.assertEqual(result["detectors"][1]["status"], "unavailable")
        self.assertEqual(result["detectors"][1]["failureCode"], "disabled")
        self.assertEqual(rekognition.calls, 1)

    def test_expiry_and_revision_mismatch_never_read_media(self):
        s3 = FakeS3(self.image)
        rekognition = FakeRekognition()
        expired = self.request.__class__(**{**vars(self.request), "expires_at": self.now})
        result = json.loads(infer(expired, self.config, s3, rekognition, now=self.now))
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["detectors"][0]["failureCode"], "expired")
        mismatched = self.request.__class__(**{**vars(self.request), "model_revision": "wrong-v1"})
        result = json.loads(infer(mismatched, self.config, s3, rekognition, now=self.now))
        self.assertEqual(result["detectors"][0]["failureCode"], "revision_mismatch")
        self.assertEqual(s3.calls, 0)
        self.assertEqual(rekognition.calls, 0)

    def test_unreasonably_long_expiry_never_reads_media(self):
        s3 = FakeS3(self.image)
        long_expiry = self.request.__class__(**{**vars(self.request), "expires_at": datetime(2099, 9, 30, tzinfo=timezone.utc)})
        result = json.loads(infer(long_expiry, self.config, s3, FakeRekognition(), now=self.now))
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(s3.calls, 0)

    def test_hash_failure_never_invokes_detector(self):
        s3 = FakeS3(self.image + b"changed")
        rekognition = FakeRekognition()
        result = json.loads(infer(self.request, self.config, s3, rekognition, now=self.now))
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["detectors"][0]["failureCode"], "source_checksum_mismatch")
        self.assertEqual(rekognition.calls, 0)

    def test_rekognition_failure_is_unavailable_not_clear(self):
        result = json.loads(infer(self.request, self.config, FakeS3(self.image), FakeRekognition(fail=True), now=self.now))
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["detectors"][0]["failureCode"], "rekognition_unavailable")

    def test_hf_is_fail_closed_without_bundle_and_can_return_bounded_cues(self):
        config = WorkerConfig(**{**vars(self.config), "hf_enabled": True, "model_dir": Path("/definitely/missing")})
        result = json.loads(infer(self.request, config, FakeS3(self.image), FakeRekognition(), now=self.now))
        self.assertEqual(result["detectors"][1]["failureCode"], "artifact_missing")
        with patch("proctoring_inference.worker.detect_objects", return_value=[
            {"label": "person", "confidence": 0.75, "count": 1},
            {"label": "cell_phone", "confidence": 0.8, "count": 1},
        ]):
            result = json.loads(infer(self.request, config, FakeS3(self.image), FakeRekognition(), now=self.now))
        self.assertEqual(result["detectors"][1]["status"], "completed")
        self.assertEqual([item["label"] for item in result["detectors"][1]["findings"]], ["person", "cell_phone"])

    def test_env_configuration_matches_terraform_names(self):
        with patch.dict(os.environ, {
            "EVIDENCE_BUCKET": "private-bucket",
            "RESULT_QUEUE_URL": "https://sqs.us-west-2.amazonaws.com/123/result",
            "PROCTORING_MODEL_REVISION": "proctoring-v1",
            "AWS_EVIDENCE_REGION": "us-west-2",
        }, clear=True):
            config = WorkerConfig.from_env()
        self.assertFalse(config.hf_enabled)
        self.assertEqual(config.region, "us-west-2")


if __name__ == "__main__":
    unittest.main()
