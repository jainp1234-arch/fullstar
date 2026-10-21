package com.fullstar.bookreader.scan;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A stand-in clamd for tests: speaks INSTREAM and reports "Eicar-Test-Signature FOUND" when the
 * stream contains the EICAR test string, like the real ClamAV.
 */
public final class FakeClamd implements AutoCloseable {

	/** The EICAR anti-virus test string, assembled here so no file in the repo looks infected. */
	public static final String EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS" + "-TEST-FILE!$H+H*";

	private final ServerSocket server;

	private final List<byte[]> streams = new CopyOnWriteArrayList<>();

	private volatile String forcedReply;

	public FakeClamd() throws IOException {
		server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
		Thread.ofVirtual().start(this::serve);
	}

	public int port() {
		return server.getLocalPort();
	}

	/** Bytes received per scan, in order. */
	public List<byte[]> streams() {
		return streams;
	}

	/** Makes every following scan answer this (e.g. a size limit error); null = normal. */
	public void reply(String text) {
		this.forcedReply = text;
	}

	private void serve() {
		while (!server.isClosed()) {
			try (Socket socket = server.accept()) {
				DataInputStream in = new DataInputStream(socket.getInputStream());
				byte[] command = new byte["zINSTREAM\0".length()];
				in.readFully(command);
				if (!"zINSTREAM\0".equals(new String(command, StandardCharsets.US_ASCII))) {
					continue;
				}
				ByteArrayOutputStream data = new ByteArrayOutputStream();
				int length;
				while ((length = in.readInt()) > 0) {
					byte[] chunk = new byte[length];
					in.readFully(chunk);
					data.write(chunk);
				}
				streams.add(data.toByteArray());
				String content = data.toString(StandardCharsets.ISO_8859_1);
				String reply = forcedReply != null ? forcedReply
						: content.contains(EICAR) ? "stream: Eicar-Test-Signature FOUND" : "stream: OK";
				OutputStream out = socket.getOutputStream();
				out.write((reply + "\0").getBytes(StandardCharsets.US_ASCII));
				out.flush();
			}
			catch (IOException ex) {
				// Closed while waiting, or a client gave up: keep serving until closed
			}
		}
	}

	@Override
	public void close() throws IOException {
		server.close();
	}

}
