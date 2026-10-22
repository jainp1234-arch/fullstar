"""The reading-score queue (Schema §12): one job at a time, at most 3 receives, then the DLQ.

Like book-reader's JobWorkers: a job that fails is left on the queue to come back after its
visibility timeout; on the 3rd receive a failure result is sent and the message moves to the DLQ.
Results go to job-results with the job's idempotency key; the API applies each key once.
"""

from __future__ import annotations

import json
import logging
import re
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from .recognizer import Recognizer
from .resilience import Resilient
from .scoring import score

log = logging.getLogger(__name__)

TYPE = "reading.score"
QUEUE = "reading-score"
RESULTS = "job-results"
MAX_RECEIVES = 3
VERSION = 1
LANGS = {"en", "hi"}
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class Sqs(Protocol):
    def receive_message(self, **kwargs: Any) -> dict[str, Any]: ...
    def send_message(self, **kwargs: Any) -> dict[str, Any]: ...
    def delete_message(self, **kwargs: Any) -> dict[str, Any]: ...


class S3(Protocol):
    def download_file(self, bucket: str, key: str, filename: str) -> None: ...


@dataclass(frozen=True)
class Queues:
    jobs: str
    results: str


class BadJob(ValueError):
    """The payload is not one the API sends; retrying cannot help, but the DLQ keeps it."""


def recording_key(family_id: str, reading_test_id: str) -> str:
    """Schema §12 R2 layout, the same as the API's StorageKeys.recording."""
    return f"families/{family_id}/recordings/{reading_test_id}.webm"


def _payload(envelope: dict[str, Any]) -> dict[str, str]:
    if envelope.get("type") != TYPE:
        raise BadJob(f"unexpected type {envelope.get('type')!r}")
    payload = envelope.get("payload") or {}
    family_id = str(payload.get("family_id", ""))
    test_id = str(payload.get("reading_test_id", ""))
    if not (_UUID.match(family_id) and _UUID.match(test_id)):
        raise BadJob("family_id and reading_test_id must be UUIDs")
    key = str(payload.get("recording_key", ""))
    if key != recording_key(family_id, test_id):
        raise BadJob("recording_key is not this test's recording")
    lang = str(payload.get("lang", ""))
    if lang not in LANGS:
        raise BadJob("lang must be en or hi")
    text = str(payload.get("passage_text", ""))
    if not text.strip():
        raise BadJob("passage_text is empty")
    return {
        "family_id": family_id,
        "reading_test_id": test_id,
        "key": key,
        "lang": lang,
        "text": text,
    }


class ReadingScoreWorker:
    def __init__(
        self,
        sqs: Sqs,
        s3: S3,
        bucket: str,
        queues: Queues,
        recognizer: Recognizer,
        sqs_calls: Resilient,
        s3_calls: Resilient,
        wait_seconds: int = 20,
    ) -> None:
        self._sqs = sqs
        self._s3 = s3
        self._bucket = bucket
        self._queues = queues
        self._recognizer = recognizer
        self._sqs_calls = sqs_calls
        self._s3_calls = s3_calls
        self._wait = wait_seconds

    def handle(self, envelope: dict[str, Any]) -> dict[str, object]:
        job = _payload(envelope)
        with tempfile.TemporaryDirectory(prefix="reading-") as tmp:
            audio = Path(tmp) / "recording"
            self._s3_calls.call(
                lambda: self._s3.download_file(self._bucket, job["key"], str(audio))
            )
            spoken = self._recognizer.words(audio, job["lang"])
        result = score(job["text"], spoken)
        log.info(
            "Reading scored reading_test_id=%s outcome=%s words_read=%s",
            job["reading_test_id"],
            result.outcome,
            result.words_read,
        )
        return result.as_result()

    def poll_once(self) -> int:
        """Receives and processes at most one job; returns how many were received."""
        response = self._sqs_calls.call(
            lambda: self._sqs.receive_message(
                QueueUrl=self._queues.jobs,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=self._wait,
                MessageSystemAttributeNames=["ApproximateReceiveCount"],
            )
        )
        messages = response.get("Messages") or []
        for message in messages:
            receives = int(message.get("Attributes", {}).get("ApproximateReceiveCount", "1"))
            if self.process(message["Body"], receives):
                self._sqs_calls.call(
                    lambda m=message: self._sqs.delete_message(
                        QueueUrl=self._queues.jobs, ReceiptHandle=m["ReceiptHandle"]
                    )
                )
        return len(messages)

    def process(self, body: str, receives: int) -> bool:
        """True when done and deletable; False leaves the message for a retry or the DLQ."""
        try:
            envelope = json.loads(body)
        except json.JSONDecodeError:
            log.warning("Unreadable job message receive=%s", receives)
            return False
        job_id = envelope.get("job_id")
        try:
            result = self.handle(envelope)
        except Exception as error:  # noqa: BLE001 - any failure is retried, then reported
            log.warning(
                "Job failed job_id=%s type=%s receive=%s error=%s",
                job_id,
                envelope.get("type"),
                receives,
                type(error).__name__,
            )
            if receives >= MAX_RECEIVES:
                self._send_result(envelope, "failure", None, type(error).__name__)
            return False
        self._send_result(envelope, "success", result, None)
        return True

    def _send_result(
        self,
        envelope: dict[str, Any],
        outcome: str,
        result: dict[str, object] | None,
        error: str | None,
    ) -> None:
        payload = {
            "job_id": envelope.get("job_id"),
            "idempotency_key": envelope.get("idempotency_key"),
            "type": envelope.get("type"),
            "outcome": outcome,
            "result": result,
            "error": None if error is None else {"code": "WORKER_FAILED", "message": error},
        }
        message = {
            "job_id": str(uuid.uuid4()),
            "idempotency_key": envelope.get("idempotency_key"),
            "type": "job.result",
            "version": VERSION,
            "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "payload": payload,
        }
        self._sqs_calls.call(
            lambda: self._sqs.send_message(
                QueueUrl=self._queues.results, MessageBody=json.dumps(message)
            )
        )
