"""Runs the reading-score worker until stopped (SIGTERM/SIGINT finish the current job first)."""

from __future__ import annotations

import logging
import os
import signal
import time

from . import NAME
from .jobs import QUEUE, RESULTS, Queues, ReadingScoreWorker
from .recognizer import WhisperRecognizer
from .resilience import CircuitBreaker, Resilient

log = logging.getLogger(NAME)


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"{name} is required")
    return value


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if _env("QUEUE_CONSUMER_ENABLED", "true").lower() != "true":
        log.info("%s consumer disabled", NAME)
        return

    import boto3
    from botocore.config import Config

    region = _env("SQS_REGION", "ap-south-1")
    sqs = boto3.client(
        "sqs",
        endpoint_url=os.environ.get("SQS_ENDPOINT") or None,
        region_name=region,
        aws_access_key_id=_env("SQS_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("SQS_SECRET_ACCESS_KEY"),
        config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 1}),
    )
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT") or None,
        region_name=_env("S3_REGION", "auto"),
        aws_access_key_id=_env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("S3_SECRET_ACCESS_KEY"),
        config=Config(
            connect_timeout=5,
            read_timeout=60,
            retries={"max_attempts": 1},
            s3={"addressing_style": "path"},
        ),
    )
    prefix = os.environ.get("QUEUE_PREFIX", "")
    sqs_calls = Resilient(CircuitBreaker("sqs"))
    queues = Queues(
        jobs=sqs_calls.call(lambda: sqs.get_queue_url(QueueName=prefix + QUEUE)["QueueUrl"]),
        results=sqs_calls.call(lambda: sqs.get_queue_url(QueueName=prefix + RESULTS)["QueueUrl"]),
    )
    recognizer = WhisperRecognizer(
        _env("WHISPER_MODEL_DIR", "/models/small"), int(_env("WHISPER_THREADS", "2"))
    )
    worker = ReadingScoreWorker(
        sqs, s3, _env("S3_BUCKET"), queues, recognizer, sqs_calls, Resilient(CircuitBreaker("r2"))
    )

    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("%s started queue=%s", NAME, prefix + QUEUE)
    while not stopping:
        try:
            worker.poll_once()
        except Exception as error:  # noqa: BLE001 - keep polling; the queue holds the job
            log.warning("Poll failed error=%s", type(error).__name__)
            time.sleep(5)
    log.info("%s stopped", NAME)


if __name__ == "__main__":
    main()
