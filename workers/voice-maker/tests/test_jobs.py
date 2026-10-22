import io
import json
import threading
from typing import Any

import pytest
from voice_maker.jobs import (
    LESSON_TYPE,
    READALONG_TYPE,
    NarrationWorker,
    Queue,
    lesson_audio_key,
    narration_key,
    page_audio_key,
)
from voice_maker.narrate import Narrator
from voice_maker.resilience import CircuitBreaker, Resilient

from tests.fakes import FakeAligner, FakeVoice

FAMILY = "11111111-1111-1111-1111-111111111111"
CHAPTER = "22222222-2222-2222-2222-222222222222"
RUN = "33333333-3333-3333-3333-333333333333"
PAGE = "44444444-4444-4444-4444-444444444444"
ITEM = "55555555-5555-5555-5555-555555555555"
VERSION = "66666666-6666-6666-6666-666666666666"
QUEUE = Queue("readalong-narrate", "q-readalong")


class FakeSqs:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self.hidden: list[dict[str, Any]] = []
        self.inbox: list[dict[str, Any]] = []

    def receive_message(self, **kwargs: Any) -> dict[str, Any]:
        assert kwargs["MessageSystemAttributeNames"] == ["ApproximateReceiveCount"]
        return {"Messages": self.inbox[:1]}

    def send_message(self, **kwargs: Any) -> dict[str, Any]:
        self.sent.append({"queue": kwargs["QueueUrl"], **json.loads(kwargs["MessageBody"])})
        return {}

    def delete_message(self, **kwargs: Any) -> dict[str, Any]:
        self.deleted.append(kwargs["ReceiptHandle"])
        return {}

    def change_message_visibility(self, **kwargs: Any) -> dict[str, Any]:
        self.hidden.append(kwargs)
        return {}


class FakeS3:
    def __init__(self, fail: bool = False) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail = fail

    def get_object(self, **kwargs: Any) -> dict[str, Any]:
        if self.fail:
            raise ConnectionError("r2 down")
        assert kwargs["Bucket"] == "fullstar-test"
        return {"Body": io.BytesIO(self.objects[kwargs["Key"]][0])}

    def put_object(self, **kwargs: Any) -> dict[str, Any]:
        assert kwargs["Bucket"] == "fullstar-test"
        self.objects[kwargs["Key"]] = (kwargs["Body"], kwargs["ContentType"])
        return {}


def calls() -> Resilient:
    return Resilient(CircuitBreaker("test"), sleep=lambda _s: None)


def worker(sqs: FakeSqs, s3: FakeS3, heartbeat_s: float = 600) -> NarrationWorker:
    narrator = Narrator(FakeVoice(), FakeAligner())
    return NarrationWorker(
        sqs, s3, "fullstar-test", "q-results", narrator, calls(), calls(), heartbeat_s=heartbeat_s
    )


def readalong_envelope(**payload: Any) -> dict[str, Any]:
    body = {
        "family_id": FAMILY,
        "family_chapter_id": CHAPTER,
        "run_id": RUN,
        "lang": "en",
        "page_count": 1,
        "pages_key": narration_key(FAMILY, CHAPTER, RUN, "input"),
    } | payload
    return {
        "job_id": "j1",
        "idempotency_key": f"readalong.narrate:{CHAPTER}:{RUN}",
        "type": READALONG_TYPE,
        "version": 1,
        "payload": body,
    }


def lesson_envelope(**payload: Any) -> dict[str, Any]:
    body = {
        "content_version_id": VERSION,
        "item_id": ITEM,
        "version_no": 3,
        "scenes": [
            {"id": "s1", "text": "A bird builds a nest.", "lang": "en"},
            {"id": "s2", "text": "It sings.", "lang": "en"},
        ],
    } | payload
    return {
        "job_id": "j2",
        "idempotency_key": f"lesson.narrate:{VERSION}",
        "type": LESSON_TYPE,
        "payload": body,
    }


def with_pages(s3: FakeS3, *pages: dict[str, str]) -> None:
    s3.objects[narration_key(FAMILY, CHAPTER, RUN, "input")] = (
        json.dumps({"pages": list(pages)}).encode(),
        "application/json",
    )


def test_a_chapter_gets_mp3s_and_a_result_file():
    sqs, s3 = FakeSqs(), FakeS3()
    with_pages(s3, {"page_id": PAGE, "text": "Ravi has a kite."})
    assert worker(sqs, s3).process(json.dumps(readalong_envelope()), 1)
    audio, kind = s3.objects[page_audio_key(FAMILY, PAGE)]
    assert kind == "audio/mpeg"
    assert audio[:3] == b"ID3" or audio[0] == 0xFF
    result_key = narration_key(FAMILY, CHAPTER, RUN, "result")
    pages = json.loads(s3.objects[result_key][0])["pages"]
    assert pages[0]["page_id"] == PAGE
    assert pages[0]["audio_key"] == f"families/{FAMILY}/audio/{PAGE}.mp3"
    assert [t["w"] for t in pages[0]["word_timings"]] == ["Ravi", "has", "a", "kite."]
    (sent,) = sqs.sent
    assert sent["queue"] == "q-results"
    assert sent["type"] == "job.result"
    assert sent["idempotency_key"] == f"readalong.narrate:{CHAPTER}:{RUN}"
    assert sent["payload"]["outcome"] == "success"
    assert sent["payload"]["result"] == {"result_key": result_key, "page_count": 1}


@pytest.mark.parametrize(
    "change",
    [
        {"pages_key": f"families/{FAMILY}/chapters/{CHAPTER}/narration-{RUN}-result.json"},
        {"family_id": "../x"},
        {"lang": "fr"},
    ],
)
def test_a_payload_the_api_never_sends_is_refused(change):
    sqs, s3 = FakeSqs(), FakeS3()
    with_pages(s3, {"page_id": PAGE, "text": "Hi."})
    assert not worker(sqs, s3).process(json.dumps(readalong_envelope(**change)), 1)
    assert sqs.sent == []
    assert page_audio_key(FAMILY, PAGE) not in s3.objects


def test_a_page_id_that_is_not_a_uuid_is_refused():
    sqs, s3 = FakeSqs(), FakeS3()
    with_pages(s3, {"page_id": "../../etc", "text": "Hi."})
    assert not worker(sqs, s3).process(json.dumps(readalong_envelope()), 1)
    assert sqs.sent == []


def test_failures_are_retried_then_reported_on_the_third_receive():
    sqs, s3 = FakeSqs(), FakeS3(fail=True)
    w = worker(sqs, s3)
    body = json.dumps(readalong_envelope())
    assert not w.process(body, 1)
    assert not w.process(body, 2)
    assert sqs.sent == []
    assert not w.process(body, 3)
    (sent,) = sqs.sent
    assert sent["payload"]["outcome"] == "failure"
    assert sent["payload"]["error"] == {"code": "WORKER_FAILED", "message": "ConnectionError"}


def test_a_lesson_gets_one_mp3_and_scene_times():
    sqs, s3 = FakeSqs(), FakeS3()
    assert worker(sqs, s3).process(json.dumps(lesson_envelope()), 1)
    assert s3.objects[lesson_audio_key(ITEM, 3)][1] == "audio/mpeg"
    result = sqs.sent[0]["payload"]["result"]
    assert result["audio_key"] == f"content/{ITEM}/3/narration.mp3"
    s1, s2 = result["scenes"]
    assert (s1["id"], s2["id"]) == ("s1", "s2")
    assert s1["start_ms"] < s1["end_ms"] <= s2["start_ms"] < s2["end_ms"]


@pytest.mark.parametrize(
    "change",
    [
        {"version_no": 0},
        {"version_no": True},
        {"item_id": "x"},
        {"scenes": []},
        {"scenes": [{"id": "S 1", "text": "x", "lang": "en"}]},
        {"scenes": [{"id": "s1", "text": " ", "lang": "en"}]},
        {"scenes": [{"id": "s1", "text": "x", "lang": "fr"}]},
    ],
)
def test_a_lesson_payload_the_api_never_sends_is_refused(change):
    sqs, s3 = FakeSqs(), FakeS3()
    assert not worker(sqs, s3).process(json.dumps(lesson_envelope(**change)), 1)
    assert s3.objects == {}


def test_poll_deletes_a_finished_job_and_keeps_it_hidden_while_it_runs():
    sqs, s3 = FakeSqs(), FakeS3()
    with_pages(s3, {"page_id": PAGE, "text": "Ravi has a kite."})
    sqs.inbox.append(
        {
            "Body": json.dumps(readalong_envelope()),
            "ReceiptHandle": "r1",
            "Attributes": {"ApproximateReceiveCount": "1"},
        }
    )
    w = worker(sqs, s3, heartbeat_s=0.01)
    original = w.readalong

    def slow(payload: dict[str, Any]) -> dict[str, object]:
        threading.Event().wait(0.1)
        return original(payload)

    w._handlers[READALONG_TYPE] = slow
    assert w.poll_once(QUEUE) == 1
    assert sqs.deleted == ["r1"]
    assert sqs.hidden[0] == {
        "QueueUrl": "q-readalong",
        "ReceiptHandle": "r1",
        "VisibilityTimeout": 1800,
    }


def test_an_unknown_type_is_left_for_the_dlq():
    sqs, s3 = FakeSqs(), FakeS3()
    envelope = {"job_id": "j", "idempotency_key": "k", "type": "reading.score", "payload": {}}
    assert not worker(sqs, s3).process(json.dumps(envelope), 3)
    assert sqs.sent[0]["payload"]["outcome"] == "failure"
