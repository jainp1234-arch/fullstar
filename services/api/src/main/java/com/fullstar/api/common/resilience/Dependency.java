package com.fullstar.api.common.resilience;

/** Outside services; each has its own Resilience4j instances (application.properties). */
public enum Dependency {

	CLAUDE("claude"), R2("r2"), SQS("sqs"), GOTENBERG("gotenberg");

	private final String instanceName;

	Dependency(String instanceName) {
		this.instanceName = instanceName;
	}

	public String instanceName() {
		return instanceName;
	}

}
