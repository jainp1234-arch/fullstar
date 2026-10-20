package com.fullstar.api.common.error;

/** Missing or not visible; never says which (Schema §10). */
public class NotFoundException extends ApiException {

	public NotFoundException() {
		super(ErrorCode.NOT_FOUND, "Not found");
	}

}
