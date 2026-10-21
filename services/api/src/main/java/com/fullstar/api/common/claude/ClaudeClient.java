package com.fullstar.api.common.claude;

/**
 * One Claude message: a system prompt and a user prompt in, the reply text out (Tech Stack §9).
 * Only book text and our own content are sent: never child names, recordings or progress.
 */
public interface ClaudeClient {

	String complete(String system, String user);

}
