"""Bounded v1 SQS messages. No candidate identity or raw media crosses this queue."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = 1
MAX_REQUEST_BYTES = 4_096
MAX_RESULT_BYTES = 8_192
MAX_KEY_LENGTH = 512
MAX_REVISION_LENGTH = 120
MAX_FINDINGS = 8

_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_REVISION = re.compile(r"[A-Za-z0-9._:+-]{1,120}\Z")
_KEY = re.compile(r"[A-Za-z0-9/_.-]{1,512}\Z")
_REQUEST_FIELDS = frozenset(
    {"schemaVersion", "organizationId", "evidenceId", "objectKey", "sha256", "mediaType", "modelRevision", "expiresAt"}
)
_RESULT_FIELDS = frozenset(
    {"schemaVersion", "organizationId", "evidenceId", "sha256", "modelRevision", "status", "detectors", "processedAt"}
)
_DETECTOR_NAMES = frozenset({"rekognition_detect_faces", "hf_object_detector"})
_STATUS = frozenset({"completed", "unavailable"})
_FAILURE_CODES = frozenset(
    {
        "disabled",
        "expired",
        "revision_mismatch",
        "source_unavailable",
        "source_invalid",
        "source_checksum_mismatch",
        "rekognition_unavailable",
        "artifact_missing",
        "artifact_checksum_mismatch",
        "model_load_failed",
        "model_inference_failed",
    }
)


class ContractError(ValueError):
    """Reject a malformed or over-sized queue message before any side effect."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ContractError("duplicate_json_field")
        value[key] = item
    return value


def _reject_constant(_value: str) -> None:
    raise ContractError("nonfinite_json_number")


def _load(raw: str | bytes, limit: int) -> dict[str, Any]:
    if not isinstance(raw, (str, bytes)) or len(raw.encode("utf-8") if isinstance(raw, str) else raw) > limit:
        raise ContractError("message_too_large")
    try:
        parsed = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    except (UnicodeError, json.JSONDecodeError, TypeError) as exc:
        raise ContractError("invalid_json") from exc
    if not isinstance(parsed, dict):
        raise ContractError("invalid_shape")
    return parsed


def _utc_datetime(value: Any) -> datetime:
    if not isinstance(value, str) or len(value) > 40:
        raise ContractError("invalid_utc_time")
    if not (value.endswith("Z") or value.endswith("+00:00")):
        raise ContractError("invalid_utc_time")
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError("invalid_utc_time") from exc
    if instant.utcoffset() != timezone.utc.utcoffset(instant):
        raise ContractError("invalid_utc_time")
    return instant


def _uuid(value: Any) -> str:
    if not isinstance(value, str) or len(value) != 36:
        raise ContractError("invalid_evidence_id")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ContractError("invalid_evidence_id") from exc
    if str(parsed) != value:
        raise ContractError("invalid_evidence_id")
    return value


def _sha256(value: Any) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ContractError("invalid_sha256")
    return value


def _revision(value: Any) -> str:
    if not isinstance(value, str) or not _REVISION.fullmatch(value):
        raise ContractError("invalid_model_revision")
    return value


def _object_key(value: Any, sealed_prefix: str, organization_id: str, evidence_id: str, sha256: str) -> str:
    if not isinstance(value, str) or not _KEY.fullmatch(value) or len(value) > MAX_KEY_LENGTH:
        raise ContractError("invalid_object_key")
    if not value.startswith(sealed_prefix) or value.startswith("/") or "//" in value:
        raise ContractError("invalid_object_key")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise ContractError("invalid_object_key")
    parts = value.split("/")
    if len(parts) != 5 or parts[0] != sealed_prefix.removesuffix("/"):
        raise ContractError("invalid_object_key")
    try:
        _uuid(parts[1])
        _uuid(parts[2])
        _uuid(parts[3])
    except ContractError as exc:
        raise ContractError("invalid_object_key") from exc
    filename = parts[4]
    legacy_name = filename in {f"{sha256}.jpg", f"{sha256}.webp"}
    attempt_name = re.fullmatch(rf"{sha256}-[0-9a-f]{{32}}\.(?:jpg|webp)", filename) is not None
    if parts[1] != organization_id or parts[3] != evidence_id or not (legacy_name or attempt_name):
        raise ContractError("invalid_object_key")
    return value


@dataclass(frozen=True)
class InferenceRequest:
    organization_id: str
    evidence_id: str
    object_key: str
    sha256: str
    model_revision: str
    expires_at: datetime


def parse_request(raw: str | bytes, *, sealed_prefix: str = "sealed/") -> InferenceRequest:
    value = _load(raw, MAX_REQUEST_BYTES)
    if frozenset(value) != _REQUEST_FIELDS or type(value["schemaVersion"]) is not int or value["schemaVersion"] != SCHEMA_VERSION:
        raise ContractError("invalid_request_schema")
    if value["mediaType"] != "camera":
        raise ContractError("unsupported_media_type")
    organization_id = _uuid(value["organizationId"])
    evidence_id = _uuid(value["evidenceId"])
    sha256 = _sha256(value["sha256"])
    return InferenceRequest(
        organization_id=organization_id,
        evidence_id=evidence_id,
        object_key=_object_key(value["objectKey"], sealed_prefix, organization_id, evidence_id, sha256),
        sha256=sha256,
        model_revision=_revision(value["modelRevision"]),
        expires_at=_utc_datetime(value["expiresAt"]),
    )


def utc_now_text(now: datetime | None = None) -> str:
    instant = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def detector(
    name: str,
    revision: str,
    status: str,
    findings: list[dict[str, Any]] | None = None,
    failure_code: str | None = None,
) -> dict[str, Any]:
    if name not in _DETECTOR_NAMES or status not in _STATUS:
        raise ContractError("invalid_detector")
    _revision(revision)
    if failure_code not in _FAILURE_CODES | {None}:
        raise ContractError("invalid_failure_code")
    if status == "completed" and failure_code is not None:
        raise ContractError("completed_detector_has_failure")
    if status == "unavailable" and failure_code is None:
        raise ContractError("unavailable_detector_missing_failure")
    items = findings or []
    if len(items) > MAX_FINDINGS or (status == "unavailable" and items):
        raise ContractError("invalid_findings")
    for item in items:
        if set(item) != {"label", "confidence", "count"}:
            raise ContractError("invalid_finding")
        label, confidence, count = item["label"], item["confidence"], item["count"]
        if not isinstance(label, str) or not re.fullmatch(r"[a-z_]{1,32}", label):
            raise ContractError("invalid_finding")
        if confidence is not None and (type(confidence) not in (float, int) or not 0 <= confidence <= 1):
            raise ContractError("invalid_finding")
        if count is not None and (type(count) is not int or not 0 <= count <= 100):
            raise ContractError("invalid_finding")
    return {
        "name": name,
        "revision": revision,
        "status": status,
        "findings": items,
        "failureCode": failure_code,
    }


def result_json(request: InferenceRequest, detectors: list[dict[str, Any]], *, now: datetime | None = None) -> str:
    if len(detectors) != 2 or {item["name"] for item in detectors} != _DETECTOR_NAMES:
        raise ContractError("invalid_detector_set")
    for item in detectors:
        detector(item["name"], item["revision"], item["status"], item["findings"], item["failureCode"])
    rekognition = next(item for item in detectors if item["name"] == "rekognition_detect_faces")
    value = {
        "schemaVersion": SCHEMA_VERSION,
        "organizationId": request.organization_id,
        "evidenceId": request.evidence_id,
        "sha256": request.sha256,
        "modelRevision": request.model_revision,
        "status": "completed" if rekognition["status"] == "completed" else "unavailable",
        "detectors": detectors,
        "processedAt": utc_now_text(now),
    }
    if frozenset(value) != _RESULT_FIELDS:
        raise ContractError("invalid_result_schema")
    encoded = json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > MAX_RESULT_BYTES:
        raise ContractError("result_too_large")
    return encoded
