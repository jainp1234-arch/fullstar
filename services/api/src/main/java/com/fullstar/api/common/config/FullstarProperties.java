package com.fullstar.api.common.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** fullstar.* settings. */
@Validated
@ConfigurationProperties("fullstar")
public record FullstarProperties(@Valid @NotNull Consent consent, @Valid @NotNull Uploads uploads) {

	/** Version of the privacy notice the parent consents to (stored in families.consent_version). */
	public record Consent(@NotBlank String version) {
	}

	/** Upload limits (PRD, Tech Stack §10, Schema §4.3). */
	public record Uploads(@Positive long pdfMaxBytes, @Positive int pdfMaxPages, @Positive long photoMaxBytes,
			@Positive int photosPerUpload) {
	}

}
