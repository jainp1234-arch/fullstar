package com.fullstar.keycloak.emailotp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EmailOtpTest {

	@Test
	void hasProviderId() {
		assertThat(EmailOtp.PROVIDER_ID).isEqualTo("fullstar-email-otp");
	}

}
