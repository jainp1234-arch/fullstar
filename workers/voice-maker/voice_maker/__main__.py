"""Runs the narration worker until stopped (SIGTERM/SIGINT finish the current job first)."""

from __future__ import annotations

import logging
import os
import signal
import time

from . import NAME
from .jobs import LESSON_QUEUE, READALONG_QUEUE, RESULTS, NarrationWorker, Queue
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

    from .models import narrator_from_env

    sqs = boto3.client(
        "sqs",
        endpoint_url=os.environ.get("SQS_ENDPOINT") or None,
        region_name=_env("SQS_REGION", "ap-south-1"),
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

    def url(name: str) -> str:
        return sqs_calls.call(lambda: sqs.get_queue_url(QueueName=prefix + name)["QueueUrl"])

    queues = [Queue(name, url(name)) for name in (READALONG_QUEUE, LESSON_QUEUE)]
    worker = NarrationWorker(
        sqs,
        s3,
        _env("S3_BUCKET"),
        url(RESULTS),
        narrator_from_env(),
        sqs_calls,
        Resilient(CircuitBreaker("r2")),
    )

    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("%s started queues=%s", NAME, ",".join(prefix + q.name for q in queues))
    while not stopping:
        for queue in queues:
            if stopping:
                break
            try:
                worker.poll_once(queue)
            except Exception as error:  # noqa: BLE001 - keep polling; the queue holds the job
                log.warning("Poll failed queue=%s error=%s", queue.name, type(error).__name__)
                time.sleep(5)
    log.info("%s stopped", NAME)


if __name__ == "__main__":
    main()
