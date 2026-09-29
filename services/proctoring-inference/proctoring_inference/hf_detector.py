"""Optional CPU object detector. It loads only a verified, image-bundled HF snapshot."""

from __future__ import annotations

import hashlib
import json
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

MODEL_ID = "hustvl/yolos-tiny"
MODEL_COMMIT = "da86128da961944dd8e33bb7c1baea46ed0a4753"
MODEL_LICENSE = "apache-2.0"
MODEL_WEIGHTS_SHA256 = "5a6a017a20cb522dd347271fa5bd670467e456176aaccd940090e50985ac6e74"
DETECTOR_REVISION = f"hustvl-yolos-tiny-{MODEL_COMMIT}"
REQUIRED_FILES = ("config.json", "preprocessor_config.json", "model.safetensors")
EVALUATION_THRESHOLD = 0.5  # Candidate for labeled evaluation; never an alert threshold.


class ModelUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def verify_bundle(directory: Path) -> None:
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        raise ModelUnavailable("artifact_missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if set(manifest) != {"modelId", "revision", "license", "files"}:
            raise ValueError("manifest_shape")
        if (manifest["modelId"], manifest["revision"], manifest["license"]) != (
            MODEL_ID, MODEL_COMMIT, MODEL_LICENSE
        ):
            raise ValueError("manifest_identity")
        hashes = manifest["files"]
        if not isinstance(hashes, dict) or set(hashes) != set(REQUIRED_FILES):
            raise ValueError("manifest_files")
        if hashes["model.safetensors"] != MODEL_WEIGHTS_SHA256:
            raise ValueError("weights_hash")
        for name in REQUIRED_FILES:
            expected = hashes[name]
            if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
                raise ValueError("file_hash")
            path = directory / name
            if not path.is_file() or path.is_symlink():
                raise ModelUnavailable("artifact_missing")
            digest = hashlib.sha256()
            with path.open("rb") as file:
                for chunk in iter(lambda: file.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                raise ValueError("file_checksum")
    except ModelUnavailable:
        raise
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as exc:
        raise ModelUnavailable("artifact_checksum_mismatch") from exc


@lru_cache(maxsize=1)
def _load_model(directory_text: str) -> tuple[Any, Any, Any]:
    directory = Path(directory_text)
    verify_bundle(directory)
    try:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import torch
        from transformers import AutoImageProcessor, AutoModelForObjectDetection

        torch.set_num_threads(1)
        processor = AutoImageProcessor.from_pretrained(
            directory_text, local_files_only=True, trust_remote_code=False, use_fast=False
        )
        model = AutoModelForObjectDetection.from_pretrained(
            directory_text, local_files_only=True, trust_remote_code=False, use_safetensors=True
        )
        model.eval()
        return processor, model, torch
    except Exception as exc:
        # Never include the path, imported module exception, or image in logs.
        raise ModelUnavailable("model_load_failed") from exc


def detect_objects(image: Any, directory: Path) -> list[dict[str, Any]]:
    processor, model, torch = _load_model(str(directory))
    try:
        with torch.inference_mode():
            inputs = processor(images=image, return_tensors="pt")
            outputs = model(**inputs)
            prediction = processor.post_process_object_detection(
                outputs,
                threshold=EVALUATION_THRESHOLD,
                target_sizes=torch.tensor([[image.height, image.width]]),
            )[0]
        scores: dict[str, list[float]] = {"person": [], "cell_phone": []}
        for score, label in zip(prediction["scores"], prediction["labels"]):
            name = model.config.id2label.get(int(label), "")
            key = "cell_phone" if name == "cell phone" else name
            confidence = float(score)
            if key in scores and math.isfinite(confidence) and 0 <= confidence <= 1:
                scores[key].append(confidence)
        return [
            {"label": label, "confidence": max(values), "count": min(len(values), 100)}
            for label, values in scores.items()
            if values
        ]
    except Exception as exc:
        raise ModelUnavailable("model_inference_failed") from exc
