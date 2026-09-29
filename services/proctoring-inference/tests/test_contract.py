import hashlib
import json
import unittest
from datetime import datetime, timezone

from proctoring_inference.contract import ContractError, detector, parse_request, result_json


ID = "00000000-0000-4000-8000-000000000001"
ORG = "00000000-0000-4000-8000-000000000002"
SESSION = "00000000-0000-4000-8000-000000000003"
ATTEMPT = "0123456789abcdef0123456789abcdef"


def request(**changes):
    value = {
        "schemaVersion": 1,
        "organizationId": ORG,
        "evidenceId": ID,
        "objectKey": f"sealed/{ORG}/{SESSION}/{ID}/{hashlib.sha256(b'image').hexdigest()}.jpg",
        "sha256": hashlib.sha256(b"image").hexdigest(),
        "mediaType": "camera",
        "modelRevision": "proctoring-v1",
        "expiresAt": "2099-09-30T10:00:00Z",
    }
    value.update(changes)
    return json.dumps(value)


class ContractTests(unittest.TestCase):
    def test_parses_exact_camera_request(self):
        parsed = parse_request(request())
        self.assertEqual(parsed.evidence_id, ID)
        self.assertEqual(parsed.organization_id, ORG)
        self.assertEqual(parsed.object_key, f"sealed/{ORG}/{SESSION}/{ID}/{hashlib.sha256(b'image').hexdigest()}.jpg")

    def test_parses_unique_seal_attempt_and_rejects_invalid_suffix(self):
        digest = hashlib.sha256(b"image").hexdigest()
        attempt_key = f"sealed/{ORG}/{SESSION}/{ID}/{digest}-{ATTEMPT}.jpg"
        self.assertEqual(parse_request(request(objectKey=attempt_key)).object_key, attempt_key)
        for invalid in (f"{digest}-.jpg", f"{digest}-XYZ.jpg", f"{digest}-{ATTEMPT.upper()}.jpg"):
            with self.subTest(invalid=invalid), self.assertRaises(ContractError):
                parse_request(request(objectKey=f"sealed/{ORG}/{SESSION}/{ID}/{invalid}"))

    def test_rejects_unsafe_or_non_camera_messages(self):
        for body in (
            request(mediaType="screen"),
            request(objectKey="staging/tenant/image.jpg"),
            request(objectKey="sealed/../image.jpg"),
            request(objectKey="sealed/tenant//image.jpg"),
            request(objectKey=f"sealed/{ORG}/{SESSION}/00000000-0000-4000-8000-000000000099/{hashlib.sha256(b'image').hexdigest()}.jpg"),
            request(organizationId=SESSION),
            request(organizationId="invalid"),
            request(objectKey=f"sealed/{ORG}/{SESSION}/{ID}/{'0' * 64}.jpg"),
            request(sha256="AB" * 32),
            request(modelRevision=""),
            request(expiresAt="2026-09-30T10:00:00"),
            request(schemaVersion=True),
            request(candidateEmail="private@example.com"),
            request(objectKey="sealed/" + "a" * 600 + ".jpg"),
            "{" + '"schemaVersion":1,' * 2 + "}",
            "{}" + " " * 5_000,
        ):
            with self.subTest(body=body[:80]), self.assertRaises(ContractError):
                parse_request(body)

    def test_result_is_bounded_and_explicit_about_unavailable_detector(self):
        parsed = parse_request(request())
        detectors = [
            detector("rekognition_detect_faces", "aws-rekognition-detect-faces-v1", "completed", [
                {"label": "face_count", "confidence": None, "count": 1}
            ]),
            detector("hf_object_detector", "hustvl-yolos-tiny-rev", "unavailable", failure_code="disabled"),
        ]
        result = json.loads(result_json(parsed, detectors, now=datetime(2026, 9, 24, tzinfo=timezone.utc)))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["organizationId"], ORG)
        self.assertEqual(result["detectors"][1]["failureCode"], "disabled")
        self.assertEqual(result["processedAt"], "2026-09-24T00:00:00.000Z")
        self.assertNotIn("objectKey", result)

    def test_detector_rejects_nonfinite_or_unbounded_findings(self):
        for bad in (
            {"label": "face_count", "confidence": float("nan"), "count": 1},
            {"label": "a" * 33, "confidence": 0.5, "count": 1},
            {"label": "face_count", "confidence": 0.5, "count": -1},
        ):
            with self.subTest(bad=bad), self.assertRaises(ContractError):
                detector("rekognition_detect_faces", "v1", "completed", [bad])


if __name__ == "__main__":
    unittest.main()
