package com.fullstar.bookreader.scan;

import com.fullstar.bookreader.config.ReaderProperties;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;

/**
 * Talks to clamd with its INSTREAM command (Tech Stack §7, ClamAV 1.4): the file is streamed in
 * length-prefixed chunks, so it never touches book-reader's disk. Answers "stream: OK" or
 * "stream: &lt;signature&gt; FOUND"; anything else (for example a size limit) is an error and the
 * job is tried again.
 */
@Component
public class ClamdClient {

	private static final byte[] COMMAND = "zINSTREAM\0".getBytes(StandardCharsets.US_ASCII);

	private static final int CHUNK = 64 * 1024;

	private final ReaderProperties.Clamav clamav;

	public ClamdClient(ReaderProperties properties) {
		this.clamav = properties.clamav();
	}

	/** Verdict for one file; signature is the ClamAV name of what was found (null when clean). */
	public record Verdict(boolean infected, String signature) {
	}

	public Verdict scan(InputStream content) {
		int timeout = (int) clamav.timeout().toMillis();
		try (Socket socket = new Socket()) {
			socket.connect(new InetSocketAddress(clamav.host(), clamav.port()), Math.min(timeout, 5_000));
			socket.setSoTimeout(timeout);
			OutputStream out = socket.getOutputStream();
			out.write(COMMAND);
			byte[] buffer = new byte[CHUNK];
			int read;
			while ((read = content.read(buffer)) > 0) {
				out.write(ByteBuffer.allocate(4).putInt(read).array());
				out.write(buffer, 0, read);
			}
			out.write(new byte[4]);
			out.flush();
			return verdict(readReply(socket.getInputStream()));
		}
		catch (IOException ex) {
			throw new UncheckedIOException("clamd scan failed", ex);
		}
	}

	static Verdict verdict(String reply) {
		String text = reply.strip();
		if (text.endsWith(": OK")) {
			return new Verdict(false, null);
		}
		if (text.endsWith(" FOUND")) {
			String body = text.substring(text.indexOf(':') + 1, text.length() - " FOUND".length()).strip();
			return new Verdict(true, body);
		}
		throw new IllegalStateException("clamd could not scan the file: " + text);
	}

	private static String readReply(InputStream in) throws IOException {
		ByteArrayOutputStream reply = new ByteArrayOutputStream();
		int b;
		while ((b = in.read()) > 0) {
			reply.write(b);
		}
		return reply.toString(StandardCharsets.US_ASCII);
	}

}
