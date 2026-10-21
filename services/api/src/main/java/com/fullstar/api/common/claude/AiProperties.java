package com.fullstar.api.common.claude;

import java.time.Duration;
import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * fullstar.ai.*: the Claude features (Tech Stack §8a, §9). Both are off unless their flag is
 * "true" (FEATURE_AI_DRAFTS, FEATURE_AI_CHECK); the key comes from ANTHROPIC_API_KEY and the model ID
 * is configuration, never code.
 */
@ConfigurationProperties("fullstar.ai")
public record AiProperties(String drafts, String check, String apiKey, String model, Integer maxTokens,
		Duration timeout, String baseUrl) {

	public static final String DEFAULT_MODEL = "claude-sonnet-5-5";

	public AiProperties {
		apiKey = apiKey == null || apiKey.isBlank() ? null : apiKey.strip();
		model = model == null || model.isBlank() ? DEFAULT_MODEL : model.strip();
		maxTokens = maxTokens == null ? 8000 : maxTokens;
		timeout = timeout == null ? Duration.ofSeconds(55) : timeout;
		// Only tests point this at a stand-in server; empty means the SDK default
		baseUrl = baseUrl == null || baseUrl.isBlank() ? null : baseUrl.strip();
	}

	/** FEATURE_AI_DRAFTS: POST /studio/ai/drafts may call Claude. */
	public boolean draftsEnabled() {
		return isTrue(drafts);
	}

	/** FEATURE_AI_CHECK: the content-check agent runs instead of the manual check. */
	public boolean checkEnabled() {
		return isTrue(check);
	}

	private static boolean isTrue(String flag) {
		return flag != null && "true".equals(flag.strip().toLowerCase(Locale.ROOT));
	}

	@Override
	public String toString() {
		return "AiProperties[drafts=" + draftsEnabled() + ", check=" + checkEnabled() + ", model=" + model
				+ ", apiKey=" + (apiKey == null ? "unset" : "set") + "]";
	}

}
