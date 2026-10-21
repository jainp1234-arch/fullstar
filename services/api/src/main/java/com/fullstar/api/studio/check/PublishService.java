package com.fullstar.api.studio.check;

import com.fullstar.api.common.audit.AuditLog;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import com.fullstar.api.common.error.NotFoundException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Publish and unpublish (Schema §11, S6). Publishing sets published_version_id to the current version;
 * the database rule guard_publish refuses a version whose latest check has not passed or still has
 * an open flag (409 CHECK_NOT_PASSED). Unpublishing archives the item: children no longer see it.
 */
@Service
public class PublishService {

	private static final Logger log = LoggerFactory.getLogger(PublishService.class);

	private final JdbcTemplate jdbc;

	private final AuditLog audit;

	public PublishService(JdbcTemplate jdbc, AuditLog audit) {
		this.jdbc = jdbc;
		this.audit = audit;
	}

	public void publish(UUID staffId, UUID itemId) {
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT ci.current_version_id, v.version_no FROM app.content_items ci
				  LEFT JOIN app.content_versions v ON v.id = ci.current_version_id
				 WHERE ci.id = ? FOR UPDATE OF ci""", itemId);
		if (rows.isEmpty()) {
			throw new NotFoundException();
		}
		UUID versionId = (UUID) rows.get(0).get("current_version_id");
		if (versionId == null) {
			throw new ApiException(ErrorCode.CONFLICT, "This item has no saved version yet");
		}
		// guard_publish raises CHECK_NOT_PASSED when the version is not cleared
		jdbc.update("""
				UPDATE app.content_items
				   SET published_version_id = ?, status = 'published', published_at = now(), archived_at = NULL
				 WHERE id = ?""", versionId, itemId);
		audit.staff(staffId, "content.publish", "content_item", itemId,
				Map.of("version_no", rows.get(0).get("version_no")));
		log.info("Content published itemId={} versionId={}", itemId, versionId);
	}

	public void unpublish(UUID staffId, UUID itemId) {
		int updated = jdbc.update("""
				UPDATE app.content_items SET status = 'archived', archived_at = now()
				 WHERE id = ? AND status <> 'archived'""", itemId);
		if (updated == 0) {
			Integer known = jdbc.queryForObject("SELECT count(*) FROM app.content_items WHERE id = ?", Integer.class,
					itemId);
			if (known == null || known == 0) {
				throw new NotFoundException();
			}
			return;
		}
		audit.staff(staffId, "content.unpublish", "content_item", itemId, Map.of());
		log.info("Content unpublished itemId={}", itemId);
	}

}
