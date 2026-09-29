import hashlib
import io
import unittest

from PIL import Image

from proctoring_inference.evidence import (
    MAX_CAMERA_BYTES,
    SourceDataError,
    read_camera_evidence,
)


def image_bytes(format_name="JPEG"):
    image = Image.new("RGB", (128, 96), (60, 100, 140))
    output = io.BytesIO()
    image.save(output, format=format_name)
    return output.getvalue()


class FakeS3:
    def __init__(self, data, length=None):
        self.data = data
        self.length = len(data) if length is None else length
        self.calls = []

    def get_object(self, **args):
        self.calls.append(args)
        return {"ContentLength": self.length, "Body": io.BytesIO(self.data)}


class EvidenceTests(unittest.TestCase):
    def test_reads_hashed_jpeg_from_sealed_bucket(self):
        raw = image_bytes()
        s3 = FakeS3(raw)
        evidence = read_camera_evidence(s3, "private-bucket", "sealed/t/s/image.jpg", hashlib.sha256(raw).hexdigest())
        self.assertEqual(evidence.rekognition_bytes, raw)
        self.assertEqual(evidence.image.size, (128, 96))
        self.assertEqual(s3.calls, [{"Bucket": "private-bucket", "Key": "sealed/t/s/image.jpg"}])

    def test_converts_webp_locally_for_rekognition(self):
        raw = image_bytes("WEBP")
        evidence = read_camera_evidence(FakeS3(raw), "bucket", "sealed/image.webp", hashlib.sha256(raw).hexdigest())
        self.assertTrue(evidence.rekognition_bytes.startswith(b"\xff\xd8"))

    def test_rejects_checksum_mismatch_and_excess_bytes_before_inference(self):
        raw = image_bytes()
        with self.assertRaises(SourceDataError) as mismatch:
            read_camera_evidence(FakeS3(raw), "bucket", "sealed/image.jpg", "0" * 64)
        self.assertEqual(mismatch.exception.code, "source_checksum_mismatch")
        with self.assertRaises(SourceDataError) as oversize:
            read_camera_evidence(FakeS3(raw, length=MAX_CAMERA_BYTES + 1), "bucket", "sealed/image.jpg", hashlib.sha256(raw).hexdigest())
        self.assertEqual(oversize.exception.code, "source_invalid")

    def test_rejects_non_image_with_matching_checksum(self):
        raw = b"private arbitrary content"
        with self.assertRaises(SourceDataError) as invalid:
            read_camera_evidence(FakeS3(raw), "bucket", "sealed/image.jpg", hashlib.sha256(raw).hexdigest())
        self.assertEqual(invalid.exception.code, "source_invalid")


if __name__ == "__main__":
    unittest.main()
