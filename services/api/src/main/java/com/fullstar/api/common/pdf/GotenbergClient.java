package com.fullstar.api.common.pdf;

import com.fullstar.api.common.resilience.Dependency;
import com.fullstar.api.common.resilience.ResilientCalls;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * HTML to PDF through Gotenberg's Chromium route (Tech Stack §7 gotenberg/gotenberg:8.37.0; Plan 7.2).
 * index.html and the files it links (fonts) go in one multipart request; A4, background printed.
 * Every call goes through Resilience4j instance gotenberg.
 */
@Service
public class GotenbergClient {

	/** A4 in inches; 15 mm margins. */
	private static final String A4_WIDTH = "8.27";

	private static final String A4_HEIGHT = "11.69";

	private static final String MARGIN = "0.6";

	private final RestClient http;

	private final ResilientCalls calls;

	public GotenbergClient(@Value("${fullstar.gotenberg.url:http://localhost:3000}") String baseUrl,
			ResilientCalls calls) {
		this.calls = calls;
		JdkClientHttpRequestFactory requests = new JdkClientHttpRequestFactory(
				HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
		requests.setReadTimeout(Duration.ofSeconds(60));
		this.http = RestClient.builder().baseUrl(baseUrl).requestFactory(requests).build();
	}

	/** files: name → bytes; must contain index.html. */
	public byte[] htmlToPdf(Map<String, byte[]> files) {
		MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
		files.forEach((name, bytes) -> form.add("files", new ByteArrayResource(bytes) {
			@Override
			public String getFilename() {
				return name;
			}
		}));
		form.add("paperWidth", A4_WIDTH);
		form.add("paperHeight", A4_HEIGHT);
		for (String side : new String[] { "marginTop", "marginBottom", "marginLeft", "marginRight" }) {
			form.add(side, MARGIN);
		}
		form.add("printBackground", "true");
		return calls.call(Dependency.GOTENBERG, () -> http.post()
			.uri("/forms/chromium/convert/html")
			.contentType(MediaType.MULTIPART_FORM_DATA)
			.body(form)
			.retrieve()
			.body(byte[].class));
	}

}
