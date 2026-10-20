package com.fullstar.api.common.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/** The §10 envelope: { "status", "data", "error" } on every response. */
@JsonInclude(JsonInclude.Include.ALWAYS)
@JsonPropertyOrder({ "status", "data", "error" })
public record ApiResponse<T>(String status, T data, ApiError error) {

	public static final String SUCCESS = "success";

	public static final String ERROR = "error";

	public static <T> ApiResponse<T> success(T data) {
		return new ApiResponse<>(SUCCESS, data, null);
	}

	public static ApiResponse<Void> failure(ApiError error) {
		return new ApiResponse<>(ERROR, null, error);
	}

}
