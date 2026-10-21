package com.fullstar.api.common.security;

import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.lang.NonNull;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Kid mode and parent mode on one device (Schema §8.2). Run inside the request transaction, after
 * the RLS values are set.
 */
@Component
public class FamilyGuards {

	public static final String CHILD_HEADER = "X-Child-Id";

	public static final String CHILD_ATTRIBUTE = FamilyGuards.class.getName() + ".childId";

	private static final String CHILDREN_PATH = "/api/v1/family/parent/children";

	private final JdbcTemplate jdbc;

	private final ParentGrantService grants;

	public FamilyGuards(JdbcTemplate jdbc, ParentGrantService grants) {
		this.jdbc = jdbc;
		this.grants = grants;
	}

	/** /family/parent/**: a valid parent grant; a fresh one is returned on every successful call. */
	public HandlerInterceptor parentMode() {
		return new HandlerInterceptor() {
			@Override
			public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
					@NonNull Object handler) {
				RequestActor actor = requireFamily(request);
				Jwt jwt = JwtActorResolver.currentJwt();
				if (jwt == null || !grants.isValid(request.getHeader(ParentGrantService.HEADER), jwt.getSubject(),
						actor.familyId())) {
					if (jwt != null && isFirstChildSetup(request)) {
						return true;
					}
					throw new ApiException(ErrorCode.PIN_REQUIRED, "Please enter the parent PIN");
				}
				response.setHeader(ParentGrantService.HEADER, grants.issue(jwt.getSubject(), actor.familyId()).token());
				return true;
			}
		};
	}

	/** Schema §11 "P (setup: T)": adding the first child (B2) needs only the token. */
	private boolean isFirstChildSetup(HttpServletRequest request) {
		if (!"POST".equals(request.getMethod()) || !CHILDREN_PATH.equals(request.getRequestURI())) {
			return false;
		}
		// RLS limits app.children to this family
		Integer children = jdbc.queryForObject("SELECT count(*)::int FROM app.children", Integer.class);
		return children != null && children == 0;
	}

	/** /family/kid/**: X-Child-Id must be a child of this family. */
	public HandlerInterceptor kidMode() {
		return new HandlerInterceptor() {
			@Override
			public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
					@NonNull Object handler) {
				requireFamily(request);
				UUID child = parseChild(request.getHeader(CHILD_HEADER));
				// RLS limits app.children to this family, so another family's child is simply not found
				Integer found = child == null ? 0
						: jdbc.queryForObject("SELECT count(*)::int FROM app.children WHERE id = ?", Integer.class, child);
				if (found == null || found == 0) {
					throw new ApiException(ErrorCode.CHILD_NOT_IN_FAMILY, "This child is not in your family");
				}
				request.setAttribute(CHILD_ATTRIBUTE, child);
				return true;
			}
		};
	}

	static RequestActor requireFamily(HttpServletRequest request) {
		RequestActor actor = RequestActor.of(request);
		if (actor.kind() != RequestActor.Kind.PARENT) {
			throw new ApiException(ErrorCode.FAMILY_NOT_FOUND, "Please finish signing up first");
		}
		return actor;
	}

	private static UUID parseChild(String header) {
		try {
			return header == null ? null : UUID.fromString(header.trim());
		}
		catch (IllegalArgumentException ex) {
			return null;
		}
	}

}
