package com.fullstar.api.common.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.net.URI;
import java.net.URISyntaxException;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** fullstar.* settings. */
@Validated
@ConfigurationProperties("fullstar")
public record FullstarProperties(@Valid @NotNull Consent consent, @Valid @NotNull Uploads uploads,
		@Valid Privacy privacy) {

	public FullstarProperties {
		privacy = privacy == null ? new Privacy(null) : privacy;
	}

	/** Version of the privacy notice the parent consents to (stored in families.consent_version). */
	public record Consent(@NotBlank String version) {
	}

	/** Upload limits (PRD, Tech Stack §10, Schema §4.3). */
	public record Uploads(@Positive long pdfMaxBytes, @Positive int pdfMaxPages, @Positive long photoMaxBytes,
			@Positive int photosPerUpload) {
	}

	/** Link to the privacy notice (PRIVACY_NOTICE_URL): empty means none, otherwise an absolute https URL. */
	public record Privacy(String noticeUrl) {

		public Privacy {
			if (noticeUrl == null || noticeUrl.isBlank()) {
				noticeUrl = null;
			}
			else {
				noticeUrl = noticeUrl.strip();
				if (!isAbsoluteHttps(noticeUrl)) {
					throw new IllegalArgumentException(
							"PRIVACY_NOTICE_URL must be an absolute https URL (for example https://example.com/privacy) or empty");
				}
			}
		}

		private static boolean isAbsoluteHttps(String value) {
			try {
				URI uri = new URI(value);
				return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
			}
			catch (URISyntaxException ex) {
				return false;
			}
		}

	}

}
