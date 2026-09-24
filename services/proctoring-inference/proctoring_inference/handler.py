"""AWS Lambda SQS entry point with per-record retry isolation."""

from __future__ import annotations

import json
import logging
from typing import Any

from .contract import ContractError
from .worker import WorkerConfig, process_message

_LOG = logging.getLogger("tims.proctoring_inference")


def handle_batch(event: dict[str, Any], config: WorkerConfig, s3: Any, rekognition: Any, sqs: Any) -> dict[str, Any]:
    records = event.get("Records")
    if not isinstance(records, list) or not 1 <= len(records) <= 10:
        raise ContractError("invalid_sqs_batch")
    failures: list[dict[str, str]] = []
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("messageId"), str):
            raise ContractError("invalid_sqs_record")
        message_id = record["messageId"]
        try:
            if record.get("eventSource") != "aws:sqs" or not isinstance(record.get("body"), str):
                raise ContractError("invalid_sqs_record")
            process_message(record["body"], config, s3, rekognition, sqs)
        except ContractError:
            _LOG.warning(json.dumps({"stage": "request", "code": "invalid_contract"}))
            failures.append({"itemIdentifier": message_id})
        except Exception:
            # Never log an exception: SDK errors may include object keys or
            # content. Queue/DLQ alarms reveal retry exhaustion without PII.
            _LOG.error(json.dumps({"stage": "processing", "code": "retryable_failure"}))
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    import boto3

    config = WorkerConfig.from_env()
    # No database, Hugging Face API, or externally hosted inference client.
    return handle_batch(
        event,
        config,
        boto3.client("s3", region_name=config.region),
        boto3.client("rekognition", region_name=config.region),
        boto3.client("sqs", region_name=config.region),
    )
