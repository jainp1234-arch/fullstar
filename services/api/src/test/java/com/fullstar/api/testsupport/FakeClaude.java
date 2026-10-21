package com.fullstar.api.testsupport;

import com.fullstar.api.common.claude.ClaudeClient;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/** Claude for the API tests: replies are queued by the test; every prompt is recorded. */
public class FakeClaude implements ClaudeClient {

	public record Call(String system, String user) {
	}

	private final Deque<String> replies = new ArrayDeque<>();

	private final List<Call> calls = new ArrayList<>();

	@Override
	public synchronized String complete(String system, String user) {
		calls.add(new Call(system, user));
		String reply = replies.poll();
		if (reply == null) {
			throw new IllegalStateException("FakeClaude has no reply queued");
		}
		return reply;
	}

	public synchronized void reply(String text) {
		replies.add(text);
	}

	public synchronized List<Call> calls() {
		return List.copyOf(calls);
	}

	public synchronized void reset() {
		replies.clear();
		calls.clear();
	}

}
