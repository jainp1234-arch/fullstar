package com.fullstar.api.publicapi;

import com.fullstar.api.common.config.FullstarProperties;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Data for GET /public/config (Schema §11; App Flow B2, B4). */
@Service
public class PublicConfigService {

	/** Same list as the children.avatar_key check (Schema §4.1). */
	public static final List<String> AVATARS = List.of("cat", "dog", "lion", "panda", "rabbit", "tiger", "fox", "koala",
			"monkey", "penguin", "frog", "unicorn");

	/** Same list as the families.daily_limit_minutes check (Schema §4.1). */
	public static final List<Integer> TIME_LIMIT_MINUTES = List.of(20, 30, 45, 60);

	static final int DEFAULT_TIME_LIMIT_MINUTES = 30;

	private final JdbcTemplate jdbc;

	private final FullstarProperties properties;

	public PublicConfigService(JdbcTemplate jdbc, FullstarProperties properties) {
		this.jdbc = jdbc;
		this.properties = properties;
	}

	public record Subject(int id, String code, String name) {
	}

	public record ClassSubjects(int classLevel, List<Subject> subjects) {
	}

	public record UploadLimits(long pdfMaxBytes, int pdfMaxPages, long photoMaxBytes, int photosPerUpload) {
	}

	public record TimeLimits(List<Integer> optionsMinutes, int defaultMinutes) {
	}

	public record PublicConfig(List<String> avatars, List<ClassSubjects> classes, UploadLimits uploadLimits,
			TimeLimits timeLimits, String consentVersion, String privacyNoticeUrl) {
	}

	public PublicConfig current() {
		FullstarProperties.Uploads uploads = properties.uploads();
		return new PublicConfig(AVATARS, classSubjects(),
				new UploadLimits(uploads.pdfMaxBytes(), uploads.pdfMaxPages(), uploads.photoMaxBytes(),
						uploads.photosPerUpload()),
				new TimeLimits(TIME_LIMIT_MINUTES, DEFAULT_TIME_LIMIT_MINUTES), properties.consent().version(),
				properties.privacy().noticeUrl());
	}

	private List<ClassSubjects> classSubjects() {
		Map<Integer, List<Subject>> byClass = new LinkedHashMap<>();
		jdbc.query("""
				SELECT cs.class_level, s.id, s.code, s.name FROM app.class_subjects cs
				  JOIN app.subjects s ON s.id = cs.subject_id
				 WHERE s.active ORDER BY cs.class_level, s.id""", rs -> {
			byClass.computeIfAbsent(rs.getInt("class_level"), k -> new ArrayList<>())
				.add(new Subject(rs.getInt("id"), rs.getString("code"), rs.getString("name")));
		});
		return byClass.entrySet().stream().map(e -> new ClassSubjects(e.getKey(), List.copyOf(e.getValue()))).toList();
	}

}
