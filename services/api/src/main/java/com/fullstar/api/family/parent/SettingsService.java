package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.publicapi.PublicConfigService;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Family settings (Schema §11 /family/parent/settings; App Flow B4, P14). */
@Service
public class SettingsService {

	private static final Logger log = LoggerFactory.getLogger(SettingsService.class);

	private final JdbcTemplate jdbc;

	public SettingsService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public record Settings(int dailyLimitMinutes, boolean soundEnabled, boolean celebrationsEnabled) {
	}

	/** A partial update: null means "leave unchanged". */
	public record Change(Integer dailyLimitMinutes, Boolean soundEnabled, Boolean celebrationsEnabled) {
	}

	public Settings get(RequestActor actor) {
		return jdbc.queryForObject("""
				SELECT daily_limit_minutes, sound_enabled, celebrations_enabled FROM app.families WHERE id = ?""",
				(rs, n) -> new Settings(rs.getInt("daily_limit_minutes"), rs.getBoolean("sound_enabled"),
						rs.getBoolean("celebrations_enabled")),
				actor.familyId());
	}

	public Settings update(RequestActor actor, Change change) {
		if (change.dailyLimitMinutes() != null
				&& !PublicConfigService.TIME_LIMIT_MINUTES.contains(change.dailyLimitMinutes())) {
			throw new ValidationException("daily_limit_minutes is not valid", Map.of("daily_limit_minutes", "INVALID"));
		}
		jdbc.update("""
				UPDATE app.families
				   SET daily_limit_minutes = COALESCE(?, daily_limit_minutes),
				       sound_enabled = COALESCE(?, sound_enabled),
				       celebrations_enabled = COALESCE(?, celebrations_enabled)
				 WHERE id = ?""", change.dailyLimitMinutes(), change.soundEnabled(), change.celebrationsEnabled(),
				actor.familyId());
		log.info("Settings updated familyId={}", actor.familyId());
		return get(actor);
	}

}
