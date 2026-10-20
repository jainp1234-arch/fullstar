package com.fullstar.api.common.db;

import java.util.Objects;
import java.util.UUID;

/**
 * Who a request runs as; becomes the Schema §7 session values app.actor, app.family_id and
 * app.staff_role.
 */
public record RequestActor(Kind kind, UUID familyId, StaffRole staffRole) {

	public enum Kind {

		ANONYMOUS, PARENT, STAFF

	}

	public enum StaffRole {

		CONTENT_ADMIN("content_admin"), SUPER_ADMIN("super_admin");

		private final String dbValue;

		StaffRole(String dbValue) {
			this.dbValue = dbValue;
		}

		public String dbValue() {
			return dbValue;
		}

	}

	public static final RequestActor ANONYMOUS = new RequestActor(Kind.ANONYMOUS, null, null);

	/** Request attribute holding the actor, set by the request transaction filter. */
	public static final String ATTRIBUTE = RequestActor.class.getName();

	public static RequestActor of(jakarta.servlet.http.HttpServletRequest request) {
		Object actor = request.getAttribute(ATTRIBUTE);
		return actor instanceof RequestActor known ? known : ANONYMOUS;
	}

	public RequestActor {
		Objects.requireNonNull(kind, "kind");
		if (kind == Kind.PARENT && (familyId == null || staffRole != null)) {
			throw new IllegalArgumentException("A parent has a family id and no staff role");
		}
		if (kind == Kind.STAFF && (staffRole == null || familyId != null)) {
			throw new IllegalArgumentException("Staff have a staff role and no family id");
		}
		if (kind == Kind.ANONYMOUS && (familyId != null || staffRole != null)) {
			throw new IllegalArgumentException("Anonymous requests have no family or role");
		}
	}

	public static RequestActor parent(UUID familyId) {
		return new RequestActor(Kind.PARENT, familyId, null);
	}

	public static RequestActor staff(StaffRole role) {
		return new RequestActor(Kind.STAFF, null, role);
	}

	/** app.actor value, or empty for anonymous requests. */
	public String actorValue() {
		return switch (kind) {
			case PARENT -> "parent";
			case STAFF -> "staff";
			case ANONYMOUS -> "";
		};
	}

	/** Owner of idempotency records (V12): the family id, or "staff". Null when anonymous. */
	public String idempotencyOwner() {
		return switch (kind) {
			case PARENT -> familyId.toString();
			case STAFF -> "staff";
			case ANONYMOUS -> null;
		};
	}

}
