import json
from pathlib import Path
from typing import Any

from reading_checker.jobs import Queues, ReadingScoreWorker, recording_key
from reading_checker.resilience import CircuitBreaker, Resilient
from reading_checker.scoring import SpokenWord

FAMILY = "11111111-1111-1111-1111-111111111111"
TEST = "22222222-2222-2222-2222-222222222222"
PASSAGE = "Ravi has a red kite. The wind is strong."


class FakeSqs:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.deleted: list[str] = []
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


class FakeS3:
    def __init__(self, fail: bool = False) -> None:
        self.keys: list[str] = []
        self.fail = fail

    def download_file(self, bucket: str, key: str, filename: str) -> None:
        if self.fail:
            raise ConnectionError("r2 down")
        assert bucket == "fullstar-test"
        self.keys.append(key)
        Path(filename).write_bytes(b"audio")


class FakeRecognizer:
    def __init__(self, text: str) -> None:
        self.text = text
        self.langs: list[str] = []

    def words(self, audio: Path, lang: str) -> list[SpokenWord]:
        assert audio.read_bytes() == b"audio"
        self.langs.append(lang)
        return [SpokenWord(w, i * 0.5, (i + 1) * 0.5) for i, w in enumerate(self.text.split())]


def calls() -> Resilient:
    return Resilient(CircuitBreaker("test"), sleep=lambda _s: None)


def envelope(**payload: Any) -> str:
    body = {
        "reading_test_id": TEST,
        "family_id": FAMILY,
        "recording_key": recording_key(FAMILY, TEST),
        "passage_text": PASSAGE,
        "lang": "en",
        **payload,
    }
    return json.dumps(
        {
            "job_id": "33333333-3333-3333-3333-333333333333",
            "idempotency_key": f"reading.score:{TEST}",
            "type": "reading.score",
            "version": 1,
            "created_at": "2026-10-22T08:00:00Z",
            "payload": body,
        }
    )


def worker(sqs: FakeSqs, s3: FakeS3, reading: str = "Ravi has a red kite the wind is strong"):
    return ReadingScoreWorker(
        sqs,
        s3,
        "fullstar-test",
        Queues("jobs-url", "results-url"),
        FakeRecognizer(reading),
        calls(),
        calls(),
        0,
    )


def test_a_scored_reading_is_sent_to_job_results_and_the_job_deleted():
    sqs, s3 = FakeSqs(), FakeS3()
    sqs.inbox.append(
        {"Body": envelope(), "ReceiptHandle": "r1", "Attributes": {"ApproximateReceiveCount": "1"}}
    )
    assert worker(sqs, s3).poll_once() == 1
    assert s3.keys == [f"families/{FAMILY}/recordings/{TEST}.webm"]
    assert sqs.deleted == ["r1"]
    [message] = sqs.sent
    assert message["queue"] == "results-url"
    assert message["type"] == "job.result"
    assert message["idempotency_key"] == f"reading.score:{TEST}"
    result = message["payload"]
    assert result["type"] == "reading.score"
    assert result["outcome"] == "success"
    assert result["result"]["outcome"] == "scored"
    assert result["result"]["accuracy_pct"] == 100.0
    assert result["error"] is None


def test_a_recording_not_understood_is_a_successful_job():
    sqs = FakeSqs()
    assert worker(sqs, FakeS3(), reading="hmm").process(envelope(), 1)
    assert sqs.sent[0]["payload"]["result"]["outcome"] == "not_understood"


def test_failures_are_retried_then_reported_on_the_third_receive():
    sqs = FakeSqs()
    w = worker(sqs, FakeS3(fail=True))
    assert not w.process(envelope(), 1)
    assert not w.process(envelope(), 2)
    assert sqs.sent == []
    assert not w.process(envelope(), 3)
    [message] = sqs.sent
    assert message["payload"]["outcome"] == "failure"
    assert message["payload"]["error"] == {"code": "WORKER_FAILED", "message": "ConnectionError"}


def test_only_this_tests_recording_and_known_languages_are_read():
    sqs, s3 = FakeSqs(), FakeS3()
    w = worker(sqs, s3)
    other = recording_key(FAMILY, "44444444-4444-4444-4444-444444444444")
    assert not w.process(envelope(recording_key=other), 3)
    assert not w.process(envelope(recording_key="../secrets"), 3)
    assert not w.process(envelope(lang="fr"), 3)
    assert not w.process(envelope(passage_text=" "), 3)
    assert s3.keys == []
    assert [m["payload"]["error"]["message"] for m in sqs.sent] == ["BadJob"] * 4


def test_an_unreadable_message_stays_on_the_queue():
    sqs = FakeSqs()
    assert not worker(sqs, FakeS3()).process("not json", 1)
    assert sqs.sent == []
