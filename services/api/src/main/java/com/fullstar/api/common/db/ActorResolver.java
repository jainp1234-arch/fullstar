package com.fullstar.api.common.db;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Decides who a request runs as (see JwtActorResolver).
 */
@FunctionalInterface
public interface ActorResolver {

	RequestActor resolve(HttpServletRequest request);

}
