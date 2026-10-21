package com.fullstar.api.family.parent;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.error.ValidationException;
import com.fullstar.api.family.account.FamilyAccountService;
import com.fullstar.api.publicapi.PublicConfigService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

/** Children of the family (Schema §11 /family/parent/children). Max 2 is enforced by the V9 trigger. */
@Service
public class ChildrenService {

	private static final Logger log = LoggerFactory.getLogger(ChildrenService.class);

	static final int MAX_NAME_LENGTH = 40;

	static final int MIN_AGE = 4;

	static final int MAX_AGE = 12;

	private static final RowMapper<FamilyAccountService.Child> CHILD_MAPPER = (rs, n) -> new FamilyAccountService.Child(
			rs.getObject("id", UUID.class), rs.getString("first_name"), rs.getInt("age"), rs.getInt("class_level"),
			rs.getString("avatar_key"), rs.getInt("stars_total"));

	private final JdbcTemplate jdbc;

	public ChildrenService(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** A partial update: null means "leave unchanged". class_level is not editable here. */
	public record Change(String firstName, Integer age, String avatarKey) {
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
				RETURNING id, first_name, age, class_level, avatar_key, stars_total""", CHILD_MAPPER,
				actor.familyId(), name, age, classLevel, avatarKey);
		log.info("Child added familyId={} childId={}", actor.familyId(), child.id());
		return child;
	}

	/** PATCH /family/parent/children/{id}. RLS hides other families' children, so they are simply not found. */
	public FamilyAccountService.Child update(RequestActor actor, UUID id, Change change) {
		Map<String, String> errors = new LinkedHashMap<>();
		String name = change.firstName() == null ? null : change.firstName().strip();
		if (name != null && name.isEmpty()) {
			errors.put("first_name", "REQUIRED");
		}
		else if (name != null && name.length() > MAX_NAME_LENGTH) {
			errors.put("first_name", "INVALID_LENGTH");
		}
		if (change.age() != null && (change.age() < MIN_AGE || change.age() > MAX_AGE)) {
			errors.put("age", "OUT_OF_RANGE");
		}
		if (change.avatarKey() != null && !PublicConfigService.AVATARS.contains(change.avatarKey())) {
			errors.put("avatar_key", "INVALID");
		}
		if (!errors.isEmpty()) {
			throw new ValidationException("Child is not valid", errors);
		}
		List<FamilyAccountService.Child> updated = jdbc.query("""
				UPDATE app.children
				   SET first_name = COALESCE(?, first_name), age = COALESCE(?, age),
				       avatar_key = COALESCE(?, avatar_key), updated_at = now()
				 WHERE id = ?
				RETURNING id, first_name, age, class_level, avatar_key, stars_total""", CHILD_MAPPER, name,
				change.age(), change.avatarKey(), id);
		if (updated.isEmpty()) {
			throw new NotFoundException();
		}
		log.info("Child updated familyId={} childId={}", actor.familyId(), id);
		return updated.get(0);
	}

	/** DELETE /family/parent/children/{id}: the dependent rows cascade (Schema §4). */
	public UUID delete(RequestActor actor, UUID id) {
		List<UUID> deleted = jdbc.queryForList("DELETE FROM app.children WHERE id = ? RETURNING id", UUID.class, id);
		if (deleted.isEmpty()) {
			throw new NotFoundException();
		}
		log.info("Child deleted familyId={} childId={}", actor.familyId(), id);
		return id;
	}

	/** POST /family/parent/children/{id}/move-to-next-class: app.move_child_to_next_class (MAX_CLASS at 5). */
	public FamilyAccountService.Child moveToNextClass(RequestActor actor, UUID id) {
		jdbc.queryForObject("SELECT app.move_child_to_next_class(?)", Integer.class, id);
		FamilyAccountService.Child child = jdbc.queryForObject("""
				SELECT id, first_name, age, class_level, avatar_key, stars_total FROM app.children WHERE id = ?""",
				CHILD_MAPPER, id);
		log.info("Child moved to next class familyId={} childId={} classLevel={}", actor.familyId(), id,
				child.classLevel());
		return child;
	}

}
