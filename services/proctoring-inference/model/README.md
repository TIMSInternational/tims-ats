# Optional Hugging Face evaluation model

The optional detector is [`hustvl/yolos-tiny`](https://huggingface.co/hustvl/yolos-tiny),
Apache-2.0, pinned to commit `da86128da961944dd8e33bb7c1baea46ed0a4753`.
The published `model.safetensors` SHA-256 is
`5a6a017a20cb522dd347271fa5bd670467e456176aaccd940090e50985ac6e74`.
`Dockerfile.hf` fetches that immutable snapshot at **build time**, writes a
checksum manifest for every file, and verifies the bundle. Runtime loading is
local-only (`HF_HUB_OFFLINE=1`, `local_files_only=True`, `trust_remote_code=False`).
No model artifacts are downloaded in Lambda or sent to a Hugging Face service.

This model is a candidate for a labeled TIMS evaluation, not a validated
proctoring model. The deployed default keeps it disabled. Its person/phone
cues must not trigger alerts or assessment decisions until quality, fairness,
latency, and cost thresholds are approved.
