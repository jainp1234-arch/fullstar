package com.fullstar.api.common.db;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Decides who a request runs as. Step 1.5 provides the JWT-based implementation; until then
 * every request is anonymous.
 */
@FunctionalInterface
public interface ActorResolver {

	RequestActor resolve(HttpServletRequest request);

}
