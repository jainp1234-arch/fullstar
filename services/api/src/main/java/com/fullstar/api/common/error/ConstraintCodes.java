package com.fullstar.api.common.error;

/** Field codes in the VALIDATION_FAILED field map, from the Bean Validation constraint name. */
final class ConstraintCodes {

	static final String REQUIRED = "REQUIRED";

	static final String INVALID_LENGTH = "INVALID_LENGTH";

	static final String OUT_OF_RANGE = "OUT_OF_RANGE";

	static final String INVALID_FORMAT = "INVALID_FORMAT";

	static final String INVALID = "INVALID";

	private ConstraintCodes() {
	}

	static String of(String constraint) {
		if (constraint == null) {
			return INVALID;
		}
		return switch (constraint) {
			case "NotNull", "NotBlank", "NotEmpty" -> REQUIRED;
			case "Size", "Length" -> INVALID_LENGTH;
			case "Min", "Max", "DecimalMin", "DecimalMax", "Positive", "PositiveOrZero", "Negative", "NegativeOrZero",
					"Range" ->
				OUT_OF_RANGE;
			case "Pattern", "Email" -> INVALID_FORMAT;
			default -> INVALID;
		};
	}

}
