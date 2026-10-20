package com.fullstar.api.common.error;

import java.util.Map;

public class ValidationException extends ApiException {

	public ValidationException(String message, Map<String, String> fields) {
		super(ErrorCode.VALIDATION_FAILED, message, fields, null);
	}

}
