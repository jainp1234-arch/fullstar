package com.fullstar.api.common.storage;

import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * R2 key layout (Schema §13). Everything a family owns lives under families/&lt;family_id&gt;/, so
 * deleting a family deletes one prefix.
 */
public final class StorageKeys {

	private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,120}");

	private StorageKeys() {
	}

	public static String familyPrefix(UUID familyId) {
		return "families/" + Objects.requireNonNull(familyId) + "/";
	}

	public static String upload(UUID familyId, UUID uploadId, UUID fileId) {
		return familyPrefix(familyId) + "uploads/" + uploadId + "/" + fileId;
	}

	public static String page(UUID familyId, UUID pageId) {
		return familyPrefix(familyId) + "pages/" + pageId + ".webp";
	}

	public static String audio(UUID familyId, UUID pageId) {
		return familyPrefix(familyId) + "audio/" + pageId + ".mp3";
	}

	public static String recording(UUID familyId, UUID readingTestId) {
		return familyPrefix(familyId) + "recordings/" + readingTestId + ".webm";
	}

	public static String worksheet(UUID familyId, UUID worksheetId) {
		return familyPrefix(familyId) + "worksheets/" + worksheetId + ".pdf";
	}

	/** content/&lt;item_id&gt;/&lt;version_no&gt;/&lt;name&gt; for lesson assets and narration. */
	public static String content(UUID itemId, int versionNo, String name) {
		if (versionNo < 1 || name == null || !SAFE_NAME.matcher(name).matches() || name.contains("..")) {
			throw new IllegalArgumentException("Invalid content asset name or version");
		}
		return "content/" + Objects.requireNonNull(itemId) + "/" + versionNo + "/" + name;
	}

}
