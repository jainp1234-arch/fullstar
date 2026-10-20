package com.fullstar.api.common.error;

/** An outside service (R2, SQS, Claude, Gotenberg) is down or its circuit is open. */
public class DependencyUnavailableException extends ApiException {

	private final String dependency;

	public DependencyUnavailableException(String dependency, Throwable cause) {
		super(ErrorCode.DEPENDENCY_UNAVAILABLE, "A service we depend on is unavailable, please try again shortly");
		this.dependency = dependency;
		initCause(cause);
	}

	public String dependency() {
		return dependency;
	}

}
