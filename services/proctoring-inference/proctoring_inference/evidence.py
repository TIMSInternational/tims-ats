"""Bounded sealed-image reads; S3 metadata is not accepted as proof of content."""

from __future__ import annotations

import hashlib
import hmac
import io
import warnings
from dataclasses import dataclass
from typing import Any

MAX_CAMERA_BYTES = 2 * 1024 * 1024  # Match .NET ProctoringEvidencePolicy.MaximumCameraBytes.
MAX_REKOGNITION_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_EDGE = 4_096
MIN_EDGE = 64


class SourceDataError(ValueError):
    """The sealed object exists but cannot be safely used for inference."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CameraEvidence:
    image: Any  # PIL.Image.Image, kept local to this process.
    rekognition_bytes: bytes


def read_camera_evidence(s3: Any, bucket: str, key: str, expected_sha256: str) -> CameraEvidence:
    response = s3.get_object(Bucket=bucket, Key=key)
    declared_length = response.get("ContentLength")
    if type(declared_length) is not int or not 0 < declared_length <= MAX_CAMERA_BYTES:
        response["Body"].close()
        raise SourceDataError("source_invalid")
    body = response["Body"]
    try:
        raw = body.read(MAX_CAMERA_BYTES + 1)
    finally:
        body.close()
    if len(raw) != declared_length or len(raw) > MAX_CAMERA_BYTES:
        raise SourceDataError("source_invalid")
    digest = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(digest, expected_sha256):
        raise SourceDataError("source_checksum_mismatch")

    # Decode twice: verify catches truncated files; load enforces decompression
    # and dimension limits before invoking an external detector.
    from PIL import Image, ImageFile, UnidentifiedImageError

    ImageFile.LOAD_TRUNCATED_IMAGES = False
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                image_format = probe.format
                width, height = probe.size
                if image_format not in {"JPEG", "WEBP"} or not (
                    MIN_EDGE <= width <= MAX_EDGE and MIN_EDGE <= height <= MAX_EDGE
                ) or width * height > MAX_IMAGE_PIXELS:
                    raise SourceDataError("source_invalid")
                probe.verify()
            with Image.open(io.BytesIO(raw)) as decoded:
                decoded.load()
                image = decoded.convert("RGB")
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise SourceDataError("source_invalid") from exc

    if image_format == "JPEG":
        rekognition_bytes = raw
    else:
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=85, optimize=True)
        rekognition_bytes = output.getvalue()
    if not 0 < len(rekognition_bytes) <= MAX_REKOGNITION_BYTES:
        raise SourceDataError("source_invalid")
    return CameraEvidence(image=image, rekognition_bytes=rekognition_bytes)
