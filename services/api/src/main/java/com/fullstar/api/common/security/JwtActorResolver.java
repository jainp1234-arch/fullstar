package com.fullstar.api.common.security;

import com.fullstar.api.common.db.ActorResolver;
import com.fullstar.api.common.db.DataSourceConfig;
import com.fullstar.api.common.db.RequestActor;
import com.fullstar.api.common.error.ApiException;
import com.fullstar.api.common.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * Turns the validated Keycloak token into the request actor (Schema §8). The lookups run as
 * app_system because RLS hides the families and staff rows until the actor is known.
 * <ul>
 * <li>/api/v1/family/**: sub → families.keycloak_user_id. No family yet → anonymous (sign-up).</li>
 * <li>/api/v1/studio/**: sub → an active staff_users row; the role in our table is enforced and the
 * Keycloak realm role must match it (else 403 ROLE_MISMATCH).</li>
 * </ul>
 */
@Component
public class JwtActorResolver implements ActorResolver {

	public static final String STAFF_ID_ATTRIBUTE = JwtActorResolver.class.getName() + ".staffId";

	private final JdbcTemplate system;

	public JwtActorResolver(@Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system) {
		this.system = system;
	}

	@Override
	public RequestActor resolve(HttpServletRequest request) {
		Jwt jwt = currentJwt();
		if (jwt == null) {
			return RequestActor.ANONYMOUS;
		}
		String path = request.getRequestURI();
		if (path.startsWith("/api/v1/family/")) {
			return family(jwt);
		}
		if (path.startsWith("/api/v1/studio/")) {
			return staff(jwt, request);
		}
		return RequestActor.ANONYMOUS;
	}

	private RequestActor family(Jwt jwt) {
		List<UUID> ids = system.queryForList("SELECT id FROM app.families WHERE keycloak_user_id = ?", UUID.class,
				jwt.getSubject());
		return ids.isEmpty() ? RequestActor.ANONYMOUS : RequestActor.parent(ids.get(0));
	}

	private RequestActor staff(Jwt jwt, HttpServletRequest request) {
		List<Map<String, Object>> rows = system.queryForList(
				"SELECT id, role FROM app.staff_users WHERE keycloak_user_id = ? AND active", jwt.getSubject());
		if (rows.isEmpty()) {
			throw new ApiException(ErrorCode.FORBIDDEN, "This account has no Content Studio access");
		}
		String role = (String) rows.get(0).get("role");
		if (!realmRoles(jwt).contains(role)) {
			throw new ApiException(ErrorCode.ROLE_MISMATCH, "Your sign-in role does not match your staff role");
		}
		request.setAttribute(STAFF_ID_ATTRIBUTE, rows.get(0).get("id"));
		return RequestActor.staff(RequestActor.StaffRole.valueOf(role.toUpperCase(Locale.ROOT)));
	}

	@SuppressWarnings("unchecked")
	static List<String> realmRoles(Jwt jwt) {
		Object realmAccess = jwt.getClaims().get("realm_access");
		if (realmAccess instanceof Map<?, ?> map && map.get("roles") instanceof List<?> roles) {
			return (List<String>) roles;
		}
		return List.of();
	}

	public static Jwt currentJwt() {
		Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
		return authentication instanceof JwtAuthenticationToken token ? token.getToken() : null;
	}

}
