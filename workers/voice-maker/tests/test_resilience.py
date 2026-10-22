import pytest
from voice_maker.resilience import CircuitBreaker, CircuitOpenError, Resilient


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_retries_twice_with_doubling_backoff_then_raises():
    waits: list[float] = []
    calls = Resilient(CircuitBreaker("t"), sleep=waits.append)
    attempts = []

    def fails() -> None:
        attempts.append(1)
        raise ConnectionError

    with pytest.raises(ConnectionError):
        calls.call(fails)
    assert len(attempts) == 3
    assert waits == [0.5, 1.0]


def test_a_later_success_is_returned():
    tries = iter([ConnectionError(), "ok"])

    def flaky() -> str:
        value = next(tries)
        if isinstance(value, Exception):
            raise value
        return value

    assert Resilient(CircuitBreaker("t"), sleep=lambda _s: None).call(flaky) == "ok"


def test_the_breaker_opens_at_half_failures_and_recovers_after_30_seconds():
    clock = Clock()
    breaker = CircuitBreaker("t", clock=clock)
    for ok in [True] * 5 + [False] * 5:
        breaker.before()
        breaker.record(ok)
    with pytest.raises(CircuitOpenError):
        breaker.before()
    clock.now = 31
    for _ in range(3):
        breaker.before()
        breaker.record(True)
    # Closed again: calls go through
    breaker.before()
