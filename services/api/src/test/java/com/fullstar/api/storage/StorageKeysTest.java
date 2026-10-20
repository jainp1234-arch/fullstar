package com.fullstar.api.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fullstar.api.common.storage.StorageKeys;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Schema §13 key layout. */
class StorageKeysTest {

	private static final UUID FAMILY = UUID.fromString("11111111-1111-1111-1111-111111111111");

	private static final UUID ID = UUID.fromString("22222222-2222-2222-2222-222222222222");

	private static final UUID FILE = UUID.fromString("33333333-3333-3333-3333-333333333333");

	@Test
	void familyKeysLiveUnderTheFamilyPrefix() {
		String prefix = "families/" + FAMILY + "/";
		assertThat(StorageKeys.upload(FAMILY, ID, FILE)).isEqualTo(prefix + "uploads/" + ID + "/" + FILE);
		assertThat(StorageKeys.page(FAMILY, ID)).isEqualTo(prefix + "pages/" + ID + ".webp");
		assertThat(StorageKeys.audio(FAMILY, ID)).isEqualTo(prefix + "audio/" + ID + ".mp3");
		assertThat(StorageKeys.recording(FAMILY, ID)).isEqualTo(prefix + "recordings/" + ID + ".webm");
		assertThat(StorageKeys.worksheet(FAMILY, ID)).isEqualTo(prefix + "worksheets/" + ID + ".pdf");
		assertThat(StorageKeys.familyPrefix(FAMILY)).isEqualTo(prefix);
	}

	@Test
	void contentKeysRejectUnsafeNames() {
		assertThat(StorageKeys.content(ID, 2, "scene-1.webp")).isEqualTo("content/" + ID + "/2/scene-1.webp");
		for (String bad : new String[] { "../x", "a/b", "", "x y", "..", null }) {
			assertThatThrownBy(() -> StorageKeys.content(ID, 1, bad)).isInstanceOf(IllegalArgumentException.class);
		}
		assertThatThrownBy(() -> StorageKeys.content(ID, 0, "a.webp")).isInstanceOf(IllegalArgumentException.class);
	}

}
