package com.fullstar.api.common.error;

/** JSON field names are snake_case (Schema §10); Java names are camelCase. */
final class FieldNames {

	private FieldNames() {
	}

	static String toSnakeCase(String name) {
		if (name == null) {
			return "";
		}
		StringBuilder out = new StringBuilder(name.length() + 4);
		for (char ch : name.toCharArray()) {
			if (Character.isUpperCase(ch)) {
				if (!out.isEmpty()) {
					out.append('_');
				}
				out.append(Character.toLowerCase(ch));
			}
			else {
				out.append(ch);
			}
		}
		return out.toString();
	}

}
