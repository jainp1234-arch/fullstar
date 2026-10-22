"""Retry with backoff and a circuit breaker for outside calls (the workers' Resilience4j settings).

Same numbers as book-reader's ResilientCalls: 3 tries, 500 ms doubling; the breaker opens after
50% failures of the last 20 calls (at least 10), stays open 30 s, then lets 3 trial calls through.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    """The dependency failed too often; calls are refused until it has had time to recover."""


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        window: int = 20,
        minimum_calls: int = 10,
        failure_rate: float = 0.5,
        open_seconds: float = 30.0,
        half_open_calls: int = 3,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.name = name
        self._window: deque[bool] = deque(maxlen=window)
        self._minimum = minimum_calls
        self._rate = failure_rate
        self._open_s = open_seconds
        self._half_open = half_open_calls
        self._clock = clock
        self._opened_at: float | None = None
        self._trials = 0
        self._lock = threading.Lock()

    def before(self) -> None:
        with self._lock:
            if self._opened_at is None:
                return
            if self._clock() - self._opened_at < self._open_s:
                raise CircuitOpenError(self.name)
            if self._trials >= self._half_open:
                raise CircuitOpenError(self.name)
            self._trials += 1

    def record(self, ok: bool) -> None:
        with self._lock:
            if self._opened_at is not None:
                if not ok:
                    self._opened_at = self._clock()
                    self._trials = 0
                elif self._trials >= self._half_open:
                    self._opened_at = None
                    self._trials = 0
                    self._window.clear()
                return
            self._window.append(ok)
            failures = self._window.count(False)
            if len(self._window) >= self._minimum and failures / len(self._window) >= self._rate:
                self._opened_at = self._clock()
                self._trials = 0


class Resilient:
    """Calls fn through the breaker, retrying failures (not an open breaker) with backoff."""

    def __init__(
        self,
        breaker: CircuitBreaker,
        attempts: int = 3,
        wait_s: float = 0.5,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._breaker = breaker
        self._attempts = attempts
        self._wait = wait_s
        self._sleep = sleep

    def call(self, fn: Callable[[], T]) -> T:
        wait = self._wait
        for attempt in range(1, self._attempts + 1):
            self._breaker.before()
            try:
                value = fn()
            except Exception:
                self._breaker.record(False)
                if attempt == self._attempts:
                    raise
                self._sleep(wait)
                wait *= 2
                continue
            self._breaker.record(True)
            return value
        raise AssertionError("unreachable")
