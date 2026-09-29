"""Build-time only fetch of an immutable, license-pinned HF snapshot."""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from proctoring_inference.hf_detector import (
    MODEL_COMMIT,
    MODEL_ID,
    MODEL_LICENSE,
    MODEL_WEIGHTS_SHA256,
    REQUIRED_FILES,
)

_LIMITS = {
    "config.json": 64 * 1024,
    "preprocessor_config.json": 64 * 1024,
    "model.safetensors": 32 * 1024 * 1024,
}


def fetch_bundle(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    hashes: dict[str, str] = {}
    for name in REQUIRED_FILES:
        url = f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_COMMIT}/{name}"
        with urllib.request.urlopen(url, timeout=60) as response:
            content = response.read(_LIMITS[name] + 1)
        if not content or len(content) > _LIMITS[name]:
            raise RuntimeError("model_artifact_size_invalid")
        digest = hashlib.sha256(content).hexdigest()
        if name == "model.safetensors" and digest != MODEL_WEIGHTS_SHA256:
            raise RuntimeError("model_weights_checksum_mismatch")
        (destination / name).write_bytes(content)
        hashes[name] = digest
    manifest = {
        "modelId": MODEL_ID,
        "revision": MODEL_COMMIT,
        "license": MODEL_LICENSE,
        "files": hashes,
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: fetch_model.py DESTINATION")
    fetch_bundle(Path(sys.argv[1]))
