package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.family.account.FamilyAccountService;
import com.fullstar.api.publicapi.PublicConfigService;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Children of the family (Schema §11 /family/parent/children). Max 2 is enforced by the V9 trigger. */
@Service
public class ChildrenService {

	private static final Logger log = LoggerFactory.getLogger(ChildrenService.class);

	static final int MAX_NAME_LENGTH = 40;

	private final JdbcTemplate jdbc;

	public ChildrenService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** POST /family/parent/children (B2, P15). */
	public FamilyAccountService.Child add(RequestActor actor, String firstName, int age, int classLevel,
			String avatarKey) {
		String name = firstName == null ? "" : firstName.strip();
		if (name.isEmpty()) {
			throw new ValidationException("first_name is required", Map.of("first_name", "REQUIRED"));
		}
		if (name.length() > MAX_NAME_LENGTH) {
			throw new ValidationException("first_name has the wrong length", Map.of("first_name", "INVALID_LENGTH"));
		}
		if (!PublicConfigService.AVATARS.contains(avatarKey)) {
			throw new ValidationException("avatar_key is not valid", Map.of("avatar_key", "INVALID"));
		}
		FamilyAccountService.Child child = jdbc.queryForObject("""
				INSERT INTO app.children (family_id, first_name, age, class_level, avatar_key)
				VALUES (?, ?, ?, ?, ?)
				RETURNING id, first_name, age, class_level, avatar_key, stars_total""",
				(rs, n) -> new FamilyAccountService.Child(rs.getObject("id", UUID.class), rs.getString("first_name"),
						rs.getInt("age"), rs.getInt("class_level"), rs.getString("avatar_key"),
						rs.getInt("stars_total")),
				actor.familyId(), name, age, classLevel, avatarKey);
		log.info("Child added familyId={} childId={}", actor.familyId(), child.id());
		return child;
	}

}
