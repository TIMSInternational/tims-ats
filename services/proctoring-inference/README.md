# TIMS ATS proctoring inference worker

This is a separate Python Lambda container. The .NET 10 API authorizes and
seals candidate evidence, owns the database, consumes results, and makes all
review decisions. This worker has no database credentials. It reads only
sealed **camera** stills from the private S3 bucket, computes a cloud face
count with AWS Rekognition, and publishes bounded observations to the result
queue. Screen stills remain human-review material and must not be queued here.

The default [`Dockerfile`](Dockerfile) is the low-cost beta image: Rekognition
only, no model server or idle GPU. The optional [`Dockerfile.hf`](Dockerfile.hf)
bundles a pinned Apache-2.0 Hugging Face YOLOS-tiny evaluation candidate at
build time. It still returns `hf_object_detector: unavailable/disabled` unless
`HF_OBJECT_DETECTOR_ENABLED=true` is explicitly set. No model cue should
trigger an adverse decision or staff alert until a labeled TIMS validation
study and thresholds are approved. There is no runtime download or image
transfer to Hugging Face; the optional model reads local files only.

## Queue contract (v1)

An SQS request body must be UTF-8 JSON of at most 4 KiB, with exactly these
camelCase fields:

```json
{
  "schemaVersion": 1,
  "organizationId": "00000000-0000-4000-8000-000000000002",
  "evidenceId": "00000000-0000-4000-8000-000000000001",
  "objectKey": "sealed/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000001/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.jpg",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "mediaType": "camera",
  "modelRevision": "proctoring-v1",
  "expiresAt": "2026-10-01T10:00:00Z"
}
```

`EVIDENCE_BUCKET` comes from the Lambda environment; a queue message cannot
choose a bucket. The key must be the exact .NET `sealed/{orgId:D}/{sessionId:D}/{evidenceId:D}/{sha256}.jpg|webp` shape, with the organization ID, evidence ID, and hash matching the other request fields. The
worker refuses expired or mismatched-revision requests before reading S3.
It reads at most 2 MiB, verifies the supplied SHA-256 against the actual
object bytes, decodes with image-size limits, and converts WebP locally to
JPEG for Rekognition. Corrupt or changed media yields `unavailable`, never a
clean inference result.

Results are at most 8 KiB and contain only the organization ID as a tenant
scope hint; they contain no candidate, raw image, face landmark, or object key:

```json
{
  "schemaVersion": 1,
  "organizationId": "00000000-0000-4000-8000-000000000002",
  "evidenceId": "00000000-0000-4000-8000-000000000001",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "modelRevision": "proctoring-v1",
  "status": "completed",
  "detectors": [
    {
      "name": "rekognition_detect_faces",
      "revision": "aws-rekognition-detect-faces-v1",
      "status": "completed",
      "findings": [{"label": "face_count", "confidence": null, "count": 1}],
      "failureCode": null
    },
    {
      "name": "hf_object_detector",
      "revision": "hustvl-yolos-tiny-da86128da961944dd8e33bb7c1baea46ed0a4753",
      "status": "unavailable",
      "findings": [],
      "failureCode": "disabled"
    }
  ],
  "processedAt": "2026-09-24T10:01:00.000Z"
}
```

The overall status is `completed` only when Rekognition completes. Disabled,
missing, or failed HF inference is explicitly `unavailable`; it is never
interpreted as clear. The .NET consumer must load evidence by ID, check its
stored SHA-256, expected model revision, processing state and expiry, and
apply idempotency across standard-queue redelivery. A changed or malformed
request goes to the request DLQ after the configured retries. The consumer
must use `organizationId` only to enter tenant scope, then check the evidence
row and its organization independently. A result-queue
send failure returns that record in Lambda `batchItemFailures` so SQS retries
it. Terraform must set the event source's `ReportBatchItemFailures` response
type.

## Build and test

```bash
cd services/proctoring-inference
python3 -m unittest discover -s tests -v
python3 -m compileall -q proctoring_inference scripts tests
docker buildx build --platform linux/amd64 -f Dockerfile \
  -t tims-proctoring-inference:amd64 --load .
```

The optional model image uses `Dockerfile.hf`. Its build downloads only the
three files at the pinned Hugging Face commit, verifies the published
`model.safetensors` SHA-256, and writes/verifies a manifest for every bundled
file. It uses the official PyTorch CPU wheel; it has a larger image and cold
start than the default. Run a measured latency, memory, accuracy, fairness,
and per-assessment cost benchmark before enabling it. Pin the final image by
digest in the Terraform variable; keep model inference off by default.

The Python package versions, including transitive application dependencies,
are exact in the requirements files; the Lambda base image supplies its own
runtime packages. The final container image digest and SBOM must be recorded
during the deployment gate. This code and mocked unit tests do not
prove AWS permissions, model accuracy, real-device capture quality, or live
cost. Run an AWS staging smoke test and the 25-concurrent-candidate protocol
from the [architecture plan](../../docs/architecture/2026-09-24-proctoring-ai-target.md)
before activating an external beta.

Required Lambda environment: `EVIDENCE_BUCKET`, `RESULT_QUEUE_URL`,
`PROCTORING_MODEL_REVISION`, and `AWS_EVIDENCE_REGION=us-west-2`. Optional
`HF_OBJECT_DETECTOR_ENABLED` defaults to `false`; `HF_MODEL_DIR` defaults to
`/opt/model`. IAM must permit only sealed-key S3 reads/decrypt, Rekognition
DetectFaces, result-queue send, request-queue receive, and own CloudWatch logs.
Logs contain only generic stage/failure codes, never queue bodies, S3 keys,
exception text, or image bytes.

Sources: [AWS Lambda container images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html),
[Rekognition DetectFaces](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html),
and the [pinned Hugging Face model revision](https://huggingface.co/hustvl/yolos-tiny/tree/da86128da961944dd8e33bb7c1baea46ed0a4753).
