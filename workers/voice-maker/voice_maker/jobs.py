"""The readalong-narrate and lesson-narrate queues (Schema §12): one job at a time, 3 receives, DLQ.

Like the reading checker: a job that fails is left on its queue to come back after the visibility
timeout; on the 3rd receive a failure result is sent and the message moves to the DLQ. A chapter
can take longer than the 30-minute timeout on a CPU, so the message is kept hidden while it runs.
Results go to job-results with the job's idempotency key; the API applies each key once.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from .mp3 import encode
from .narrate import Narrator
from .resilience import Resilient

log = logging.getLogger(__name__)

READALONG_TYPE = "readalong.narrate"
READALONG_QUEUE = "readalong-narrate"
LESSON_TYPE = "lesson.narrate"
LESSON_QUEUE = "lesson-narrate"
RESULTS = "job-results"
MAX_RECEIVES = 3
VERSION = 1
LANGS = {"en", "hi"}
#: Both queues hide a message for 30 minutes; it is hidden again every 10 while the job runs.
VISIBILITY_S = 30 * 60
HEARTBEAT_S = 10 * 60
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_SCENE_ID = re.compile(r"^[a-z0-9_-]{1,20}$")


class Sqs(Protocol):
    def receive_message(self, **kwargs: Any) -> dict[str, Any]: ...
    def send_message(self, **kwargs: Any) -> dict[str, Any]: ...
    def delete_message(self, **kwargs: Any) -> dict[str, Any]: ...
    def change_message_visibility(self, **kwargs: Any) -> dict[str, Any]: ...


class S3(Protocol):
    def get_object(self, **kwargs: Any) -> dict[str, Any]: ...
    def put_object(self, **kwargs: Any) -> dict[str, Any]: ...


@dataclass(frozen=True)
class Queue:
    name: str
    url: str


class BadJob(ValueError):
    """The payload is not one the API sends; retrying cannot help, but the DLQ keeps it."""


def _uuid(payload: dict[str, Any], name: str) -> str:
    value = str(payload.get(name, ""))
    if not _UUID.match(value):
        raise BadJob(f"{name} must be a UUID")
    return value


def _lang(value: object) -> str:
    if value not in LANGS:
        raise BadJob("lang must be en or hi")
    return str(value)


def narration_key(family_id: str, chapter_id: str, run_id: str, kind: str) -> str:
    """Schema §13 R2 layout, the same as the API's StorageKeys.narration."""
    return f"families/{family_id}/chapters/{chapter_id}/narration-{run_id}-{kind}.json"


def page_audio_key(family_id: str, page_id: str) -> str:
    return f"families/{family_id}/audio/{page_id}.mp3"


def lesson_audio_key(item_id: str, version_no: int) -> str:
    return f"content/{item_id}/{version_no}/narration.mp3"


class NarrationWorker:
    def __init__(
        self,
        sqs: Sqs,
        s3: S3,
        bucket: str,
        results_url: str,
        narrator: Narrator,
        sqs_calls: Resilient,
        s3_calls: Resilient,
        wait_seconds: int = 10,
        heartbeat_s: float = HEARTBEAT_S,
    ) -> None:
        self._sqs = sqs
        self._s3 = s3
        self._bucket = bucket
        self._results = results_url
        self._narrator = narrator
        self._sqs_calls = sqs_calls
        self._s3_calls = s3_calls
        self._wait = wait_seconds
        self._heartbeat_s = heartbeat_s
        self._handlers: dict[str, Callable[[dict[str, Any]], dict[str, object]]] = {
            READALONG_TYPE: self.readalong,
            LESSON_TYPE: self.lesson,
        }

    def _get(self, key: str) -> bytes:
        return self._s3_calls.call(
            lambda: self._s3.get_object(Bucket=self._bucket, Key=key)["Body"].read()
        )

    def _put(self, key: str, body: bytes, content_type: str) -> None:
        self._s3_calls.call(
            lambda: self._s3.put_object(
                Bucket=self._bucket, Key=key, Body=body, ContentType=content_type
            )
        )

    def readalong(self, payload: dict[str, Any]) -> dict[str, object]:
        family_id = _uuid(payload, "family_id")
        chapter_id = _uuid(payload, "family_chapter_id")
        run_id = _uuid(payload, "run_id")
        lang = _lang(payload.get("lang"))
        pages_key = str(payload.get("pages_key", ""))
        if pages_key != narration_key(family_id, chapter_id, run_id, "input"):
            raise BadJob("pages_key does not belong to the job")
        pages = json.loads(self._get(pages_key)).get("pages") or []
        out: list[dict[str, object]] = []
        for page in pages:
            page_id = _uuid(page, "page_id")
            narration = self._narrator.page(str(page.get("text") or ""), lang)
            audio_key = page_audio_key(family_id, page_id)
            self._put(audio_key, encode(narration.samples, narration.rate), "audio/mpeg")
            out.append(
                {"page_id": page_id, "audio_key": audio_key, "word_timings": narration.word_timings}
            )
        result_key = narration_key(family_id, chapter_id, run_id, "result")
        self._put(result_key, json.dumps({"pages": out}).encode(), "application/json")
        log.info("Read-along narrated family_chapter_id=%s pages=%s", chapter_id, len(out))
        return {"result_key": result_key, "page_count": len(out)}

    def lesson(self, payload: dict[str, Any]) -> dict[str, object]:
        version_id = _uuid(payload, "content_version_id")
        item_id = _uuid(payload, "item_id")
        version_no = payload.get("version_no")
        if not isinstance(version_no, int) or isinstance(version_no, bool) or version_no < 1:
            raise BadJob("version_no must be a positive whole number")
        scenes: list[dict[str, str]] = []
        for scene in payload.get("scenes") or []:
            scene_id = str(scene.get("id", ""))
            text = str(scene.get("text") or "")
            if not _SCENE_ID.match(scene_id) or not text.strip() or len(text) > 500:
                raise BadJob("each scene needs an id and 1-500 characters of text")
            scenes.append({"id": scene_id, "text": text, "lang": _lang(scene.get("lang"))})
        if not scenes:
            raise BadJob("no scenes to narrate")
        narration = self._narrator.lesson(scenes)
        audio_key = lesson_audio_key(item_id, version_no)
        self._put(audio_key, encode(narration.samples, narration.rate), "audio/mpeg")
        log.info("Lesson narrated content_version_id=%s scenes=%s", version_id, len(scenes))
        return {"audio_key": audio_key, "scenes": narration.scenes}

    def handle(self, envelope: dict[str, Any]) -> dict[str, object]:
        handler = self._handlers.get(str(envelope.get("type")))
        if handler is None:
            raise BadJob(f"unexpected type {envelope.get('type')!r}")
        return handler(envelope.get("payload") or {})

    def poll_once(self, queue: Queue) -> int:
        """Receives and processes at most one job; returns how many were received."""
        response = self._sqs_calls.call(
            lambda: self._sqs.receive_message(
                QueueUrl=queue.url,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=self._wait,
                MessageSystemAttributeNames=["ApproximateReceiveCount"],
            )
        )
        messages = response.get("Messages") or []
        for message in messages:
            receives = int(message.get("Attributes", {}).get("ApproximateReceiveCount", "1"))
            with self._hidden(queue, message["ReceiptHandle"]):
                done = self.process(message["Body"], receives)
            if done:
                self._sqs_calls.call(
                    lambda m=message: self._sqs.delete_message(
                        QueueUrl=queue.url, ReceiptHandle=m["ReceiptHandle"]
                    )
                )
        return len(messages)

    def _hidden(self, queue: Queue, receipt: str) -> _Heartbeat:
        def extend() -> None:
            self._sqs_calls.call(
                lambda: self._sqs.change_message_visibility(
                    QueueUrl=queue.url, ReceiptHandle=receipt, VisibilityTimeout=VISIBILITY_S
                )
            )

        return _Heartbeat(extend, self._heartbeat_s)

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
            lambda: self._sqs.send_message(QueueUrl=self._results, MessageBody=json.dumps(message))
        )


class _Heartbeat:
    """Calls extend every interval seconds until the block ends; a failed call is only logged."""

    def __init__(self, extend: Callable[[], None], interval: float) -> None:
        self._extend = extend
        self._interval = interval
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="visibility", daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._extend()
            except Exception as error:  # noqa: BLE001 - the job goes on; SQS may redeliver it
                log.warning("Visibility not extended error=%s", type(error).__name__)

    def __enter__(self) -> _Heartbeat:
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        self._thread.join()
