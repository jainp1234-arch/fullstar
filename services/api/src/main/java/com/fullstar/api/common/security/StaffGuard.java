package com.fullstar.api.common.security;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;

/** Staff role checks (Schema §9). The role is the one from staff_users, matched by JwtActorResolver. */
public final class StaffGuard {

	private StaffGuard() {
	}

	public static RequestActor requireStaff(HttpServletRequest request) {
		RequestActor actor = RequestActor.of(request);
		if (actor.kind() != RequestActor.Kind.STAFF) {
			throw new ApiException(ErrorCode.FORBIDDEN, "Not allowed");
		}
		return actor;
	}

	public static RequestActor requireSuperAdmin(HttpServletRequest request) {
		RequestActor actor = requireStaff(request);
		if (actor.staffRole() != RequestActor.StaffRole.SUPER_ADMIN) {
			throw new ApiException(ErrorCode.FORBIDDEN, "Only a super admin can do this");
		}
		return actor;
	}

	public static UUID staffId(HttpServletRequest request) {
		requireStaff(request);
		return (UUID) request.getAttribute(JwtActorResolver.STAFF_ID_ATTRIBUTE);
	}

}
