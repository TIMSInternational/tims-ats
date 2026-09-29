"""Read one sealed camera still, evaluate detectors, and publish bounded cues."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .contract import InferenceRequest, detector, parse_request, result_json
from .evidence import SourceDataError, read_camera_evidence
from .hf_detector import DETECTOR_REVISION, ModelUnavailable, detect_objects

REKOGNITION_REVISION = "aws-rekognition-detect-faces-v1"
MAX_FUTURE_EXPIRY = timedelta(days=7, minutes=5)
_BUCKET = re.compile(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\Z")
_REVISION = re.compile(r"[A-Za-z0-9._:+-]{1,120}\Z")


@dataclass(frozen=True)
class WorkerConfig:
    bucket: str
    result_queue_url: str
    model_revision: str
    region: str = "us-west-2"
    hf_enabled: bool = False
    model_dir: Path = Path("/opt/model")
    sealed_prefix: str = "sealed/"

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        bucket = os.environ.get("EVIDENCE_BUCKET", "")
        queue = os.environ.get("RESULT_QUEUE_URL", "")
        revision = os.environ.get("PROCTORING_MODEL_REVISION", "")
        region = os.environ.get("AWS_EVIDENCE_REGION", "")
        enabled_text = os.environ.get("HF_OBJECT_DETECTOR_ENABLED", "false").lower()
        prefix = os.environ.get("SEALED_PREFIX", "sealed/")
        if not _BUCKET.fullmatch(bucket):
            raise ValueError("invalid_evidence_bucket")
        if not queue.startswith("https://sqs.") or len(queue) > 500:
            raise ValueError("invalid_result_queue")
        if not _REVISION.fullmatch(revision):
            raise ValueError("invalid_model_revision")
        if region != "us-west-2":
            raise ValueError("invalid_evidence_region")
        if enabled_text not in {"true", "false"}:
            raise ValueError("invalid_hf_flag")
        if prefix != "sealed/":
            raise ValueError("invalid_sealed_prefix")
        return cls(
            bucket=bucket,
            result_queue_url=queue,
            model_revision=revision,
            region=region,
            hf_enabled=enabled_text == "true",
            model_dir=Path(os.environ.get("HF_MODEL_DIR", "/opt/model")),
            sealed_prefix=prefix,
        )


def _unavailable(name: str, revision: str, code: str) -> dict[str, Any]:
    return detector(name, revision, "unavailable", failure_code=code)


def _both_unavailable(code: str) -> list[dict[str, Any]]:
    return [
        _unavailable("rekognition_detect_faces", REKOGNITION_REVISION, code),
        _unavailable("hf_object_detector", DETECTOR_REVISION, code),
    ]


def _is_missing_object(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return False
    details = response.get("Error")
    return isinstance(details, dict) and details.get("Code") in {"NoSuchKey", "404", "NotFound"}


def infer(request: InferenceRequest, config: WorkerConfig, s3: Any, rekognition: Any, *, now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)

    def processed_at() -> datetime:
        return now or datetime.now(timezone.utc)
    if request.expires_at <= current:
        return result_json(request, _both_unavailable("expired"), now=processed_at())
    if request.expires_at - current > MAX_FUTURE_EXPIRY:
        return result_json(request, _both_unavailable("source_invalid"), now=processed_at())
    if request.model_revision != config.model_revision:
        return result_json(request, _both_unavailable("revision_mismatch"), now=processed_at())
    try:
        source = read_camera_evidence(s3, config.bucket, request.object_key, request.sha256)
    except SourceDataError as exc:
        return result_json(request, _both_unavailable(exc.code), now=processed_at())
    except Exception as exc:
        if _is_missing_object(exc):
            return result_json(request, _both_unavailable("source_unavailable"), now=processed_at())
        # Access-denied, timeout, throttling, and unexpected S3 failures retry
        # through SQS and then reach the DLQ; never report a false clear result.
        raise

    try:
        response = rekognition.detect_faces(
            Image={"Bytes": source.rekognition_bytes}, Attributes=["DEFAULT"]
        )
        faces = response["FaceDetails"]
        if not isinstance(faces, list) or len(faces) > 100:
            raise ValueError("invalid_rekognition_response")
        rekognition_result = detector(
            "rekognition_detect_faces",
            REKOGNITION_REVISION,
            "completed",
            [{"label": "face_count", "confidence": None, "count": len(faces)}],
        )
    except Exception:
        rekognition_result = _unavailable(
            "rekognition_detect_faces", REKOGNITION_REVISION, "rekognition_unavailable"
        )

    if not config.hf_enabled:
        hf_result = _unavailable("hf_object_detector", DETECTOR_REVISION, "disabled")
    else:
        try:
            findings = detect_objects(source.image, config.model_dir)
            hf_result = detector("hf_object_detector", DETECTOR_REVISION, "completed", findings)
        except ModelUnavailable as exc:
            hf_result = _unavailable("hf_object_detector", DETECTOR_REVISION, exc.code)
        except Exception:
            hf_result = _unavailable("hf_object_detector", DETECTOR_REVISION, "model_inference_failed")
    return result_json(request, [rekognition_result, hf_result], now=processed_at())


def process_message(body: str, config: WorkerConfig, s3: Any, rekognition: Any, sqs: Any) -> None:
    request = parse_request(body, sealed_prefix=config.sealed_prefix)
    result = infer(request, config, s3, rekognition)
    # Standard SQS may redeliver; the .NET consumer owns idempotency by
    # evidenceId + modelRevision and verifies the stored source SHA independently.
    sqs.send_message(QueueUrl=config.result_queue_url, MessageBody=result)
