import hashlib
import io
import json
import unittest
from datetime import datetime, timedelta, timezone

from PIL import Image

from proctoring_inference.handler import handle_batch
from proctoring_inference.worker import WorkerConfig


class FakeS3:
    def __init__(self, data):
        self.data = data

    def get_object(self, **_args):
        return {"ContentLength": len(self.data), "Body": io.BytesIO(self.data)}


class FakeRekognition:
    def detect_faces(self, **_args):
        return {"FaceDetails": [{}]}


class BrokenS3:
    def get_object(self, **_args):
        raise RuntimeError("sealed/private-candidate-image.jpg")


class FakeSqs:
    def __init__(self, fail=False):
        self.messages = []
        self.fail = fail

    def send_message(self, **args):
        if self.fail:
            raise RuntimeError("no send")
        self.messages.append(args)
        return {"MessageId": "result-id"}


def valid_body():
    output = io.BytesIO()
    Image.new("RGB", (128, 96), "blue").save(output, format="JPEG")
    data = output.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    body = json.dumps({
        "schemaVersion": 1,
        "organizationId": "00000000-0000-4000-8000-000000000002",
        "evidenceId": "00000000-0000-4000-8000-000000000001",
        "objectKey": f"sealed/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000001/{digest}.jpg",
        "sha256": digest,
        "mediaType": "camera",
        "modelRevision": "proctoring-v1",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
    })
    return data, body


def record(message_id, body):
    return {"messageId": message_id, "eventSource": "aws:sqs", "body": body}


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.image, self.body = valid_body()
        self.config = WorkerConfig(
            bucket="private-bucket",
            result_queue_url="https://sqs.us-west-2.amazonaws.com/123/result",
            model_revision="proctoring-v1",
        )

    def test_one_bad_record_does_not_block_a_good_record(self):
        sqs = FakeSqs()
        result = handle_batch(
            {"Records": [record("bad", '{"candidateEmail":"private@example.com"}'), record("good", self.body)]},
            self.config, FakeS3(self.image), FakeRekognition(), sqs,
        )
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "bad"}]})
        self.assertEqual(len(sqs.messages), 1)
        payload = json.loads(sqs.messages[0]["MessageBody"])
        self.assertNotIn("candidateEmail", payload)
        self.assertEqual(payload["organizationId"], "00000000-0000-4000-8000-000000000002")
        self.assertEqual(payload["status"], "completed")

    def test_result_queue_failure_retries_instead_of_acknowledging(self):
        result = handle_batch(
            {"Records": [record("one", self.body)]}, self.config,
            FakeS3(self.image), FakeRekognition(), FakeSqs(fail=True),
        )
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "one"}]})

    def test_unexpected_s3_failure_retries_without_publishing_clear_result(self):
        sqs = FakeSqs()
        result = handle_batch(
            {"Records": [record("one", self.body)]}, self.config,
            BrokenS3(), FakeRekognition(), sqs,
        )
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "one"}]})
        self.assertEqual(sqs.messages, [])

    def test_standard_queue_duplicate_yields_same_identity_for_dotnet_idempotency(self):
        sqs = FakeSqs()
        result = handle_batch(
            {"Records": [record("one", self.body), record("two", self.body)]},
            self.config, FakeS3(self.image), FakeRekognition(), sqs,
        )
        self.assertEqual(result, {"batchItemFailures": []})
        self.assertEqual(len(sqs.messages), 2)
        payloads = [json.loads(message["MessageBody"]) for message in sqs.messages]
        self.assertEqual({(p["evidenceId"], p["sha256"], p["modelRevision"]) for p in payloads}, {
            ("00000000-0000-4000-8000-000000000001", hashlib.sha256(self.image).hexdigest(), "proctoring-v1")
        })


if __name__ == "__main__":
    unittest.main()
