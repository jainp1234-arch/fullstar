package com.fullstar.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// Full context test arrives with the database in phase 1.
class ApiApplicationTests {

	@Test
	void isSpringBootApplication() {
		assertThat(ApiApplication.class).hasAnnotation(SpringBootApplication.class);
	}

}
