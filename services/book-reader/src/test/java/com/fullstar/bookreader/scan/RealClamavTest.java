package com.fullstar.bookreader.scan;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.bookreader.config.ReaderProperties;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Plan 5.2 "done when" against a real ClamAV (make up runs clamav/clamav:1.4.6 on :3310). Runs only
 * when CLAMAV_HOST is set, because the ClamAV image needs minutes to download its signatures.
 */
@EnabledIfEnvironmentVariable(named = "CLAMAV_HOST", matches = ".+")
class RealClamavTest {

	private final ClamdClient client = new ClamdClient(new ReaderProperties(null, null,
			new ReaderProperties.Clamav(System.getenv("CLAMAV_HOST"),
					Integer.parseInt(System.getenv().getOrDefault("CLAMAV_PORT", "3310")), Duration.ofSeconds(60))));

	@Test
	void theEicarTestFileIsFoundAndACleanFileIsNot() {
		ClamdClient.Verdict eicar = client.scan(new ByteArrayInputStream(FakeClamd.EICAR.getBytes(StandardCharsets.US_ASCII)));
		assertThat(eicar.infected()).isTrue();
		assertThat(eicar.signature()).containsIgnoringCase("eicar");

		ClamdClient.Verdict clean = client
			.scan(new ByteArrayInputStream("%PDF-1.7 Chapter 1: Plants around us".getBytes(StandardCharsets.US_ASCII)));
		assertThat(clean.infected()).isFalse();
	}

}
