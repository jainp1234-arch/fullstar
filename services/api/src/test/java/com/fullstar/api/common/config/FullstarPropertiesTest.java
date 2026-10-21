package com.fullstar.api.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class FullstarPropertiesTest {

	@Test
	void emptyOrUnsetNoticeUrlMeansNone() {
		assertThat(new FullstarProperties.Privacy(null).noticeUrl()).isNull();
		assertThat(new FullstarProperties.Privacy("").noticeUrl()).isNull();
		assertThat(new FullstarProperties.Privacy("   ").noticeUrl()).isNull();
	}

	@Test
	void anAbsoluteHttpsUrlIsAccepted() {
		assertThat(new FullstarProperties.Privacy(" https://example.com/privacy ").noticeUrl())
			.isEqualTo("https://example.com/privacy");
	}

	@Test
	void anythingElseFailsWithAClearMessage() {
		for (String bad : new String[] { "http://example.com/privacy", "/privacy", "example.com/privacy", "https://",
				"javascript:alert(1)", "https://exa mple.com" }) {
			assertThatThrownBy(() -> new FullstarProperties.Privacy(bad)).isInstanceOf(IllegalArgumentException.class)
				.hasMessageContaining("PRIVACY_NOTICE_URL must be an absolute https URL");
		}
	}

}
