package com.fullstar.bookreader.scan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.bookreader.config.ReaderProperties;
import java.io.ByteArrayInputStream;
import java.io.UncheckedIOException;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ClamdClientTest {

	private FakeClamd clamd;

	private ClamdClient client;

	@BeforeEach
	void start() throws Exception {
		clamd = new FakeClamd();
		client = new ClamdClient(new ReaderProperties(null, null,
				new ReaderProperties.Clamav("127.0.0.1", clamd.port(), Duration.ofSeconds(5))));
	}

	@AfterEach
	void stop() throws Exception {
		clamd.close();
	}

	@Test
	void streamsTheWholeFileInChunksAndReadsTheVerdict() {
		byte[] big = new byte[200_000];
		Arrays.fill(big, (byte) 'a');
		assertThat(client.scan(new ByteArrayInputStream(big))).isEqualTo(new ClamdClient.Verdict(false, null));
		assertThat(clamd.streams().get(0)).isEqualTo(big);

		ClamdClient.Verdict infected = client
			.scan(new ByteArrayInputStream(("page text " + FakeClamd.EICAR).getBytes(StandardCharsets.ISO_8859_1)));
		assertThat(infected.infected()).isTrue();
		assertThat(infected.signature()).isEqualTo("Eicar-Test-Signature");
	}

	@Test
	void anErrorReplyOrNoClamdIsAFailureToRetry() throws Exception {
		clamd.reply("INSTREAM size limit exceeded. ERROR");
		assertThatThrownBy(() -> client.scan(new ByteArrayInputStream(new byte[10])))
			.isInstanceOf(IllegalStateException.class)
			.hasMessageContaining("size limit");
		// A port nothing listens on (closing the fake while it serves could still answer one connection)
		int closedPort;
		try (ServerSocket probe = new ServerSocket(0)) {
			closedPort = probe.getLocalPort();
		}
		ClamdClient noClamd = new ClamdClient(new ReaderProperties(null, null,
				new ReaderProperties.Clamav("127.0.0.1", closedPort, Duration.ofSeconds(5))));
		assertThatThrownBy(() -> noClamd.scan(new ByteArrayInputStream(new byte[10])))
			.isInstanceOf(UncheckedIOException.class);
	}

	@Test
	void verdictParsing() {
		assertThat(ClamdClient.verdict("stream: OK\n")).isEqualTo(new ClamdClient.Verdict(false, null));
		assertThat(ClamdClient.verdict("stream: Win.Test.EICAR_HDB-1 FOUND"))
			.isEqualTo(new ClamdClient.Verdict(true, "Win.Test.EICAR_HDB-1"));
	}

}
